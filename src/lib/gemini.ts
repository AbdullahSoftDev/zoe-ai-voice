import { geminiKeyManager } from './gemini-keys';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

/** Send message to Gemini with auto key rotation from database */
export async function chatWithGemini(
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  language: 'urdu' | 'hindi' | 'english' = 'urdu'
): Promise<string> {
  const systemPrompt = `You are Zoe — a warm, witty, and brilliant AI voice assistant.

IMPORTANT LANGUAGE RULES:
- If user speaks in Urdu/Hindi, reply in Urdu/Hindi (use Roman script - English alphabet)
- If user speaks in English, reply in English
- ALWAYS provide your reasoning in ${language.toUpperCase()} after the answer

FORMAT YOUR RESPONSE LIKE THIS:
[Your main helpful answer here]

وجہ (Reason): [2-3 short sentences explaining your reasoning in ${language.toUpperCase()}]

Keep answers conversational and concise (suitable for voice). Be helpful, friendly, and a little playful.`;

  // Convert messages to Gemini format
  const contents: GeminiMessage[] = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'Understood! I will follow these rules.' }] },
  ];
  
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }

  const request = {
    contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 800,
      topP: 0.95,
      topK: 40,
    },
  };

  // Try keys until one works
  let lastError: Error | null = null;
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const keyData = await geminiKeyManager.getNextKey();
    if (!keyData) {
      throw new Error('No Gemini API keys available. Add keys to Supabase api_keys table.');
    }

    const { key: apiKey, keyId } = keyData;

    try {
      const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`Gemini API error: ${response.status} - ${errorText}`);
        await geminiKeyManager.reportError(keyId, error);
        lastError = error;
        attempts++;
        continue;
      }

      const data = await response.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      if (!reply) {
        throw new Error('Empty response from Gemini');
      }
      
      // Decrement credits on successful response
      await geminiKeyManager.decrementCredits(keyId);
      
      return reply;
      
    } catch (error) {
      await geminiKeyManager.reportError(keyId, error);
      lastError = error as Error;
      attempts++;
    }
  }

  throw lastError || new Error('All Gemini API keys failed');
}

/** Detect intent from user message */
export async function detectIntent(message: string): Promise<{
  intent: 'call' | 'email' | 'whatsapp' | 'file' | 'chat';
  targetName?: string;
  message?: string;
  fileType?: 'excel' | 'doc' | 'pdf';
}> {
  const prompt = `Analyze this user message and return ONLY JSON (no other text):

Message: "${message}"

Intent types: call, email, whatsapp, file, chat

Return JSON:
{
  "intent": "call|email|whatsapp|file|chat",
  "targetName": "person name if mentioned, else null",
  "message": "message/content to send if any, else null",
  "fileType": "excel|doc|pdf if file generation requested, else null"
}`;

  const response = await chatWithGemini([{ role: 'user', content: prompt }], 'english');
  
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error('[Intent] Failed to parse:', e);
  }
  
  return { intent: 'chat' };
}

/** Generate voice response text with Urdu reasoning */
export async function generateVoiceReply(userMessage: string, conversationHistory: { role: string; content: string }[] = []): Promise<string> {
  const messages = [
    ...conversationHistory,
    { role: 'user' as const, content: userMessage },
  ];
  
  return chatWithGemini(messages, 'urdu');
}