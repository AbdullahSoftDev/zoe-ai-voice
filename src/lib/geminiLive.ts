// Gemini Live API - Real-time voice call
import { Modality } from '@google/genai';

// Type definitions for Gemini Live API
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

let liveSession: any = null;
let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let scriptProcessor: ScriptProcessorNode | null = null;

// Convert PCM float32 to base64 for Gemini
function pcmToBlob(float32: Float32Array): { data: string; mimeType: string } {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return { data: btoa(bin), mimeType: 'audio/pcm' };
}

function b64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pcmToAudioBuffer(bytes: Uint8Array, ctx: AudioContext): Promise<AudioBuffer> {
  if (bytes.length === 0) return ctx.createBuffer(1, 1, 24000);
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const buf = ctx.createBuffer(1, int16.length, 24000);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < int16.length; i++) ch[i] = int16[i] / 32768;
  return buf;
}

// Get active Gemini key from Supabase
async function getActiveGeminiKey(): Promise<string | null> {
  const { supabase } = await import('@/integrations/supabase/client');
  const { data, error } = await supabase
    .from('api_keys')
    .select('key_value')
    .eq('provider', 'gemini')
    .eq('status', 'active')
    .gt('credits_remaining', 0)
    .order('fallback_order', { ascending: true })
    .limit(1)
    .single();
  
  if (error || !data) {
    console.error('[GeminiLive] No active API key found');
    return null;
  }
  
  return data.key_value;
}

// Callback types
export interface LiveCallCallbacks {
  onStart?: () => void;
  onAudioChunk?: (text: string) => void;
  onTranscript?: (text: string) => void;
  onUserTranscript?: (text: string) => void;
  onError?: (error: Error) => void;
  onEnd?: () => void;
}

// System prompt for Zoe
const ZOE_SYSTEM_PROMPT = `You are Zoe — a warm, witty, and brilliant AI voice assistant on a live call.

LANGUAGE RULES (NEVER VIOLATE):
- Urdu/Hindi input → Reply in Roman Urdu (English alphabet)
- English input → English reply ONLY
- Punjabi input → Punjabi reply
- ALWAYS provide reasoning in Urdu after your answer: "وجہ (Reason): ..."

PERSONALITY:
- Warm, encouraging, conversational
- Explain things thoroughly since this is a voice call
- Be helpful, friendly, and a little playful
- Use phrases like "I see", "Got it", "Let me help"

CAPABILITIES:
- Can make phone calls via Twilio when asked
- Can send WhatsApp messages
- Can generate documents and files
- Can send emails

When user asks to call someone, say: "I'll help you call [name]. Let me connect that for you."
When user asks to send a message, confirm: "I'll send that message right away."`;

export class GeminiLiveCall {
  private session: any = null;
  private inCtx: AudioContext | null = null;
  private outCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private sources: Set<AudioBufferSourceNode> = new Set();
  private nextPlayTime = 0;
  private callbacks: LiveCallCallbacks = {};
  private isActive = false;
  private transcriptBuffer = '';
  private userTextBuffer = '';

  constructor(callbacks: LiveCallCallbacks) {
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (this.isActive) return;
    this.isActive = true;

    try {
      // Get API key from Supabase
      const apiKey = await getActiveGeminiKey();
      if (!apiKey) {
        throw new Error('No active Gemini API key found. Add keys to Supabase api_keys table.');
      }

      this.callbacks.onStart?.();

      // Setup audio input (mic)
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000, channelCount: 1 }
      });

      // Audio contexts
      this.inCtx = new AudioContext({ sampleRate: 16000 });
      this.outCtx = new AudioContext({ sampleRate: 24000 });
      await this.inCtx.resume();
      await this.outCtx.resume();

      // Connect to Gemini Live API
      const ai = await import('@google/genai');
      const genAI = new ai.GoogleGenAI({ apiKey });

      // @ts-ignore - Live API
      this.session = await genAI.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => this.onOpen(),
          onmessage: (msg: any) => this.onMessage(msg),
          onerror: (e: any) => this.onError(e),
          onclose: () => this.onClose(),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Zephyr' }
            }
          },
          systemInstruction: ZOE_SYSTEM_PROMPT,
        },
      });

    } catch (err: any) {
      console.error('[GeminiLive] Start failed:', err);
      this.callbacks.onError?.(err);
      this.stop();
    }
  }

  private onOpen(): void {
    console.log('[GeminiLive] Session opened');
    
    // Send initial greeting
    const greeting = "Assalamualaikum! This is Zoe. How can I help you today?";
    try {
      this.session?.sendRealtimeInput([{ text: greeting }]);
    } catch (e) {
      console.error('Failed to send greeting:', e);
    }

    // Setup audio pipeline
    if (this.inCtx && this.stream) {
      const source = this.inCtx.createMediaStreamSource(this.stream);
      this.processor = this.inCtx.createScriptProcessor(4096, 1, 1);
      
      this.processor.onaudioprocess = (e) => {
        if (!this.session || this.inCtx?.state !== 'running') return;
        try {
          const inputData = e.inputBuffer.getChannelData(0);
          this.session.sendRealtimeInput({ media: pcmToBlob(inputData) });
        } catch { /* session closed */ }
      };
      
      source.connect(this.processor);
      const silentGain = this.inCtx.createGain();
      silentGain.gain.value = 0;
      this.processor.connect(silentGain);
      silentGain.connect(this.inCtx.destination);
    }
  }

  private async onMessage(msg: any): Promise<void> {
    // Audio response
    const audioB64 = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioB64 && this.outCtx) {
      const ctx = this.outCtx;
      if (ctx.state === 'suspended') await ctx.resume();
      if (ctx.state !== 'running') return;
      
      try {
        const audioBuf = await pcmToAudioBuffer(b64ToUint8(audioB64), ctx);
        const source = ctx.createBufferSource();
        source.buffer = audioBuf;
        source.connect(ctx.destination);
        source.addEventListener('ended', () => this.sources.delete(source));
        this.nextPlayTime = Math.max(this.nextPlayTime, ctx.currentTime);
        source.start(this.nextPlayTime);
        this.nextPlayTime += audioBuf.duration;
        this.sources.add(source);
      } catch (e) {
        console.error('Audio playback error:', e);
      }
    }

    // AI transcript
    const aiText = msg.serverContent?.outputTranscription?.text;
    if (aiText) {
      this.transcriptBuffer += aiText;
      this.callbacks.onTranscript?.(this.transcriptBuffer);
    }

    // User transcript
    const userText = msg.serverContent?.inputTranscription?.text;
    if (userText) {
      this.userTextBuffer += userText;
      this.callbacks.onUserTranscript?.(this.userTextBuffer);
    }

    // Turn complete - flush transcripts
    if (msg.serverContent?.turnComplete) {
      if (this.userTextBuffer) {
        this.callbacks.onUserTranscript?.(this.userTextBuffer);
      }
      if (this.transcriptBuffer) {
        this.callbacks.onAudioChunk?.(this.transcriptBuffer);
      }
      this.userTextBuffer = '';
      this.transcriptBuffer = '';
    }

    // Handle interruption
    if (msg.serverContent?.interrupted) {
      this.stopAllAudio();
    }
  }

  private stopAllAudio(): void {
    for (const source of this.sources) {
      try { source.stop(); } catch {}
    }
    this.sources.clear();
    this.nextPlayTime = 0;
  }

  private onError(e: any): void {
    console.error('[GeminiLive] Error:', e);
    const errorMsg = e?.message || 'Connection error';
    if (errorMsg.includes('403') || errorMsg.includes('key')) {
      this.callbacks.onError?.(new Error('API key error. Ensure your Gemini key has Live API enabled at aistudio.google.com'));
    } else {
      this.callbacks.onError?.(new Error(errorMsg));
    }
  }

  private onClose(): void {
    console.log('[GeminiLive] Session closed');
    this.isActive = false;
    this.callbacks.onEnd?.();
  }

  stop(): void {
    this.isActive = false;
    this.stopAllAudio();
    
    if (this.processor) {
      try { this.processor.disconnect(); } catch {}
      this.processor = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => { try { t.stop(); } catch {} });
      this.stream = null;
    }
    if (this.inCtx) {
      this.inCtx.close().catch(() => {});
      this.inCtx = null;
    }
    if (this.outCtx) {
      this.outCtx.close().catch(() => {});
      this.outCtx = null;
    }
    if (this.session) {
      try { this.session.close(); } catch {}
      this.session = null;
    }
    
    this.callbacks.onEnd?.();
  }

  isActiveCall(): boolean {
    return this.isActive;
  }
}
