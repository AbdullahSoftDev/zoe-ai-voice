// src/integrations/voice/voice.ts
import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { GoogleGenAI } from '@google/genai';
import { waManager } from '@/server/wa-manager';
import { initiateCall } from '@/integrations/twilio/twilio';

const VoiceInputSchema = z.object({
  message: z.string().min(1).max(5000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional(),
});

// Get Gemini API key from database
async function getGeminiKey() {
  const { data } = await supabaseAdmin
    .from('api_keys')
    .select('key_value')
    .eq('provider', 'gemini')
    .eq('status', 'active')
    .gt('credits_remaining', 0)
    .order('fallback_order', { ascending: true })
    .limit(1)
    .single();
  
  if (!data) {
    throw new Error('No active Gemini API key found');
  }
  
  return data.key_value;
}

// Convert text to speech using Gemini TTS
async function generateVoiceAudio(text: string): Promise<Buffer> {
  const apiKey = await getGeminiKey();
  const ai = new GoogleGenAI({ apiKey });
  
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
  
  // Convert base64 to buffer
  const pcmBuffer = Buffer.from(audioBytes, 'base64');
  
  // Convert PCM to WAV (16kHz, mono)
  return pcmToWav(pcmBuffer, 24000);
}

// Helper: Convert PCM to WAV
function pcmToWav(pcmBuffer: Buffer, sampleRate: number = 24000): Buffer {
  const header = Buffer.alloc(44);
  const dataLength = pcmBuffer.length;
  const fileLength = dataLength + 36;
  
  header.write('RIFF', 0);
  header.writeUInt32LE(fileLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return Buffer.concat([header, pcmBuffer]);
}

// Extract intent using Gemini
async function extractIntent(userMessage: string, contacts: any[]): Promise<any> {
  const apiKey = await getGeminiKey();
  const ai = new GoogleGenAI({ apiKey });
  
  const contactsContext = JSON.stringify(contacts.map(c => ({
    name: c.name,
    phone: c.phone,
    email: c.email
  })));

  const systemPrompt = `You are Zoe's intent extractor. Analyze the user's message and extract the intent.

Available contacts:
${contactsContext}

Rules:
1. Identify the action: "call", "voice_message", "text_message", or "chat"
2. Extract the contact name from the message
3. Extract any message content (for text/voice messages)
4. Return ONLY JSON with this format:
{
  "action": "call" | "voice_message" | "text_message" | "chat",
  "contactName": "name or null",
  "message": "message content or null"
}

For "call": When user says "call [name]"
For "voice_message": When user says "voice message to [name]" or "send voice message to [name]"
For "text_message": When user says "text [name]" or "message [name]" or "send message to [name]"
For "chat": Everything else (normal conversation)

Always match contact names from the provided contacts list.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: userMessage,
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  });

  const text = response.text;
  if (!text) {
    throw new Error('Empty response from intent extractor');
  }

  return JSON.parse(text);
}

// Generate Zoe's reply for WhatsApp messages
async function generateWhatsAppReply(userMessage: string, contactName: string): Promise<string> {
  const apiKey = await getGeminiKey();
  const ai = new GoogleGenAI({ apiKey });
  
  const systemPrompt = `You are Zoe, Abdullah's AI assistant. Generate a message to send to ${contactName} on Abdullah's behalf.

Rules:
- Keep it short, friendly, and professional
- Use the same language as the user (English/Urdu/Punjabi)
- If user says "tell them I'm busy", say "I'm an agent of ${contactName} and he's currently busy"
- Be concise (max 2-3 sentences)
- Return ONLY the message text, no explanations`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: userMessage,
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.7,
    }
  });

  return response.text || 'Hello, this is Zoe, Abdullah\'s AI assistant.';
}

export const processVoiceCommand = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => VoiceInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { message, history = [] } = data;
    const userId = context.userId;
    
    console.log('[Voice] Processing:', message);
    console.log('[Voice] User ID:', userId);

    try {
      // Get user's contacts
      const { data: contacts } = await supabaseAdmin
        .from('contacts')
        .select('id, name, phone, email')
        .eq('user_id', userId);

      // Extract intent
      const intent = await extractIntent(message, contacts || []);
      console.log('[Voice] Intent:', intent);

      // Handle different actions
      switch (intent.action) {
        case 'call': {
          // Find contact
          const contact = contacts?.find(c => 
            c.name.toLowerCase().includes(intent.contactName?.toLowerCase() || '')
          );
          
          if (!contact) {
            return {
              reply: `I couldn't find "${intent.contactName}" in your contacts. Please add them first.`,
              intent: 'error',
              action: null
            };
          }

          // Initiate Twilio call
          try {
            const callResult = await initiateCall({
              data: {
                to: contact.phone,
                message: `Connecting you to ${contact.name}...`
              },
              context: context
            });

            return {
              reply: `Calling ${contact.name} at ${contact.phone}...`,
              intent: 'call',
              action: { 
                type: 'call', 
                contact: contact,
                callSid: callResult.callSid 
              }
            };
          } catch (error) {
            console.error('[Voice] Call failed:', error);
            return {
              reply: `I'm having trouble making the call. Please try again later.`,
              intent: 'error',
              action: null
            };
          }
        }

        case 'voice_message': {
          // Find contact
          const contact = contacts?.find(c => 
            c.name.toLowerCase().includes(intent.contactName?.toLowerCase() || '')
          );
          
          if (!contact) {
            return {
              reply: `I couldn't find "${intent.contactName}" in your contacts. Please add them first.`,
              intent: 'error',
              action: null
            };
          }

          // Check WhatsApp connection
          const waStatus = waManager.getStatus(userId);
          if (waStatus !== 'connected') {
            return {
              reply: `WhatsApp is not connected. Please scan the QR code in settings first.`,
              intent: 'error',
              action: null
            };
          }

          try {
            // Generate message content
            const messageText = await generateWhatsAppReply(message, contact.name);
            
            // Generate voice audio using Gemini TTS
            const audioBuffer = await generateVoiceAudio(messageText);
            
            // Send voice message via WhatsApp
            const result = await waManager.sendVoiceMessage(userId, contact.phone, audioBuffer);
            
            // Log action
            await supabaseAdmin
              .from('action_logs')
              .insert({
                user_id: userId,
                action_type: 'whatsapp',
                target_name: contact.name,
                target_value: contact.phone,
                message: messageText,
                result: { success: true, messageId: result?.key?.id },
                created_at: new Date().toISOString(),
              });

            return {
              reply: `✅ Voice message sent to ${contact.name} via WhatsApp!`,
              intent: 'voice_message',
              action: { 
                type: 'voice_message', 
                contact: contact,
                message: messageText,
                result: result
              }
            };
          } catch (error) {
            console.error('[Voice] Voice message failed:', error);
            return {
              reply: `I'm having trouble sending the voice message. Please try again later.`,
              intent: 'error',
              action: null
            };
          }
        }

        case 'text_message': {
          // Find contact
          const contact = contacts?.find(c => 
            c.name.toLowerCase().includes(intent.contactName?.toLowerCase() || '')
          );
          
          if (!contact) {
            return {
              reply: `I couldn't find "${intent.contactName}" in your contacts. Please add them first.`,
              intent: 'error',
              action: null
            };
          }

          // Check WhatsApp connection
          const waStatus = waManager.getStatus(userId);
          if (waStatus !== 'connected') {
            return {
              reply: `WhatsApp is not connected. Please scan the QR code in settings first.`,
              intent: 'error',
              action: null
            };
          }

          try {
            // Generate message content
            const messageText = await generateWhatsAppReply(message, contact.name);
            
            // Send text message via WhatsApp
            const result = await waManager.sendTextMessage(userId, contact.phone, messageText);
            
            // Log action
            await supabaseAdmin
              .from('action_logs')
              .insert({
                user_id: userId,
                action_type: 'whatsapp',
                target_name: contact.name,
                target_value: contact.phone,
                message: messageText,
                result: { success: true, messageId: result?.key?.id },
                created_at: new Date().toISOString(),
              });

            return {
              reply: `✅ Text message sent to ${contact.name} via WhatsApp!`,
              intent: 'text_message',
              action: { 
                type: 'text_message', 
                contact: contact,
                message: messageText,
                result: result
              }
            };
          } catch (error) {
            console.error('[Voice] Text message failed:', error);
            return {
              reply: `I'm having trouble sending the text message. Please try again later.`,
              intent: 'error',
              action: null
            };
          }
        }

        case 'chat':
        default: {
          // Normal chat response
          const historyText = history.map(h => `${h.role}: ${h.content}`).join('\n');
          
          // Get Gemini for chat
          const apiKey = await getGeminiKey();
          const ai = new GoogleGenAI({ apiKey });
          
          const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: [
              { role: 'user', parts: [{ text: `You are Zoe, Abdullah's warm and witty AI assistant. Keep responses conversational and friendly.` }] },
              { role: 'model', parts: [{ text: 'Understood! I am Zoe, ready to help.' }] },
              ...history.map(h => ({ 
                role: h.role === 'assistant' ? 'model' : 'user', 
                parts: [{ text: h.content }] 
              })),
              { role: 'user', parts: [{ text: message }] }
            ],
            config: {
              temperature: 0.8,
              maxOutputTokens: 500,
            }
          });

          const reply = response.text || 'I didn\'t understand that. Could you please repeat?';

          return {
            reply: reply,
            intent: 'chat',
            action: null
          };
        }
      }

    } catch (error) {
      console.error('[Voice] Error:', error);
      return {
        reply: `I'm having trouble processing your request. Please try again.`,
        intent: 'error',
        action: null
      };
    }
  });