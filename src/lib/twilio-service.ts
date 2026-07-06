// Twilio service for calls and WhatsApp
import { supabase } from '@/integrations/supabase/client';

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  whatsappNumber?: string;
}

// Fetch Twilio credentials from Supabase
async function getTwilioCredentials(): Promise<TwilioCredentials | null> {
  const { data, error } = await supabase
    .from('Twilio Auth')
    .select('sid, token, whatsapp')
    .single();
  
  if (error || !data) {
    console.error('[Twilio] Failed to fetch credentials:', error);
    return null;
  }
  
  return {
    accountSid: data.sid,
    authToken: data.token || '',
    phoneNumber: data.sid, // SID is used as phone number identifier
    whatsappNumber: data.whatsapp || '',
  };
}

/** Initiate a phone call via Twilio */
export async function initiateCall(
  toNumber: string,
  fromNumber: string,
  callMessage?: string
): Promise<{ callSid: string; status: string } | null> {
  const creds = await getTwilioCredentials();
  if (!creds) throw new Error('Twilio credentials not configured');
  
  // For browser-to-phone calls, we need to create an access token
  // This is a server-side function - call via server function
  
  const response = await fetch('/api/twilio/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: toNumber,
      from: fromNumber,
      message: callMessage,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to initiate call: ${response.statusText}`);
  }
  
  return response.json();
}

/** Send WhatsApp message via Twilio */
export async function sendWhatsAppMessage(
  toNumber: string,
  message: string
): Promise<{ status: string; messageSid: string } | null> {
  const creds = await getTwilioCredentials();
  if (!creds) throw new Error('Twilio credentials not configured');
  if (!creds.whatsappNumber) throw new Error('WhatsApp number not configured');
  
  const response = await fetch('/api/twilio/whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: toNumber,
      from: creds.whatsappNumber,
      message,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to send WhatsApp: ${response.statusText}`);
  }
  
  return response.json();
}

/** Generate Twilio Voice response TwiML for AI call */
export function generateCallTwiML(message: string, transferTo?: string): string {
  const transferXml = transferTo ? `
    <Gather input="speech dtmf" timeout="3" numDigits="1" action="/api/twilio/call-action" method="POST">
      <Say voice="Polly.Aria" language="en-US">${message} Press 1 to talk directly, or say "continue" for me to deliver the message.</Say>
    </Gather>
  ` : `
    <Say voice="Polly.Aria" language="en-US">${message}</Say>
  `;
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${transferXml}
  ${transferTo ? `<Dial>${transferTo}</Dial>` : ''}
</Response>`;
}