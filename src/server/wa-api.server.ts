// src/server/wa-api.server.ts
import { waManager } from './wa-manager';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

// Get WhatsApp status
export const getWhatsAppStatus = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const status = waManager.getStatus(userId);
    const qrCode = waManager.getQRCode(userId);
    const pairedNumber = waManager.getPairedNumber(userId);
    return { status, qrCode, pairedNumber };
  });

// Initialize WhatsApp
export const initWhatsApp = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const result = await waManager.initializeSession(userId);
    return result;
  });

// Disconnect WhatsApp
export const disconnectWhatsApp = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    await waManager.disconnect(userId);
    return { success: true };
  });

// Send WhatsApp text
export const sendWhatsAppText = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({
    phone: z.string().min(10),
    text: z.string().min(1),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const result = await waManager.sendTextMessage(userId, data.phone, data.text);
    return { success: true, result };
  });

// Send WhatsApp voice
export const sendWhatsAppVoice = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({
    phone: z.string().min(10),
    audio: z.string(), // base64 audio
  }).parse(data))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const audioBuffer = Buffer.from(data.audio, 'base64');
    const result = await waManager.sendVoiceMessage(userId, data.phone, audioBuffer);
    return { success: true, result };
  });

// Generate voice using Gemini TTS
export const generateVoice = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({
    text: z.string().min(1),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const { text } = data;
    
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: keyData } = await supabaseAdmin
      .from('api_keys')
      .select('key_value')
      .eq('provider', 'gemini')
      .eq('status', 'active')
      .gt('credits_remaining', 0)
      .order('fallback_order', { ascending: true })
      .limit(1)
      .single();

    if (!keyData) {
      throw new Error('No active Gemini API key found');
    }

    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: keyData.key_value });

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-tts-preview',
      contents: text,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Zephyr' }
          }
        }
      }
    });

    const audioBytes = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioBytes) {
      throw new Error('Failed to generate audio');
    }

    return { audio: audioBytes };
  });