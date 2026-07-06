// src/lib/email-service.ts
import { supabase } from '@/integrations/supabase/client';
import emailjs from '@emailjs/browser';

export interface EmailConfig {
  serviceId: string;
  publicKey: string;
  templateIdEmail: string;
  templateIdOtp: string;
}

let emailConfigCache: EmailConfig | null = null;

/** Load EmailJS configuration from Supabase */
async function loadEmailConfig(): Promise<EmailConfig | null> {
  if (emailConfigCache) return emailConfigCache;
  
  try {
    console.log('[Email] Loading config from Supabase...');
    
    const { data, error } = await supabase
      .from('email_js_config')
      .select('service_id, public_key, template_id_email, template_id_otp')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (error || !data) {
      console.error('[Email] Config load error:', error);
      return null;
    }
    
    const config = {
      serviceId: data.service_id?.trim() || '',
      publicKey: data.public_key?.trim() || '',
      templateIdEmail: data.template_id_email?.trim() || '',
      templateIdOtp: data.template_id_otp?.trim() || '',
    };
    
    console.log('[Email] Config loaded:', {
      serviceId: config.serviceId,
      hasPublicKey: !!config.publicKey,
      hasTemplateEmail: !!config.templateIdEmail,
      hasTemplateOtp: !!config.templateIdOtp
    });
    
    emailConfigCache = config;
    return config;
  } catch (error) {
    console.error('[Email] Error loading config:', error);
    return null;
  }
}

/** Send OTP email for verification */
export async function sendOtpEmail(email: string, name: string, otp: string): Promise<{ success: boolean; error?: string }> {
  console.log('[Email] Sending OTP to:', email);
  console.log('[Email] OTP:', otp);
  
  const config = await loadEmailConfig();
  if (!config) {
    return { 
      success: false, 
      error: 'EmailJS config not found in database.' 
    };
  }
  
  if (!config.serviceId || !config.publicKey || !config.templateIdOtp) {
    console.error('[Email] Invalid config:', config);
    return { 
      success: false, 
      error: 'EmailJS config is incomplete.' 
    };
  }
  
  try {
    console.log('[Email] Initializing EmailJS with public key:', config.publicKey);
    emailjs.init({ publicKey: config.publicKey });
    
    console.log('[Email] Sending with:', {
      serviceId: config.serviceId,
      templateId: config.templateIdOtp
    });
    
    // 🔥 FIX: Use 'email' as the parameter name (matches your template)
    const response = await emailjs.send(
      config.serviceId,
      config.templateIdOtp,
      {
        email: email,  // ✅ This is what your template expects
        user_name: name,
        otp_code: otp,
        expiry_time: '5',
      }
    );
    
    console.log('[Email] EmailJS response:', response);
    
    if (response.status === 200) {
      console.log(`[Email] ✅ OTP sent to ${email}`);
      return { success: true };
    } else {
      console.error('[Email] Send failed:', response);
      return { success: false, error: `EmailJS error: ${response.text || 'Unknown error'}` };
    }
  } catch (error: any) {
    console.error('[Email] Send OTP error:', error);
    return { success: false, error: error.message || 'Failed to send OTP' };
  }
}

/** Send general email */
export async function sendEmail(
  toEmail: string,
  toName: string,
  subject: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  console.log('[Email] Sending email to:', toEmail);
  console.log('[Email] Subject:', subject);
  
  const config = await loadEmailConfig();
  if (!config) {
    return { 
      success: false, 
      error: 'EmailJS config not found in database.' 
    };
  }
  
  if (!config.serviceId || !config.publicKey || !config.templateIdEmail) {
    console.error('[Email] Invalid config:', config);
    return { 
      success: false, 
      error: 'EmailJS config is incomplete.' 
    };
  }
  
  try {
    console.log('[Email] Initializing EmailJS with public key:', config.publicKey);
    emailjs.init({ publicKey: config.publicKey });
    
    console.log('[Email] Sending with:', {
      serviceId: config.serviceId,
      templateId: config.templateIdEmail
    });
    
    // 🔥 For email template, check what parameter it expects
    // Your email template might use 'recipient_email' or 'email'
    const response = await emailjs.send(
      config.serviceId,
      config.templateIdEmail,
      {
        recipient_email: toEmail,  // Try this first
        recipient_name: toName,
        email: 'abdullah422847@gmail.com',
        name: 'Abdullah',
        message: message || subject || 'Hello from Abdullah via Zoe Assistant.',
        current_date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      }
    );
    
    console.log('[Email] EmailJS response:', response);
    
    if (response.status === 200) {
      console.log(`[Email] ✅ Email sent to ${toEmail}`);
      return { success: true };
    } else {
      console.error('[Email] Send failed:', response);
      return { success: false, error: `EmailJS error: ${response.text || 'Unknown error'}` };
    }
  } catch (error: any) {
    console.error('[Email] Send email error:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
}