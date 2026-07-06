// src/lib/wa-functions.ts
// This file can be imported anywhere - it uses createServerFn which works on both client and server
import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import { waManager } from '@/server/wa-manager';
import path from 'path';
import fs from 'fs';

export const getWhatsAppStatus = createServerFn({ method: 'GET' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const status = waManager.getStatus(userId);
    const qrCode = waManager.getQRCode(userId);
    const pairedNumber = waManager.getPairedNumber(userId);
    return { status, qrCode, pairedNumber };
  });

export const initWhatsApp = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const result = await waManager.initializeSession(userId);
    return result;
  });

export const disconnectWhatsApp = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    await waManager.disconnect(userId);
    return { success: true };
  });

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

export const sendWhatsAppVoice = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({
    phone: z.string().min(10),
    audio: z.string(),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const audioBuffer = Buffer.from(data.audio, 'base64');
    const result = await waManager.sendVoiceMessage(userId, data.phone, audioBuffer);
    return { success: true, result };
  });

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

export const forceCleanWhatsApp = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    
    console.log(`[WhatsApp] Force cleaning session for user ${userId}`);
    
    const AUTH_DIR = path.join(process.cwd(), 'whatsapp_auth_sessions');
    const userAuthDir = path.join(AUTH_DIR, userId);
    
    if (fs.existsSync(userAuthDir)) {
      fs.rmSync(userAuthDir, { recursive: true, force: true });
      console.log(`[WhatsApp] Deleted auth directory for user ${userId}`);
    }
    
    await waManager.disconnect(userId);
    
    return { success: true };
  });