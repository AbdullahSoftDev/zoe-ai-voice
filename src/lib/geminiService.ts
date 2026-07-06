import { GoogleGenAI } from '@google/genai';
import { supabase } from '@/integrations/supabase/client';

// Cache for keys with rotation
let currentKeyIndex = 0;
let cachedKeys: { id: string; key_value: string; status: string; credits_remaining: number }[] = [];

async function loadActiveKeys() {
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, key_value, status, credits_remaining')
    .eq('provider', 'gemini')
    .eq('status', 'active')
    .gt('credits_remaining', 0)
    .order('fallback_order', { ascending: true });

  if (error || !data || data.length === 0) {
    console.error('[GeminiService] No active API keys found');
    return [];
  }
  
  cachedKeys = data;
  return cachedKeys;
}

export async function getActiveApiKey(): Promise<string | null> {
  if (cachedKeys.length === 0) {
    await loadActiveKeys();
  }
  
  if (cachedKeys.length === 0) {
    return null;
  }
  
  // Rotate to next key
  const key = cachedKeys[currentKeyIndex % cachedKeys.length];
  currentKeyIndex++;
  
  return key.key_value;
}

async function markKeyExhausted(keyId: string) {
  await supabase
    .from('api_keys')
    .update({ status: 'exhausted', credits_remaining: 0 })
    .eq('id', keyId);
  
  // Reload keys to exclude exhausted one
  await loadActiveKeys();
  console.log(`[GeminiService] Key ${keyId} marked as exhausted, rotating to next key`);
}

export async function getGenAIInstance(): Promise<GoogleGenAI> {
  const apiKey = await getActiveApiKey();
  if (!apiKey) {
    throw new Error('No Gemini API key available');
  }
  return new GoogleGenAI({ apiKey });
}

// ============ Chat with Gemini with AUTO-ROTATION ============
export async function chatWithGemini(
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
): Promise<string> {
  let lastError: Error | null = null;
  const maxRetries = 10; // Try up to 10 keys
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const apiKey = await getActiveApiKey();
    if (!apiKey) {
      throw new Error('No Gemini API keys available');
    }
    
    // Find which key we're using (to mark exhausted if needed)
    const currentKey = cachedKeys[(currentKeyIndex - 1) % cachedKeys.length];
    
    const systemPrompt = `You are Zoe — a helpful AI assistant.

RULES:
- Respond in the SAME LANGUAGE as the user (English/Roman Urdu/Urdu)
- Keep responses concise and helpful
- NO reasoning or explanation
- Just give the answer directly
- When providing code, return ONLY raw code in markdown code blocks

CAPABILITIES:
- Generate files (Excel, Word, PDF, code files) when asked
- Send emails when asked
- Remember conversation context`;

    const formattedMessages = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Understood.' }] },
      ...messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
    ];

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: formattedMessages,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 800,
              topP: 0.95,
              topK: 40,
            },
          }),
        }
      );

      if (response.status === 429) {
        // Rate limit - mark this key as exhausted and try next
        if (currentKey) {
          await markKeyExhausted(currentKey.id);
          console.log(`[GeminiService] Key exhausted due to rate limit, trying next...`);
        }
        continue; // Try next key
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      let reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      if (!reply) {
        throw new Error('Empty response from Gemini');
      }
      
      // Clean up markdown code blocks
      const codeBlockMatch = reply.match(/```(\w+)?\n([\s\S]*?)```/);
      if (codeBlockMatch) {
        reply = codeBlockMatch[2].trim();
      }
      
      // Success! Don't mark as exhausted
      return reply;
      
    } catch (error) {
      console.error(`[GeminiService] Attempt ${attempt + 1} failed:`, error);
      lastError = error as Error;
      
      // Mark key as exhausted on 429
      if ((error as any)?.status === 429 && currentKey) {
        await markKeyExhausted(currentKey.id);
      }
      continue; // Try next key
    }
  }
  
  throw lastError || new Error('All Gemini API keys exhausted');
}