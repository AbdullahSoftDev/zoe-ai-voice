import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import { supabaseAdmin } from '@/integrations/supabase/client.server';

const ActionLogSchema = z.object({
  action_type: z.enum(['call', 'email', 'whatsapp', 'file']),
  target_name: z.string().optional(),
  target_value: z.string().optional(),
  mode: z.string().optional(),
  message: z.string().optional(),
  result: z.any().optional(),
});

export const logAction = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ActionLogSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: log, error } = await supabaseAdmin
      .from('action_logs')
      .insert({
        user_id: context.userId,
        action_type: data.action_type,
        target_name: data.target_name,
        target_value: data.target_value,
        mode: data.mode,
        message: data.message,
        result: data.result,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();
    
    if (error) {
      console.error('[ActionLog] Failed to save:', error);
      return { success: false, error: error.message };
    }
    
    return { success: true, log };
  });

export const logConversation = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({
    user_message: z.string(),
    zoe_reply: z.string(),
    intent: z.string().default('chat'),
    action: z.any().optional(),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from('conversations')
      .insert({
        user_id: context.userId,
        user_message: data.user_message,
        zoe_reply: data.zoe_reply,
        intent: data.intent,
        action: data.action || null,
        created_at: new Date().toISOString(),
      });
    
    if (error) {
      console.error('[Conversation] Failed to save:', error);
    }
    
    return { success: !error };
  });

export const logCall = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({
    contact_id: z.string().optional(),
    call_type: z.enum(['outgoing', 'incoming', 'three_way']),
    duration: z.number().optional(),
    transcript: z.string().optional(),
    status: z.enum(['initiated', 'active', 'ended']),
  }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin
      .from('calls')
      .insert({
        user_id: context.userId,
        contact_id: data.contact_id,
        call_type: data.call_type,
        duration: data.duration,
        transcript: data.transcript,
        status: data.status,
        created_at: new Date().toISOString(),
      });
    
    return { success: !error };
  });