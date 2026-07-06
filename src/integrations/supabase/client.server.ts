// src/integrations/supabase/client.server.ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

function createSupabaseAdminClient() {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL) {
    throw new Error('SUPABASE_URL is not set in environment variables');
  }

  // If no service role key, log warning but still create client with anon key
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[Supabase] Service role key not configured. Using fallback mode.');
    // Try to use the anon key as fallback
    const fallbackKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (fallbackKey) {
      return createClient<Database>(SUPABASE_URL, fallbackKey, {
        auth: {
          storage: undefined,
          persistSession: false,
          autoRefreshToken: false,
        }
      });
    }
    throw new Error('No Supabase key available. Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_PUBLISHABLE_KEY.');
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    }
  });
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined;

export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});