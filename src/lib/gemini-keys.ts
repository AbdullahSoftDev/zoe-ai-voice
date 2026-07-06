// Gemini API Key Warehouse with auto-rotation
// Fetches keys from Supabase api_keys table

import { supabase } from '@/integrations/supabase/client';

export interface GeminiKey {
  id: string;
  key_value: string;
  status: 'active' | 'exhausted' | 'rate_limited';
  credits_remaining: number;
  fallback_order: number;
}

class GeminiKeyManager {
  private keys: GeminiKey[] = [];
  private currentIndex = 0;
  private initialized = false;
  private readonly RATE_LIMIT_RESET_MS = 60 * 1000; // 1 minute

  /** Fetch active Gemini keys from Supabase */
  async loadKeys(): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('api_keys')
        .select('id, key_value, status, credits_remaining, fallback_order')
        .eq('provider', 'gemini')
        .eq('status', 'active')
        .order('fallback_order', { ascending: true });

      if (error) throw error;

      this.keys = (data || []).map(key => ({
        id: key.id,
        key_value: key.key_value,
        status: key.status as 'active' | 'exhausted' | 'rate_limited',
        credits_remaining: key.credits_remaining || 1500,
        fallback_order: key.fallback_order || 0,
      }));

      this.initialized = true;
      
      if (this.keys.length === 0) {
        console.warn('[Gemini] No active API keys found in database. Add keys to api_keys table.');
      } else {
        console.log(`[Gemini] Loaded ${this.keys.length} API keys from Supabase`);
      }
    } catch (error) {
      console.error('[Gemini] Failed to load keys from Supabase:', error);
      this.keys = [];
    }
  }

  /** Get next available active key */
  async getNextKey(): Promise<{ key: string; keyId: string } | null> {
    if (!this.initialized) {
      await this.loadKeys();
    }
    
    if (this.keys.length === 0) {
      return null;
    }
    
    const startIndex = this.currentIndex;
    
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (startIndex + i) % this.keys.length;
      const key = this.keys[idx];
      
      if (key.status === 'active' && key.credits_remaining > 0) {
        this.currentIndex = (idx + 1) % this.keys.length;
        return { key: key.key_value, keyId: key.id };
      }
    }
    
    console.error('[Gemini] ALL API KEYS EXHAUSTED!');
    return null;
  }

  /** Update key status in database when exhausted */
  async markKeyExhausted(keyId: string): Promise<void> {
    const { error } = await supabase
      .from('api_keys')
      .update({ 
        status: 'exhausted',
        credits_remaining: 0 
      })
      .eq('id', keyId);
    
    if (error) {
      console.error('[Gemini] Failed to mark key exhausted:', error);
    } else {
      console.log(`[Gemini] Key ${keyId} marked as exhausted in database`);
      
      // Update local cache
      const keyIndex = this.keys.findIndex(k => k.id === keyId);
      if (keyIndex !== -1) {
        this.keys[keyIndex].status = 'exhausted';
        this.keys[keyIndex].credits_remaining = 0;
      }
    }
  }

  /** Decrement credits remaining for a key */
  async decrementCredits(keyId: string, amount: number = 1): Promise<void> {
    const keyIndex = this.keys.findIndex(k => k.id === keyId);
    if (keyIndex === -1) return;
    
    const currentCredits = this.keys[keyIndex].credits_remaining;
    const newCredits = Math.max(0, currentCredits - amount);
    
    const { error } = await supabase
      .from('api_keys')
      .update({ credits_remaining: newCredits })
      .eq('id', keyId);
    
    if (!error) {
      this.keys[keyIndex].credits_remaining = newCredits;
    }
  }

  /** Report API error to trigger rotation */
  async reportError(keyId: string, error: any): Promise<void> {
    const errorMsg = error?.message || error?.toString() || '';
    
    if (errorMsg.includes('429') || errorMsg.includes('rate limit') || errorMsg.includes('quota')) {
      // Rate limited - temporarily mark but don't exhaust permanently
      console.log(`[Gemini] Key ${keyId} rate limited`);
    } else if (errorMsg.includes('403') || errorMsg.includes('invalid') || errorMsg.includes('exhausted')) {
      await this.markKeyExhausted(keyId);
    }
  }

  /** Refresh keys from database (call periodically) */
  async refreshKeys(): Promise<void> {
    await this.loadKeys();
  }

  /** Get current key status for debugging */
  async getStatus() {
    if (!this.initialized) await this.loadKeys();
    return this.keys.map(k => ({
      id: k.id,
      status: k.status,
      creditsRemaining: k.credits_remaining,
      fallbackOrder: k.fallback_order,
    }));
  }
}

export const geminiKeyManager = new GeminiKeyManager();