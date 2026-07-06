// src/lib/ai-studio-api.ts
const AI_STUDIO_URL = 'https://zoe-backend-production.up.railway.app';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

async function apiCall<T>(endpoint: string, body?: any): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${AI_STUDIO_URL}${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    return { success: response.ok, data };
  } catch (error: any) {
    console.error('[AI Studio API] Error:', error);
    return { success: false, error: error.message };
  }
}

// ============ WHATSAPP APIs ============
export const getWhatsAppStatus = () => apiCall('/api/whatsapp/status');
export const connectWhatsApp = () => apiCall('/api/whatsapp/connect', {});
export const disconnectWhatsApp = () => apiCall('/api/whatsapp/disconnect', {});
export const resetWhatsApp = () => apiCall('/api/whatsapp/reset', {});

// Send WhatsApp text message
export const sendWhatsAppText = (phoneNumber: string, message: string) =>
  apiCall('/api/whatsapp/send-text', { phoneNumber, message });

// Send WhatsApp voice message
export const sendWhatsAppVoice = (
  phoneNumber: string, 
  prompt: string, 
  language: string = 'Bilingual',
  voiceEngine: string = 'gemini-tts',
  voiceName: string = 'Zephyr'
) =>
  apiCall('/api/whatsapp/send-voice', { 
    phoneNumber, 
    prompt, 
    language, 
    voiceEngine, 
    voiceName 
  });

// Generate voice audio from text
export const generateVoice = (text: string) =>
  apiCall('/api/generate-voice', { text });

// ============ TWILIO CALL API ============
export const makeCall = (phone: string, contactName: string, message: string) =>
  apiCall('/api/call/trigger', { 
    phone, 
    contactName, 
    message 
  });

// ============ EMAIL API ============
export const sendEmail = (toEmail: string, toName: string, subject: string, message: string) =>
  apiCall('/api/send-email', { 
    to_email: toEmail, 
    to_name: toName, 
    subject, 
    message,
    template_type: 'email'
  });

export const sendOTP = (email: string, name: string, otp: string) =>
  apiCall('/api/send-otp', { 
    email, 
    name, 
    otp 
  });

// ============ INTENT EXTRACTION ============
export const extractIntent = (userInput: string, contacts: any[]) =>
  apiCall('/api/extract-intent', { userInput, contacts });

// ============ CONTACTS API ============
export const getContacts = () => apiCall('/api/contacts/get');
export const addContact = (name: string, phone: string, email?: string) =>
  apiCall('/api/contacts/add', { name, phone, email });

// ============ ACTION LOGGING ============
export const logAction = (actionType: string, targetName: string, targetValue: string, message: string, result?: any) =>
  apiCall('/api/log-action', {
    action_type: actionType,
    target_name: targetName,
    target_value: targetValue,
    message,
    result
  });