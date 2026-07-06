// src/integrations/twilio/twilio.ts
import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import twilio from 'twilio';

const CallSchema = z.object({
  to: z.string().min(10),
  message: z.string().optional(),
});

let twilioClient: any = null;

async function getTwilioClient() {
  if (twilioClient) return twilioClient;
  
  // Get Twilio credentials from database
  const { data: twilioAuth } = await supabaseAdmin
    .from('twilio_auth')
    .select('sid, token')
    .single();
  
  if (!twilioAuth) {
    throw new Error('Twilio credentials not found in database');
  }
  
  twilioClient = twilio(twilioAuth.sid, twilioAuth.token);
  return twilioClient;
}

export const initiateCall = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CallSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { to, message } = data;
    const client = await getTwilioClient();
    
    // Get user's contacts to find the contact name
    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('name')
      .eq('user_id', context.userId)
      .eq('phone', to)
      .single();
    
    const contactName = contact?.name || 'the recipient';
    const appUrl = process.env.APP_URL || 'https://zoe-ai-voice.lovable.app';
    
    // Create TwiML for the call with Gemini voice
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${message ? `<Say voice="Polly.Aria" language="en-US">${message}</Say>` : ''}
  <Say voice="Polly.Aria" language="en-US">Hello ${contactName}, this is Zoe, Abdullah's AI assistant calling on his behalf.</Say>
  <Dial>${to}</Dial>
</Response>`;
    
    try {
      // Get Twilio from number from database
      const { data: twilioAuth } = await supabaseAdmin
        .from('twilio_auth')
        .select('whatsapp')
        .single();
      
      const from = twilioAuth?.whatsapp || '+14155238886'; // Fallback Twilio sandbox
      
      const call = await client.calls.create({
        to,
        from,
        twiml,
        statusCallback: `${appUrl}/api/twilio/call-status`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      });
      
      // Log action
      await supabaseAdmin
        .from('action_logs')
        .insert({
          user_id: context.userId,
          action_type: 'call',
          target_name: contactName,
          target_value: to,
          message: message || null,
          result: { callSid: call.sid, status: call.status },
          created_at: new Date().toISOString(),
        });
      
      return { callSid: call.sid, status: call.status };
      
    } catch (error) {
      console.error('[Twilio] Call failed:', error);
      throw new Error(`Call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });