// src/routes/voice.tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { 
  ArrowLeft, 
  Mic, 
  MicOff, 
  Send, 
  Volume2, 
  VolumeX, 
  Sparkles, 
  Phone, 
  PhoneOff,
  Loader2
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Orb } from "@/components/orb";
import { VoiceBars } from "@/components/voice-bars";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/components/auth-provider";
import { getGenAIInstance, chatWithGemini } from "@/lib/geminiService";
import { supabase } from "@/integrations/supabase/client";
import { getAllContacts } from "@/lib/contacts-sync";
import { sendEmail } from "@/lib/email-service";

import { 
  getWhatsAppStatus as getStatus, 
  sendWhatsAppText as sendText,
  sendWhatsAppVoice as sendVoice,
  makeCall,
  extractIntent,
  logAction
} from '@/lib/ai-studio-api';

// Audio helpers
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

const GEMINI_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";

// System instruction - allows Urdu/Hindi/Punjabi but ONLY in Roman/Latin script
const ZOE_SYSTEM = `You are Zoe — a warm, witty, and brilliant AI voice assistant on a live call.

⚠️ CRITICAL SCRIPT RULE (NEVER VIOLATE):
- You can respond in English, Roman Urdu (Urdu written in English/Latin script), or Punjabi.
- ALWAYS respond in the SAME language the user speaks to you.
- If user speaks in Roman Urdu, reply in Roman Urdu.
- If user speaks in English, reply in English.
- If user speaks in Punjabi, reply in Punjabi.
- NEVER use Devanagari script (Hindi script) or Bengali script in your responses. 
- Use ONLY English/Latin script (Roman Urdu).
- Example of Roman Urdu: "Assalamualaikum! Aap kaise hain?"
- Example of English: "Hello! How are you?"

PERSONALITY:
- Warm, encouraging, conversational.
- Be helpful, friendly, and a little playful.
- Keep responses concise.

CAPABILITIES:
- Generate files: Excel (XLSX), CSV, Word (DOCX), PowerPoint (PPTX), PDF, Code files (JS, TS, PY, CPP, JAVA, HTML, CSS, JSX)
- Send emails
- Remember conversation context
- Make phone calls via Twilio
- Send WhatsApp text messages
- Send WhatsApp voice messages

IMPORTANT: When user says "send WhatsApp message to [contact]" or "send voice message to [contact]", you have the ability to actually send it. The system will handle the actual sending. Just confirm and say "Sending WhatsApp message to [contact] now!" and the system will send it.`;

const SearchSchema = z.object({
  q: z.string().optional(),
  mode: z.enum(["call", "chat"]).optional(),
});

export const Route = createFileRoute("/voice")({
  component: VoicePage,
  validateSearch: (s) => SearchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Zoe — AI Voice Agent" },
      { name: "description", content: "Have a real-time voice conversation with Zoe." },
    ],
  }),
});

type Msg = { role: "user" | "assistant"; content: string };

// ============ HELPER: Convert Devanagari/Bengali to Roman Urdu ============
function convertToRomanScript(text: string): string {
  const devanagariToRoman: Record<string, string> = {
    'है': 'hai', 'हूँ': 'hoon', 'हैं': 'hain', 'मैं': 'main', 'आप': 'aap',
    'आपका': 'aapka', 'मुझे': 'mujhe', 'को': 'ko', 'से': 'se', 'में': 'mein',
    'पर': 'par', 'और': 'aur', 'कि': 'ki', 'के': 'ke', 'ने': 'ne', 'तो': 'to',
    'भी': 'bhi', 'हो': 'ho', 'गया': 'gaya', 'गई': 'gayi', 'गए': 'gaye',
    'रहा': 'raha', 'रही': 'rahi', 'रहे': 'rahe', 'था': 'tha', 'थी': 'thi',
    'थे': 'the', 'सकता': 'sakta', 'सकती': 'sakti', 'सकते': 'sakte',
    'अपना': 'apna', 'अपनी': 'apni', 'अपने': 'apne', 'होम': 'home', 'टुडे': 'today',
    'আমি': 'ami', 'আপনি': 'apni', 'আজ': 'aj', 'বাসা': 'basha', 'যাচ্ছি': 'jachchi', 'ঘর': 'ghor'
  };
  
  let roman = text;
  for (const [deva, romanText] of Object.entries(devanagariToRoman)) {
    roman = roman.replaceAll(deva, romanText);
  }
  roman = roman.replace(/[\u0900-\u097F]/g, '');
  roman = roman.replace(/[\u0980-\u09FF]/g, '');
  roman = roman.replace(/\s+/g, ' ').trim();
  return roman;
}

// ============ LANGUAGE DETECTION ============
function detectLanguage(text: string): 'english' | 'hindi' | 'urdu' | 'mixed' {
  const devanagariRegex = /[\u0900-\u097F]/;
  const arabicRegex = /[\u0600-\u06FF]/;
  
  let devanagariCount = 0;
  let arabicCount = 0;
  let englishCount = 0;
  
  for (const char of text) {
    if (devanagariRegex.test(char)) devanagariCount++;
    else if (arabicRegex.test(char)) arabicCount++;
    else if (char.match(/[a-zA-Z]/)) englishCount++;
  }
  
  const total = devanagariCount + arabicCount + englishCount;
  if (total === 0) return 'english';
  
  if (devanagariCount / total > 0.5) return 'hindi';
  if (arabicCount / total > 0.5) return 'urdu';
  return 'english';
}

// ============ FILE GENERATION HELPERS ============
function generateCSV(data: any[][], filename: string): Blob {
  const csvContent = data.map(row => 
    row.map(cell => {
      if (typeof cell === 'string' && (cell.includes(',') || cell.includes('"'))) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(',')
  ).join('\n');
  return new Blob(['\uFEFF' + csvContent], { type: 'text/csv' });
}

function generateWordDoc(content: string, filename: string): Blob {
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${filename}</title></head>
<body style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
  ${content.replace(/\n/g, '<br>')}
</body>
</html>`;
  return new Blob([html], { type: 'application/msword' });
}

function generatePowerPoint(content: string, filename: string): Blob {
  const slides = content.split(/---/).map((slide, i) => `
    <div style="page-break-after: always; padding: 60px 40px; height: 100vh; display: flex; flex-direction: column; justify-content: center;">
      <h1 style="color: #0891b2; font-size: 48px;">Slide ${i + 1}</h1>
      <div style="font-size: 28px; margin-top: 40px;">${slide.trim()}</div>
    </div>
  `).join('');
  
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${filename}</title></head>
<body style="font-family: Arial, sans-serif; margin: 0;">${slides}</body>
</html>`;
  return new Blob([html], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

function generateCodeFile(content: string, filename: string): Blob {
  let cleanContent = content;
  const codeBlockMatch = cleanContent.match(/```(?:\w+)?\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleanContent = codeBlockMatch[1].trim();
  }
  cleanContent = cleanContent.replace(/<[^>]*>/g, '');
  
  const ext = filename.split('.').pop() || 'txt';
  const mimeTypes: Record<string, string> = {
    js: 'text/javascript', ts: 'text/typescript', py: 'text/x-python',
    cpp: 'text/x-c++src', java: 'text/x-java', html: 'text/html',
    css: 'text/css', jsx: 'text/jsx', tsx: 'text/tsx', json: 'application/json',
    csv: 'text/csv', txt: 'text/plain', xml: 'application/xml',
    yaml: 'text/yaml', yml: 'text/yaml', sh: 'text/x-shellscript',
    bash: 'text/x-shellscript', rb: 'text/x-ruby', go: 'text/x-go',
    rs: 'text/x-rust', swift: 'text/x-swift', kt: 'text/x-kotlin',
    dart: 'text/x-dart', php: 'text/x-php', sql: 'text/x-sql',
    md: 'text/markdown'
  };
  return new Blob([cleanContent], { type: mimeTypes[ext] || 'text/plain' });
}

function generatePDF(content: string, filename: string): Blob {
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${filename}</title>
<style>body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; }</style>
</head><body>${content.replace(/\n/g, '<br>')}</body></html>`;
  return new Blob([html], { type: 'application/pdf' });
}

function downloadFile(blob: Blob, filename: string) {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast.success(`📄 "${filename}" downloaded!`);
    console.log(`[File] Downloaded: ${filename}`);
  } catch (error) {
    console.error('[File] Download failed:', error);
    toast.error(`Failed to download ${filename}`);
  }
}

async function sendEmailToContact(toEmail: string, subject: string, body: string): Promise<boolean> {
  try {
    const result = await sendEmail(toEmail, toEmail.split('@')[0], subject, body);
    if (result.success) {
      toast.success(`Email sent to ${toEmail}`);
      return true;
    } else {
      toast.error(result.error || "Failed to send email");
      return false;
    }
  } catch (error) {
    toast.error("Failed to send email");
    return false;
  }
}

// ============ SMART CONTACT MATCHING ============
const findClosestContact = (speechText: string, contacts: any[]) => {
  if (!contacts || contacts.length === 0) return null;
  
  const lowerSpeech = speechText.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;
  
  for (const contact of contacts) {
    const lowerName = contact.name.toLowerCase();
    if (lowerSpeech.includes(lowerName) && lowerName.length > 2) {
      return contact;
    }
  }
  
  for (const contact of contacts) {
    const firstName = contact.name.split(' ')[0].toLowerCase();
    if (firstName.length > 2 && lowerSpeech.includes(firstName)) {
      return contact;
    }
  }
  
  for (const contact of contacts) {
    const lowerName = contact.name.toLowerCase();
    let score = 0;
    
    if (lowerSpeech.includes(lowerName)) {
      score = 100;
    } else {
      const nameWords = lowerName.split(' ');
      for (const word of nameWords) {
        if (word.length > 2 && lowerSpeech.includes(word)) {
          score += 40;
        }
      }
    }
    
    const speechWords = lowerSpeech.split(' ');
    for (const speechWord of speechWords) {
      if (speechWord.length > 2) {
        if (lowerName.includes(speechWord) || speechWord.includes(lowerName)) {
          score += 20;
        }
      }
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = contact;
    }
  }
  
  return bestScore > 20 ? bestMatch : null;
};

// ============ EXTRACT CLEAN MESSAGE ============
const extractCleanMessage = (text: string, contactName: string): string => {
  let message = text;
  
  console.log('[Extract] Original:', message);
  console.log('[Extract] Contact name:', contactName);
  
  message = message.replace(new RegExp(contactName, 'gi'), '');
  
  const prefixes = [
    'send an email to', 'send email to', 'send mail to', 'email to', 'mail to',
    'send an email', 'send email', 'send mail',
    'send a whatsapp voice message to', 'send a whatsapp message to',
    'send whatsapp voice message to', 'send whatsapp message to',
    'send voice message to', 'send text message to',
    'send a message to', 'send message to', 'send a text to', 'send text to',
    'send a voice to', 'send voice to', 'voice message to', 'text message to',
    'whatsapp voice message to', 'whatsapp message to',
    'send a voice message to', 'send a text message to',
    'send a whatsapp to', 'send whatsapp to',
    'tell', 'say', 'please', 'plz', 'pls', 'kindly',
    'can you', 'could you', 'would you', 'send', 'to', 'for', 'that',
    'the', 'a', 'an', 'from', 'with', 'this', 'is', 'i want to',
    'need to', 'have to', 'going to', 'email', 'mail', 'whatsapp',
    'message', 'voice', 'text', 'whats app', 'wa', 'call', 'phone'
  ];
  
  const sortedPrefixes = prefixes.sort((a, b) => b.length - a.length);
  
  for (const word of sortedPrefixes) {
    const startRegex = new RegExp(`^\\s*${word}\\s+`, 'gi');
    message = message.replace(startRegex, ' ');
    const endRegex = new RegExp(`\\s+${word}\\s*$`, 'gi');
    message = message.replace(endRegex, ' ');
    const wordRegex = new RegExp(`\\b${word}\\b`, 'gi');
    message = message.replace(wordRegex, ' ');
  }
  
  message = message.replace(/\s+/g, ' ').trim();
  
  if (!message || message.length < 3) {
    const thatMatch = text.match(/that\s+(.+)/i);
    if (thatMatch) {
      message = thatMatch[1].trim();
    }
  }
  
  if (!message || message.length < 3) {
    const toMatch = text.match(new RegExp(`${contactName}\\s+(.+)$`, 'i'));
    if (toMatch) {
      message = toMatch[1].trim();
    }
  }
  
  if (!message || message.length < 3) {
    const parts = text.split(new RegExp(contactName, 'i'));
    if (parts.length > 1) {
      message = parts[1].trim();
    }
  }
  
  if (!message || message.length < 3) {
    message = 'Hello, this is a message from Abdullah via Zoe Assistant.';
  }
  
  message = message.replace(/^that\s+/i, '');
  message = message.replace(/^to\s+/i, '');
  message = message.charAt(0).toUpperCase() + message.slice(1);
  
  console.log('[Extract] Final message:', message);
  return message;
};

// ============ GENERATE POLITE MESSAGE ============
const generatePoliteMessage = async (rawMessage: string, contactName: string, type: 'email' | 'whatsapp'): Promise<string> => {
  try {
    console.log(`[Generate] Generating ${type} message for ${contactName} from: "${rawMessage}"`);
    
    const systemPrompt = `You are Zoe, Abdullah's AI assistant. Generate a short, polite, and natural message to send to ${contactName} on Abdullah's behalf.

Rules:
- For EMAIL: Start with "Assalam O Alaikum ${contactName}," if the name sounds Muslim, otherwise "Hello ${contactName},"
- For WHATSAPP: Start with "Salam ${contactName}," if the name sounds Muslim, otherwise "Hi ${contactName},"
- Keep it short (2-3 sentences max)
- Be warm, polite, and natural
- Use the same language as the user (English/Roman Urdu)
- Format it as a proper message, not a command
- Return ONLY the message text, no explanations

User wants to say: "${rawMessage}"
Generate a polite message to send to ${contactName}:`;

    const response = await chatWithGemini([
      { role: 'user', content: systemPrompt }
    ]);

    const generated = response.trim();
    console.log(`[Generate] Generated ${type} message:`, generated);
    return generated || rawMessage;
  } catch (error) {
    console.error('[Generate] Failed to generate message, using fallback:', error);
    const isMuslim = ['abdullah', 'muhammad', 'ahmed', 'ali', 'hassan', 'hussain', 'fatima', 'ayesha', 'zain', 'sayyan', 'mama', 'subhan', 'rauf'].some(
      name => contactName.toLowerCase().includes(name)
    );
    const greeting = isMuslim ? `Assalam O Alaikum ${contactName},` : `Hello ${contactName},`;
    return `${greeting}\n\n${rawMessage}\n\nBest regards,\nAbdullah`;
  }
};

// ============ SEND WHATSAPP WITH VOICE FALLBACK ============
const sendWhatsAppWithFallback = async (phone: string, message: string, isVoice: boolean): Promise<{ success: boolean; error?: string; usedFallback?: boolean }> => {
  console.log(`[Send] Sending ${isVoice ? 'voice' : 'text'} message to ${phone}: "${message}"`);
  
  if (!isVoice) {
    const result = await sendText(phone, message);
    return { success: result.success, error: result.error };
  }
  
  try {
    console.log('[Send] Trying Gemini TTS for voice...');
    const result = await sendVoice(phone, message, 'Bilingual', 'gemini-tts', 'Zephyr');
    
    if (result.success) {
      console.log('[Send] ✅ Gemini TTS succeeded');
      return { success: true };
    }
    
    console.log('[Send] ⚠️ Gemini TTS failed, sending as text...');
    const textResult = await sendText(phone, `[Voice message failed - sent as text] ${message}`);
    return { success: textResult.success, error: textResult.error, usedFallback: true };
    
  } catch (error: any) {
    console.log('[Send] ⚠️ Gemini TTS error, sending as text...');
    const textResult = await sendText(phone, `[Voice message failed - sent as text] ${message}`);
    return { success: textResult.success, error: textResult.error, usedFallback: true };
  }
};

// ============ PROCESS WHATSAPP COMMAND ============
let isSendingRef = { current: false };

const processWhatsAppCommand = async (userText: string, isVoice: boolean, contacts: any[], waStatus: string): Promise<string> => {
  if (isSendingRef.current) {
    console.log('[Process] ⛔ Already sending, ignoring duplicate');
    return 'Already sending a message...';
  }
  
  isSendingRef.current = true;
  
  try {
    console.log('[Process] Processing:', userText);
    
    const trimmed = userText.trim();
    const lowerText = trimmed.toLowerCase();
    
    if (waStatus !== 'connected') {
      return 'WhatsApp is not connected. Please go to the WhatsApp page and connect first.';
    }
    console.log('[Process] Contacts received:', contacts?.length);
    console.log('[Process] Contact names:', contacts?.map(c => c.name));
    if (!contacts || contacts.length === 0) {
      console.log('[Process] ❌ No contacts available. Contacts length:', contacts?.length);
      return 'No contacts found. Please sync your contacts first.';
    }
    
    let matchedContact = findClosestContact(trimmed, contacts);
    let contactName = '';
    
    if (matchedContact) {
      contactName = matchedContact.name;
    } else {
      for (const contact of contacts) {
        if (lowerText.includes(contact.name.toLowerCase())) {
          matchedContact = contact;
          contactName = contact.name;
          break;
        }
      }
    }
    
    if (!matchedContact) {
      return `I couldn't find that contact. Available contacts: ${contacts.map(c => c.name).join(', ')}`;
    }
    
    let cleanMessage = extractCleanMessage(trimmed, contactName);
    
    if (cleanMessage.includes('whatsapp') || cleanMessage.includes('message') || cleanMessage.includes('send') || cleanMessage.includes('to')) {
      const thatMatch = trimmed.match(/that\s+(.+)/i);
      if (thatMatch) {
        cleanMessage = thatMatch[1].trim();
      } else {
        const parts = trimmed.split(new RegExp(contactName, 'i'));
        if (parts.length > 1) {
          cleanMessage = parts[1].trim();
          cleanMessage = cleanMessage.replace(/^(that|to|send|message|voice|text)\s+/i, '');
        }
      }
    }
    
    const generatedMessage = await generatePoliteMessage(cleanMessage, contactName, 'whatsapp');
    
    console.log('[Process] Contact:', contactName, 'Phone:', matchedContact.phone);
    console.log('[Process] Clean message:', cleanMessage);
    console.log('[Process] Generated WhatsApp message:', generatedMessage);
    
    const result = await sendWhatsAppWithFallback(matchedContact.phone, generatedMessage, isVoice);
    
    if (result.success) {
      const actionText = isVoice ? (result.usedFallback ? 'voice (sent as text)' : 'voice') : 'text';
      await logAction('whatsapp', contactName, matchedContact.phone, generatedMessage, { success: true, fallback: result.usedFallback || false });
      return `✅ WhatsApp ${actionText} message sent to ${contactName}!`;
    } else {
      return `❌ Failed to send: ${result.error || 'Unknown error'}`;
    }
    
  } finally {
    setTimeout(() => {
      isSendingRef.current = false;
    }, 3000);
  }
};

function VoicePage() {
  const search = Route.useSearch();
  const { user } = useAuth();
  
  const [mode, setMode] = useState<"call" | "chat">(search.mode === "chat" ? "chat" : "call");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [muteVoice, setMuteVoice] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const contactsRef = useRef<any[]>([]);
  
  const [wakeWordDetected, setWakeWordDetected] = useState(false);
  const [isWakeWordActive, setIsWakeWordActive] = useState(false);
  
  const [waStatus, setWaStatus] = useState<'disconnected' | 'connecting' | 'qr_ready' | 'connected'>('disconnected');
  const [waPairedNumber, setWaPairedNumber] = useState<string | null>(null);
  
  const [isCalling, setIsCalling] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [liveUserText, setLiveUserText] = useState('');
  const [liveAiText, setLiveAiText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const inCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const nextPlayRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const isCallingRef = useRef(false);
  const liveUserRef = useRef('');
  const liveAiRef = useRef('');
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);
  const recogRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  const wakeWordTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const isSendingLocalRef = useRef(false);

  // ============ Live Call Functions ============
  const stopSources = useCallback(() => {
    for (const s of sourcesRef.current) { try { s.stop(); } catch { } }
    sourcesRef.current.clear();
    nextPlayRef.current = 0;
  }, []);

  const cleanupAudio = useCallback(() => {
    stopSources();
    if (processorRef.current) { try { processorRef.current.disconnect(); } catch { } processorRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => { try { t.stop(); } catch { } }); streamRef.current = null; }
    if (inCtxRef.current) { inCtxRef.current.close().catch(() => { }); inCtxRef.current = null; }
    if (outCtxRef.current) { outCtxRef.current.close().catch(() => { }); outCtxRef.current = null; }
  }, [stopSources]);

  const stopCall = useCallback(() => {
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch { }
      sessionRef.current = null;
    }
    cleanupAudio();
    setIsCalling(false);
    isCallingRef.current = false;
    setStatus('Idle');
    setLiveUserText('');
    setLiveAiText('');
  }, [cleanupAudio]);

  // ============ onMessage ============
  const onMessage = useCallback(async (msg: any) => {
    const b64 = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (b64 && outCtxRef.current) {
      const ctx = outCtxRef.current;
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { return; } }
      if (ctx.state !== 'running') return;
      try {
        const audioBuf = await pcmToAudioBuffer(b64ToUint8(b64), ctx);
        const src = ctx.createBufferSource();
        src.buffer = audioBuf;
        src.connect(ctx.destination);
        src.addEventListener('ended', () => sourcesRef.current.delete(src));
        nextPlayRef.current = Math.max(nextPlayRef.current, ctx.currentTime);
        src.start(nextPlayRef.current);
        nextPlayRef.current += audioBuf.duration;
        sourcesRef.current.add(src);
      } catch { }
    }

    const aiChunk = msg.serverContent?.outputTranscription?.text;
    if (aiChunk) {
      const romanText = convertToRomanScript(aiChunk);
      if (romanText.trim()) {
        setLiveAiText(p => p + romanText);
      }
    }
    
    const userChunk = msg.serverContent?.inputTranscription?.text;
    if (userChunk) {
      const romanText = convertToRomanScript(userChunk);
      if (romanText.trim()) {
        setLiveUserText(p => p + romanText);
        liveUserRef.current = liveUserRef.current + romanText;
      }
    }

    if (msg.serverContent?.turnComplete) {
      const u = liveUserRef.current.trim();
      let a = liveAiRef.current.trim();
      
      if (u && !isSendingLocalRef.current) {
        const lowerText = u.toLowerCase();
        
        // Check for email command
        if (lowerText.includes('email') || lowerText.includes('mail')) {
          console.log('[Gemini Live] 📧 Email command detected');
          console.log('[Gemini Live] Raw text:', u);
          
          let matchedContact = findClosestContact(u, contactsRef.current);
          let contactName = '';
          
          if (matchedContact) {
            contactName = matchedContact.name;
          } else {
            for (const contact of contactsRef.current) {
              if (lowerText.includes(contact.name.toLowerCase())) {
                matchedContact = contact;
                contactName = contact.name;
                break;
              }
            }
          }
          
          if (!matchedContact) {
            const errorMsg = `I couldn't find a contact. Available: ${contactsRef.current.map(c => c.name).join(', ')}`;
            try { sessionRef.current?.sendRealtimeInput([{ text: errorMsg }]); } catch {}
            console.log('[Gemini Live] Result:', errorMsg);
            setLiveUserText('');
            setLiveAiText('');
            liveUserRef.current = '';
            liveAiRef.current = '';
            return;
          }
          
          if (!matchedContact.email) {
            const errorMsg = `I couldn't find an email address for ${contactName}. Please add their email in contacts.`;
            try { sessionRef.current?.sendRealtimeInput([{ text: errorMsg }]); } catch {}
            console.log('[Gemini Live] Result:', errorMsg);
            setLiveUserText('');
            setLiveAiText('');
            liveUserRef.current = '';
            liveAiRef.current = '';
            return;
          }
          
          let cleanMessage = extractCleanMessage(u, contactName);
          
          if (cleanMessage.includes('email') || cleanMessage.includes('send') || cleanMessage.includes('to')) {
            const thatMatch = u.match(/that\s+(.+)/i);
            if (thatMatch) {
              cleanMessage = thatMatch[1].trim();
            } else {
              const parts = u.split(new RegExp(contactName, 'i'));
              if (parts.length > 1) {
                cleanMessage = parts[1].trim();
                cleanMessage = cleanMessage.replace(/^(that|to|send|email|mail|message)\s+/i, '');
              }
            }
          }
          
          const generatedMessage = await generatePoliteMessage(cleanMessage, contactName, 'email');
          
          const emailSubject = generatedMessage.length > 50 
            ? generatedMessage.substring(0, 47) + '...' 
            : generatedMessage;
          
          console.log('[Voice] 📧 Sending email to:', matchedContact.email);
          console.log('[Voice] 📧 Subject:', emailSubject);
          console.log('[Voice] 📧 Body:', generatedMessage);
          
          const emailResult = await sendEmail(matchedContact.email, contactName, emailSubject, generatedMessage);
          
          if (emailResult.success) {
            const successMsg = `✅ Email sent to ${contactName} (${matchedContact.email})!`;
            try { sessionRef.current?.sendRealtimeInput([{ text: successMsg }]); } catch {}
            console.log('[Gemini Live] Result:', successMsg);
            await logAction('email', contactName, matchedContact.email, generatedMessage, { success: true });
          } else {
            const errorMsg = `❌ Failed to send email: ${emailResult.error || 'Unknown error'}`;
            try { sessionRef.current?.sendRealtimeInput([{ text: errorMsg }]); } catch {}
            console.log('[Gemini Live] Result:', errorMsg);
          }
          
          setLiveUserText('');
          setLiveAiText('');
          liveUserRef.current = '';
          liveAiRef.current = '';
          return;
        }
        
        // Check for WhatsApp command
        const whatsappKeywords = ['whatsapp', 'whats app', 'message', 'send', 'text', 'voice', 'call', 'میسج', 'واٹس'];
        const isWhatsApp = whatsappKeywords.some(keyword => lowerText.includes(keyword));
        
        if (isWhatsApp) {
          console.log('[Gemini Live] 🔴 WhatsApp command detected');
          const isVoice = lowerText.includes('voice') || lowerText.includes('audio') || lowerText.includes('speak');
          const result = await processWhatsAppCommand(u, isVoice, contactsRef.current, waStatus);
          if (result) {
            console.log('[Gemini Live] Result:', result);
            try {
              sessionRef.current?.sendRealtimeInput([{ text: result }]);
            } catch (e) {
              console.error('[Gemini Live] Failed to send response:', e);
            }
          }
          setLiveUserText('');
          setLiveAiText('');
          liveUserRef.current = '';
          liveAiRef.current = '';
          return;
        }
      }
      
      // Process AI response with file generation
      if (a) {
        const { processed } = extractAndGenerateFile(a);
        a = processed;
      }
      
      if (a) {
        const { hasEmail, to, subject, body, processed } = extractEmailCommand(a);
        a = processed;
        if (hasEmail && to) {
          await sendEmailToContact(to, subject, body);
        }
      }
      
      if (u) setMessages(prev => [...prev, { role: "user", content: u }]);
      if (a) setMessages(prev => [...prev, { role: "assistant", content: a }]);
      setLiveUserText('');
      setLiveAiText('');
      liveUserRef.current = '';
      liveAiRef.current = '';
    }
    if (msg.serverContent?.interrupted) stopSources();
  }, [stopSources, waStatus]);

  // ============ EFFECTS ============
  useEffect(() => {
    if (waStatus === 'connected') {
      toast.success('WhatsApp connected successfully!');
    }
  }, [waStatus]);

  useEffect(() => {
    if (user) {
      loadContacts();
      checkWhatsAppStatus();
    }
  }, [user]);

  const loadContacts = async () => {
  try {
    console.log('[Voice] Loading contacts for user:', user?.id);
    console.log('[Voice] User object:', user);
    
    if (!user?.id) {
      console.log('[Voice] No user ID, cannot load contacts');
      return;
    }
    
    // First try to get contacts from Supabase
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', user.id);
    
    let loadedContacts: any[] = [];
    
    if (error) {
      console.error('[Voice] Error loading contacts from Supabase:', error);
      // Fallback to mock contacts
      const mockContacts = await getAllContacts();
      loadedContacts = mockContacts;
      console.log('[Voice] Using mock contacts:', loadedContacts.length);
    } else if (data && data.length > 0) {
      loadedContacts = data;
      console.log('[Voice] Loaded contacts from DB:', data.length);
      console.log('[Voice] Contacts from DB:', data.map(c => ({ name: c.name, phone: c.phone })));
    } else {
      // No contacts in DB, use mock
      console.log('[Voice] No contacts in DB, using mock');
      const mockContacts = await getAllContacts();
      loadedContacts = mockContacts;
      console.log('[Voice] Using mock contacts:', loadedContacts.length);
    }
    
    // ✅ IMPORTANT: Update BOTH state and ref
    setContacts(loadedContacts);
    contactsRef.current = loadedContacts;
    
    console.log('[Voice] ✅ Contacts loaded successfully. Total:', loadedContacts.length);
    console.log('[Voice] contactsRef.current has:', contactsRef.current.length, 'contacts');
    
  } catch (error) {
    console.error('[Voice] Error loading contacts:', error);
    const mockContacts = await getAllContacts();
    setContacts(mockContacts);
    contactsRef.current = mockContacts;
    console.log('[Voice] Using fallback mock contacts:', mockContacts.length);
  }
};

  const checkWhatsAppStatus = async () => {
    try {
      const result = await getStatus();
      if (result.success && result.data) {
        setWaStatus(result.data.status);
        if (result.data.pairedUser) setWaPairedNumber(result.data.pairedUser);
        console.log('[Voice] WhatsApp status:', result.data.status);
      }
    } catch (error) {
      console.error('Status check failed:', error);
    }
  };

  useEffect(() => { isCallingRef.current = isCalling; }, [isCalling]);
  useEffect(() => { liveUserRef.current = liveUserText; }, [liveUserText]);
  useEffect(() => { liveAiRef.current = liveAiText; }, [liveAiText]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, liveAiText, liveUserText]);

  // ============ FILE EXTRACTION WITH AUTO DOWNLOAD ============
  const extractAndGenerateFile = (response: string): { processed: string; hasFile: boolean } => {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;
    let hasFile = false;
    let processed = response;
    
    const langMap: Record<string, { ext: string; name: string }> = {
      'javascript': { ext: 'js', name: 'script' },
      'js': { ext: 'js', name: 'script' },
      'typescript': { ext: 'ts', name: 'script' },
      'ts': { ext: 'ts', name: 'script' },
      'python': { ext: 'py', name: 'script' },
      'py': { ext: 'py', name: 'script' },
      'cpp': { ext: 'cpp', name: 'program' },
      'c++': { ext: 'cpp', name: 'program' },
      'java': { ext: 'java', name: 'Main' },
      'html': { ext: 'html', name: 'page' },
      'css': { ext: 'css', name: 'styles' },
      'jsx': { ext: 'jsx', name: 'Component' },
      'tsx': { ext: 'tsx', name: 'Component' },
      'json': { ext: 'json', name: 'data' },
      'csv': { ext: 'csv', name: 'spreadsheet' },
      'word': { ext: 'doc', name: 'document' },
      'docx': { ext: 'doc', name: 'document' },
      'powerpoint': { ext: 'ppt', name: 'presentation' },
      'pptx': { ext: 'ppt', name: 'presentation' },
      'ppt': { ext: 'ppt', name: 'presentation' },
      'pdf': { ext: 'pdf', name: 'document' },
      'go': { ext: 'go', name: 'main' },
      'rs': { ext: 'rs', name: 'main' },
      'rust': { ext: 'rs', name: 'main' },
      'rb': { ext: 'rb', name: 'script' },
      'ruby': { ext: 'rb', name: 'script' },
      'php': { ext: 'php', name: 'index' },
      'sql': { ext: 'sql', name: 'query' },
      'sh': { ext: 'sh', name: 'script' },
      'bash': { ext: 'sh', name: 'script' },
      'swift': { ext: 'swift', name: 'main' },
      'kt': { ext: 'kt', name: 'Main' },
      'kotlin': { ext: 'kt', name: 'Main' },
      'dart': { ext: 'dart', name: 'main' },
      'xml': { ext: 'xml', name: 'data' },
      'yaml': { ext: 'yaml', name: 'config' },
      'yml': { ext: 'yml', name: 'config' },
      'md': { ext: 'md', name: 'README' },
      'markdown': { ext: 'md', name: 'README' },
      'txt': { ext: 'txt', name: 'file' },
      'text': { ext: 'txt', name: 'file' },
    };
    
    while ((match = codeBlockRegex.exec(response)) !== null) {
      const lang = (match[1] || 'txt').toLowerCase().trim();
      const code = match[2].trim();
      
      if (!code) continue;
      
      const langInfo = langMap[lang] || { ext: lang || 'txt', name: 'file' };
      const timestamp = Date.now();
      const filename = `${langInfo.name}_${timestamp}.${langInfo.ext}`;
      
      let blob: Blob | null = null;
      
      if (lang === 'csv') {
        try {
          const rows = code.split('\n').filter(line => line.trim()).map(line => line.split(',').map(c => c.trim()));
          blob = generateCSV(rows, filename);
        } catch (e) {
          blob = generateCodeFile(code, filename);
        }
      } else if (lang === 'word' || lang === 'docx') {
        blob = generateWordDoc(code, filename);
      } else if (lang === 'powerpoint' || lang === 'pptx' || lang === 'ppt') {
        blob = generatePowerPoint(code, filename);
      } else if (lang === 'pdf') {
        blob = generatePDF(code, filename);
      } else {
        blob = generateCodeFile(code, filename);
      }
      
      if (blob) {
        downloadFile(blob, filename);
        hasFile = true;
        const downloadLink = `\n\n📎 **File downloaded:** ${filename}`;
        processed = processed.replace(match[0], match[0] + downloadLink);
        console.log(`[File] Generated and downloaded: ${filename}`);
      }
    }
    
    return { processed, hasFile };
  };

  const extractEmailCommand = (response: string): { hasEmail: boolean; to?: string; subject?: string; body?: string; processed: string } => {
    const emailRegex = /\[EMAIL:([^\]]+)\]/i;
    const match = response.match(emailRegex);
    
    if (match) {
      const emailContent = match[1];
      const parts = emailContent.split('|');
      const to = parts[0]?.trim();
      const subject = parts[1]?.trim() || "Message from Zoe";
      const body = parts[2]?.trim() || emailContent;
      
      return {
        hasEmail: true,
        to,
        subject,
        body,
        processed: response.replace(match[0], `\n\n✉️ **Preparing email to ${to}...**`)
      };
    }
    
    return { hasEmail: false, processed: response };
  };

  // ============ WAKE WORD DETECTION ============
  const detectWakeWord = (text: string): boolean => {
    const lowerText = text.toLowerCase();
    const wakePatterns = ['hey zoe', 'hi zoe', 'hello zoe', 'hey zoey'];
    
    for (const pattern of wakePatterns) {
      if (lowerText.includes(pattern)) {
        console.log(`🎤 [WAKE WORD DETECTED] "${pattern}" found in: "${text}"`);
        return true;
      }
    }
    return false;
  };

  // ============ HANDLE USER INPUT ============
  const handleUserInput = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    
    console.log('[Voice] Processing input:', trimmed);
    
    const userMsg: Msg = { role: "user", content: trimmed };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setThinking(true);
    
    try {
      const lowerText = trimmed.toLowerCase();
      
      // Check for email command
      if (lowerText.includes('email') || lowerText.includes('mail')) {
        console.log('[Voice] 📧 Email command detected');
        console.log('[Voice] Raw text:', trimmed);
        
        let matchedContact = findClosestContact(trimmed, contacts);
        let contactName = '';
        
        if (matchedContact) {
          contactName = matchedContact.name;
        } else {
          for (const contact of contacts) {
            if (lowerText.includes(contact.name.toLowerCase())) {
              matchedContact = contact;
              contactName = contact.name;
              break;
            }
          }
        }
        
        if (!matchedContact) {
          const errorMsg = `I couldn't find a contact. Available: ${contacts.map(c => c.name).join(', ')}`;
          setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
          speak(errorMsg);
          setThinking(false);
          return;
        }
        
        if (!matchedContact.email) {
          const errorMsg = `I couldn't find an email address for ${contactName}. Please add their email in contacts.`;
          setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
          speak(errorMsg);
          setThinking(false);
          return;
        }
        
        let cleanMessage = extractCleanMessage(trimmed, contactName);
        
        if (cleanMessage.includes('email') || cleanMessage.includes('send') || cleanMessage.includes('to')) {
          const thatMatch = trimmed.match(/that\s+(.+)/i);
          if (thatMatch) {
            cleanMessage = thatMatch[1].trim();
          } else {
            const parts = trimmed.split(new RegExp(contactName, 'i'));
            if (parts.length > 1) {
              cleanMessage = parts[1].trim();
              cleanMessage = cleanMessage.replace(/^(that|to|send|email|mail|message)\s+/i, '');
            }
          }
        }
        
        const generatedMessage = await generatePoliteMessage(cleanMessage, contactName, 'email');
        
        const emailSubject = generatedMessage.length > 50 
          ? generatedMessage.substring(0, 47) + '...' 
          : generatedMessage;
        
        console.log('[Voice] 📧 Sending email to:', matchedContact.email);
        console.log('[Voice] 📧 Subject:', emailSubject);
        console.log('[Voice] 📧 Body:', generatedMessage);
        
        setMessages(prev => [...prev, { 
          role: "assistant", 
          content: `📧 Generating email to ${contactName}...` 
        }]);
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const emailResult = await sendEmail(matchedContact.email, contactName, emailSubject, generatedMessage);
        
        if (emailResult.success) {
          const successMsg = `✅ Email sent to ${contactName} (${matchedContact.email})!`;
          setMessages(prev => {
            const filtered = prev.filter(m => !m.content.includes('Generating email'));
            return [...filtered, { role: "assistant", content: successMsg }];
          });
          speak(successMsg);
          toast.success(successMsg);
          await logAction('email', contactName, matchedContact.email, generatedMessage, { success: true });
        } else {
          const errorMsg = `❌ Failed to send email: ${emailResult.error || 'Unknown error'}`;
          setMessages(prev => {
            const filtered = prev.filter(m => !m.content.includes('Generating email'));
            return [...filtered, { role: "assistant", content: errorMsg }];
          });
          speak(errorMsg);
          toast.error(errorMsg);
        }
        
        setThinking(false);
        return;
      }
      
      // Check for WhatsApp command
      const isWhatsApp = lowerText.includes('whatsapp') || 
                         lowerText.includes('whats app') || 
                         lowerText.includes('message') || 
                         lowerText.includes('send') ||
                         lowerText.includes('text') ||
                         lowerText.includes('voice') ||
                         lowerText.includes('call') ||
                         lowerText.includes('میسج') ||
                         lowerText.includes('واٹس');
      
      if (isWhatsApp && !isSendingLocalRef.current) {
        console.log('[Voice] 🔴 WhatsApp/Call command detected');
        const isVoice = lowerText.includes('voice') || lowerText.includes('speak') || lowerText.includes('audio');
        const isCall = lowerText.includes('call') && !isVoice;
        
        let matchedContact = findClosestContact(trimmed, contacts);
        let contactName = '';
        
        if (matchedContact) {
          contactName = matchedContact.name;
        } else {
          for (const contact of contacts) {
            if (lowerText.includes(contact.name.toLowerCase())) {
              matchedContact = contact;
              contactName = contact.name;
              break;
            }
          }
        }
        
        if (!matchedContact) {
          const errorMsg = `I couldn't find a contact. Available: ${contacts.map(c => c.name).join(', ')}`;
          setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
          speak(errorMsg);
          setThinking(false);
          return;
        }
        
        let cleanMessage = extractCleanMessage(trimmed, contactName);
        
        if (cleanMessage.includes('whatsapp') || cleanMessage.includes('message') || cleanMessage.includes('send') || cleanMessage.includes('to')) {
          const thatMatch = trimmed.match(/that\s+(.+)/i);
          if (thatMatch) {
            cleanMessage = thatMatch[1].trim();
          } else {
            const parts = trimmed.split(new RegExp(contactName, 'i'));
            if (parts.length > 1) {
              cleanMessage = parts[1].trim();
              cleanMessage = cleanMessage.replace(/^(that|to|send|message|voice|text)\s+/i, '');
            }
          }
        }
        
        const generatedMessage = await generatePoliteMessage(cleanMessage, contactName, 'whatsapp');
        
        console.log('[Voice] Contact:', contactName, 'Phone:', matchedContact.phone);
        console.log('[Voice] Clean message:', cleanMessage);
        console.log('[Voice] Generated WhatsApp message:', generatedMessage);
        
        let result;
        if (isCall) {
          console.log('[Voice] 📞 Making call to:', matchedContact.phone);
          result = await makeCall(matchedContact.phone, contactName, generatedMessage || `Hello ${contactName}, this is Abdullah's assistant Zoe.`);
        } else {
          result = await sendWhatsAppWithFallback(matchedContact.phone, generatedMessage, isVoice);
        }
        
        if (result && result.success) {
          const actionText = isCall ? 'call' : (isVoice ? (result.usedFallback ? 'voice (sent as text)' : 'voice') : 'text');
          const successMsg = `✅ WhatsApp ${actionText} sent to ${contactName}!`;
          setMessages(prev => [...prev, { role: "assistant", content: successMsg }]);
          speak(successMsg);
          toast.success(successMsg);
          await logAction('whatsapp', contactName, matchedContact.phone, generatedMessage, { success: true });
        } else {
          const errorMsg = `❌ Failed to send: ${result?.error || 'Unknown error'}`;
          setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
          speak(errorMsg);
          toast.error(errorMsg);
        }
        
        setThinking(false);
        return;
      }
      
      // ============================================
      // USE INTENT EXTRACTION FOR OTHER COMMANDS
      // ============================================
      console.log('[Voice] Using Gemini intent extraction');
      const intentResult = await extractIntent(trimmed, contacts);
      
      if (intentResult.success && intentResult.data) {
        const intent = intentResult.data.extraction || intentResult.data;
        console.log('[Voice] Parsed intent:', intent);
        
        if (intent.action && intent.contactName) {
          let matchedContact = null;
          for (const contact of contacts) {
            if (contact.name.toLowerCase().includes(intent.contactName.toLowerCase())) {
              matchedContact = contact;
              break;
            }
          }
          
          if (matchedContact) {
            const targetPhone = matchedContact.phone;
            const targetEmail = matchedContact.email;
            const targetName = matchedContact.name;
            
            if (intent.action === 'email') {
              if (!targetEmail) {
                const errorMsg = `I couldn't find an email address for ${targetName}. Please add their email in contacts.`;
                setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
                speak(errorMsg);
                setThinking(false);
                return;
              }
              
              const cleanMessage = intent.message || `Hello ${targetName}, this is a message from Abdullah via Zoe Assistant.`;
              
              const generatedMessage = await generatePoliteMessage(cleanMessage, targetName, 'email');
              
              const emailSubject = generatedMessage.length > 50 
                ? generatedMessage.substring(0, 47) + '...' 
                : generatedMessage;
              
              console.log('[Voice] 📧 Sending email to:', targetEmail);
              const emailResult = await sendEmail(targetEmail, targetName, emailSubject, generatedMessage);
              
              if (emailResult.success) {
                const successMsg = `✅ Email sent to ${targetName} (${targetEmail})!`;
                setMessages(prev => [...prev, { role: "assistant", content: successMsg }]);
                speak(successMsg);
                toast.success(successMsg);
                await logAction('email', targetName, targetEmail, generatedMessage, { success: true });
              } else {
                const errorMsg = `❌ Failed to send email: ${emailResult.error || 'Unknown error'}`;
                setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
                speak(errorMsg);
                toast.error(errorMsg);
              }
              setThinking(false);
              return;
            }
            
            if (intent.action === 'call') {
              const callResult = await makeCall(targetPhone, targetName, intent.message || `Hello ${targetName}, this is Abdullah's assistant Zoe.`);
              if (callResult.success) {
                const successMsg = `📞 Calling ${targetName} at ${targetPhone}...`;
                setMessages(prev => [...prev, { role: "assistant", content: successMsg }]);
                speak(successMsg);
                await logAction('call', targetName, targetPhone, intent.message, { success: true });
              } else {
                const errorMsg = `❌ Failed to call ${targetName}: ${callResult.error || 'Unknown error'}`;
                setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
                speak(errorMsg);
                toast.error(errorMsg);
              }
              setThinking(false);
              return;
            }
            
            if (intent.action === 'voice_message' || intent.action === 'text') {
              const isVoice = intent.action === 'voice_message';
              const cleanMessage = intent.message || `Hi ${targetName}`;
              
              const generatedMessage = await generatePoliteMessage(cleanMessage, targetName, 'whatsapp');
              
              const result = await sendWhatsAppWithFallback(targetPhone, generatedMessage, isVoice);
              
              if (result.success) {
                const actionText = isVoice ? (result.usedFallback ? 'voice (sent as text)' : 'voice') : 'text';
                const successMsg = `✅ WhatsApp ${actionText} sent to ${targetName}!`;
                setMessages(prev => [...prev, { role: "assistant", content: successMsg }]);
                speak(successMsg);
                toast.success(successMsg);
                await logAction('whatsapp', targetName, targetPhone, generatedMessage, { success: true });
              } else {
                const errorMsg = `❌ Failed to send: ${result?.error || 'Unknown error'}`;
                setMessages(prev => [...prev, { role: "assistant", content: errorMsg }]);
                speak(errorMsg);
                toast.error(errorMsg);
              }
              setThinking(false);
              return;
            }
          }
        }
      }
      
      // ============================================
      // FALLBACK - NORMAL CHAT WITH GEMINI
      // ============================================
      console.log('[Voice] Falling back to Gemini chat');
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      history.push({ role: "user", content: trimmed });
      
      let aiResponse = await chatWithGemini(history);
      const { processed } = extractAndGenerateFile(aiResponse);
      aiResponse = processed;
      
      const { hasEmail, to, subject, body, processed: emailProcessed } = extractEmailCommand(aiResponse);
      aiResponse = emailProcessed;
      if (hasEmail && to) {
        await sendEmailToContact(to, subject, body);
      }
      
      const assistantMsg: Msg = { role: "assistant", content: aiResponse };
      setMessages(prev => [...prev, assistantMsg]);
      speak(aiResponse);
      
    } catch (error) {
      console.error("Chat error:", error);
      const errorMsg = { role: "assistant" as const, content: "Sorry, I'm having trouble. Please try again." };
      setMessages(prev => [...prev, errorMsg]);
      speak(errorMsg.content);
    } finally {
      setThinking(false);
    }
  };

  // ============ SPEECH RECOGNITION ============
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    if (recogRef.current) {
      try {
        recogRef.current.stop();
        recogRef.current = null;
      } catch (e) {}
    }
    
    if (mode === "call") {
      console.log('[Speech] Web Speech API disabled in call mode');
      setListening(false);
      isListeningRef.current = false;
      return;
    }
    
    console.log('[Speech] Web Speech API enabled in chat mode');
    
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Voice not supported");
      return;
    }
    
    const r = new SR();
    r.lang = "en-US";
    r.continuous = false;
    r.interimResults = false;
    
    console.log('[Speech] Language forced to: en-US');
    
    r.onresult = async (e: any) => {
      const text = e.results[0][0].transcript;
      console.log(`[Speech] User said: "${text}"`);
      
      const lowerText = text.toLowerCase();
      const wakePatterns = ['hey zoe', 'hi zoe', 'hello zoe', 'hey zoey'];
      let isWake = false;
      
      for (const pattern of wakePatterns) {
        if (lowerText.includes(pattern)) {
          isWake = true;
          break;
        }
      }
      
      if (isWake) {
        console.log('[Wake Word] 🎤 Wake word detected!');
        setWakeWordDetected(true);
        setIsWakeWordActive(true);
        
        if (wakeWordTimerRef.current) {
          clearTimeout(wakeWordTimerRef.current);
        }
        
        wakeWordTimerRef.current = setTimeout(() => {
          setIsWakeWordActive(false);
          setWakeWordDetected(false);
          console.log('[Wake Word] Deactivated after timeout');
        }, 15000);
        
        const greeting = "Assalamualaikum! I'm Zoe. How can I help you today?";
        setMessages(prev => [...prev, { role: "assistant", content: greeting }]);
        speak(greeting);
        
        setListening(false);
        isListeningRef.current = false;
        return;
      }
      
      if (wakeWordTimerRef.current) {
        clearTimeout(wakeWordTimerRef.current);
        wakeWordTimerRef.current = setTimeout(() => {
          setIsWakeWordActive(false);
          setWakeWordDetected(false);
          console.log('[Wake Word] Deactivated after timeout');
        }, 15000);
      }
      
      setListening(false);
      isListeningRef.current = false;
      
      if (text.trim() && !isCalling && mode === "chat") {
        await handleUserInput(text);
      }
    };
    
    r.onerror = () => { 
      setListening(false); 
      isListeningRef.current = false; 
    };
    r.onend = () => { 
      setListening(false); 
      isListeningRef.current = false;
    };
    recogRef.current = r;
    
    return () => { 
      try { r.stop(); } catch {} 
      if (wakeWordTimerRef.current) {
        clearTimeout(wakeWordTimerRef.current);
      }
    };
  }, [isCalling, contacts, mode, waStatus]);

  const startListening = () => {
    if (!recogRef.current || isCalling) return;
    if (isListeningRef.current) return;
    try {
      recogRef.current.start();
      setListening(true);
      isListeningRef.current = true;
      toast.info("Listening...");
    } catch (err) {
      console.error("Start listening error:", err);
    }
  };

  const stopListening = () => {
    if (recogRef.current) {
      try {
        recogRef.current.stop();
      } catch {}
    }
    setListening(false);
    isListeningRef.current = false;
  };

  const speak = (text: string) => {
    if (mode === "call") {
      console.log('[TTS] Disabled in call mode');
      return;
    }
    
    if (muteVoice || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const cleaned = text.replace(/وجہ[\s\S]*$/u, "").replace(/^Answer:\s*/i, "").trim() || text;
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.rate = 1.02;
    utterance.pitch = 1.05;
    utterance.lang = "en-US";
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const sendChat = async (text: string) => {
    await handleUserInput(text);
  };

  useEffect(() => {
    if (sentInitial.current) return;
    if (search.q && !isCalling && mode === "chat") {
      sentInitial.current = true;
      setTimeout(() => void handleUserInput(search.q!), 500);
    }
  }, [search.q, isCalling, mode]);

  useEffect(() => {
    return () => { if (isCalling) stopCall(); };
  }, [isCalling, stopCall]);

  // ============ START CALL ============
  const startCall = useCallback(async () => {
    if (mode !== "call") {
      console.log('[Voice] ⛔ Gemini Live only in call mode');
      return;
    }
    
    if (isCallingRef.current) return;
    if (!user) {
      toast.error("Please sign in first");
      return;
    }
    
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch {}
      sessionRef.current = null;
    }
    
    setIsCalling(true);
    isCallingRef.current = true;
    setError(null);
    setStatus('Connecting...');
    setMessages([]);
    setLiveUserText('');
    setLiveAiText('');
    liveUserRef.current = '';
    liveAiRef.current = '';

    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000, channelCount: 1 }
      });
      inCtxRef.current = new AudioContext({ sampleRate: 16000 });
      outCtxRef.current = new AudioContext({ sampleRate: 24000 });
      await inCtxRef.current.resume();
      await outCtxRef.current.resume();

      const ai = await getGenAIInstance();

      const session = await ai.live.connect({
        model: GEMINI_LIVE_MODEL,
        callbacks: {
          onopen: () => {
            setStatus('Live');
            toast.success("Connected to Zoe");
            const greeting = "Assalamualaikum! I'm Zoe. How can I help you today?";
            setMessages([{ role: "assistant", content: greeting }]);
            try { sessionRef.current?.sendRealtimeInput([{ text: greeting }]); } catch { }

            if (inCtxRef.current && streamRef.current) {
              const src = inCtxRef.current.createMediaStreamSource(streamRef.current);
              processorRef.current = inCtxRef.current.createScriptProcessor(4096, 1, 1);
              processorRef.current.onaudioprocess = (e) => {
                if (!sessionRef.current || inCtxRef.current?.state !== 'running') return;
                try { sessionRef.current.sendRealtimeInput({ media: pcmToBlob(e.inputBuffer.getChannelData(0)) }); } catch { }
              };
              src.connect(processorRef.current);
              const silent = inCtxRef.current.createGain();
              silent.gain.value = 0;
              processorRef.current.connect(silent);
              silent.connect(inCtxRef.current.destination);
            }
          },
          onmessage: onMessage,
          onerror: (e: any) => {
            const msg = e?.message || '';
            if (msg.includes('403') || msg.includes('key')) {
              setError('API key error — Your Gemini key does not have Live API access.');
              toast.error('Live API not enabled on this API key');
            } else {
              setError('Connection error. Check your internet.');
            }
            stopCall();
          },
          onclose: () => { setStatus('Offline'); if (isCallingRef.current) stopCall(); },
        },
        config: {
          responseModalities: ["AUDIO"],
          inputAudioTranscription: {
            language: "en-US",
          },
          outputAudioTranscription: {
            language: "en-US",
          },
          speechConfig: { 
            voiceConfig: { 
              prebuiltVoiceConfig: { voiceName: 'Zephyr' } 
            } 
          },
          systemInstruction: ZOE_SYSTEM,
        },
      });

      sessionRef.current = session;

    } catch (err: any) {
      if (err?.name === 'NotAllowedError') {
        setError('Microphone access denied. Allow mic in browser settings.');
      } else if (err?.message?.includes('403') || err?.message?.includes('key')) {
        setError('API key error — Your Gemini key needs Live API access.');
      } else {
        setError(`Failed to connect: ${err?.message || 'Unknown error'}`);
      }
      stopCall();
    }
  }, [mode, onMessage, stopCall, user]);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="aurora-bg" />

      <header className="relative z-10 flex items-center justify-between p-6">
        <Link to="/" className="glass-pill flex h-10 w-10 items-center justify-center transition-transform hover:scale-110">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        
        <div className="glass-pill flex items-center gap-2 px-4 py-2 text-xs">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Zoe 
          {user ? (
            <span className="ml-1 text-[10px] text-green-500">● Online</span>
          ) : (
            <Link to="/login" className="ml-1 text-[10px] text-yellow-500 underline">Sign in</Link>
          )}
          {waStatus === 'connected' && (
            <span className="ml-1 text-[10px] text-green-500">● WA</span>
          )}
          {wakeWordDetected && (
            <span className="ml-1 text-[10px] text-green-500 animate-pulse">🎤 Listening...</span>
          )}
          {listening && (
            <span className="ml-1 text-[10px] text-green-500 animate-pulse">🎤 Mic...</span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={() => setMuteVoice((m) => !m)}
            className="glass-pill flex h-10 w-10 items-center justify-center"
            aria-label={muteVoice ? "Unmute" : "Mute"}
          >
            {muteVoice ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <div className="relative z-20 mx-auto -mt-2 flex w-fit gap-1 rounded-full glass p-1 text-sm">
        {(["call", "chat"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { if (isCalling) stopCall(); setMode(m); }}
            className={`rounded-full px-5 py-1.5 capitalize transition ${
              mode === m ? "btn-gradient" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "call" ? "Live Call" : "Chat"}
          </button>
        ))}
      </div>

      <main className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6 pb-32 pt-6">
        {mode === "call" ? (
          <div className="flex w-full flex-col items-center pt-2 animate-fade-in">
            <Orb size={220} active={isCalling && status === "Live"} />

            <div className="mt-10 min-h-[6rem] max-w-xl text-center">
              {messages.length > 0 ? (
                <>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Zoe says</p>
                  <p className="mt-2 whitespace-pre-line text-balance text-lg leading-relaxed">
                    {messages[messages.length - 1].content}
                  </p>
                </>
              ) : (
                <p className="text-balance text-xl text-muted-foreground">
                  Tap the phone button to start a live call with Zoe
                </p>
              )}
            </div>

            {(liveUserText || liveAiText) && (
              <div className="mt-4 w-full max-w-md text-center">
                {liveUserText && <p className="text-sm text-muted-foreground animate-pulse">You: {liveUserText}</p>}
                {liveAiText && <p className="text-sm text-cyan-400 animate-pulse">Zoe: {liveAiText}</p>}
              </div>
            )}

            <div className="mt-10 flex flex-col items-center">
              <div className="mb-3 h-6">
                <VoiceBars active={isCalling && status === "Live"} bars={28} />
              </div>
              <p className="mb-4 text-sm text-muted-foreground">
                {error ? error : isCalling ? (status === "Live" ? "Live call in progress" : status) : "Ready to call"}
              </p>

              {error && (
                <div className="mt-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center max-w-md">
                  {error}
                </div>
              )}

              <div className="flex gap-4">
                {!isCalling ? (
                  <button
                    onClick={startCall}
                    disabled={!user}
                    className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-emerald-600 shadow-2xl shadow-green-500/30 transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
                  >
                    <Phone className="h-10 w-10 text-white" />
                    <span className="absolute inset-0 rounded-full animate-ping bg-green-500/40" />
                  </button>
                ) : (
                  <button
                    onClick={stopCall}
                    className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-rose-600 shadow-2xl shadow-red-500/30 transition-all hover:scale-105 active:scale-95"
                  >
                    <PhoneOff className="h-10 w-10 text-white" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex w-full flex-col items-center pt-2">
            <Orb size={200} active={listening || speaking || thinking} />

            <div className="mt-8 w-full min-h-[200px] max-h-[400px] overflow-y-auto space-y-3 px-2">
              {messages.length === 0 && (
                <div className="text-center text-muted-foreground text-sm">
                  <p>Say <span className="text-green-400 font-bold">"Hey Zoe"</span> to activate, or type your question!</p>
                  <div className="flex flex-wrap gap-2 justify-center mt-3">
                    {['📞 Make calls', '💬 Send WhatsApp text', '🎤 Send WhatsApp voice', '📄 Generate files', '📧 Send emails'].map((item) => (
                      <span key={item} className="text-xs glass-pill px-2 py-1">{item}</span>
                    ))}
                  </div>
                  {waStatus !== 'connected' && (
                    <div className="mt-2 text-xs text-amber-400">
                      ⚠️ WhatsApp not connected. Go to WhatsApp page to connect.
                    </div>
                  )}
                  {wakeWordDetected && (
                    <div className="mt-2 text-xs text-green-400 animate-pulse">
                      🎤 Zoe is listening...
                    </div>
                  )}
                  {listening && (
                    <div className="mt-2 text-xs text-green-400 animate-pulse">
                      🎤 Mic active... Speak now!
                    </div>
                  )}
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                    m.role === "user" ? "btn-gradient text-primary-foreground" : "glass text-foreground"
                  }`}>
                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="flex justify-start">
                  <div className="glass rounded-2xl px-4 py-2 text-sm">
                    <span className="animate-pulse">● ● ●</span>
                  </div>
                </div>
              )}
              <div ref={scrollRef} />
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={listening ? stopListening : startListening}
                disabled={thinking || isCalling}
                className={`relative flex h-16 w-16 items-center justify-center rounded-full transition-all ${
                  listening ? "btn-gradient scale-110 animate-pulse" : "glass"
                } disabled:opacity-50`}
                title={listening ? "Stop listening" : "Press to speak"}
              >
                {listening ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
              </button>
            </div>

            <div className="mt-4 w-full max-w-md">
              <form onSubmit={(e) => { e.preventDefault(); sendChat(input); }} className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type or speak your request..."
                  className="flex-1 glass rounded-full px-4 py-2 text-sm outline-none"
                />
                <button type="submit" disabled={!input.trim() || thinking} className="btn-gradient rounded-full px-4 py-2 text-sm disabled:opacity-50">
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default VoicePage;