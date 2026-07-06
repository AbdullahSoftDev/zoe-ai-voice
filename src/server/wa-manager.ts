// src/server/wa-manager.ts
import makeWASocket, { 
  useMultiFileAuthState, 
  DisconnectReason, 
  WASocket,
} from '@whiskeysockets/baileys';
import { Buffer } from 'buffer';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import pino from 'pino';
import QRCode from 'qrcode';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import path from 'path';
import fs from 'fs';

const AUTH_DIR = path.join(process.cwd(), 'whatsapp_auth_sessions');

class WhatsAppManager {
  private sockets: Map<string, WASocket> = new Map();
  private qrCodes: Map<string, string> = new Map();
  private initPromises: Map<string, Promise<void>> = new Map();
  private connectionAttempts: Map<string, number> = new Map();
  private pairedUsers: Map<string, string> = new Map();
  private readonly MAX_ATTEMPTS = 2;
  private isReconnecting: Map<string, boolean> = new Map();

  constructor() {
    console.log('[WhatsApp Manager] Initialized');
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
  }

  async initializeSession(userId: string): Promise<{ qrCode?: string; status: string }> {
    const currentStatus = this.getStatus(userId);
    if (currentStatus === 'connected') {
      return { status: 'connected' };
    }

    if (this.initPromises.has(userId)) {
      await this.initPromises.get(userId);
      return { status: this.getStatus(userId), qrCode: this.getQRCode(userId) || undefined };
    }

    const initPromise = this._initSession(userId);
    this.initPromises.set(userId, initPromise);
    
    try {
      await initPromise;
      return { status: this.getStatus(userId), qrCode: this.getQRCode(userId) || undefined };
    } finally {
      this.initPromises.delete(userId);
    }
  }

  private async _initSession(userId: string): Promise<void> {
    if (this.isReconnecting.get(userId)) {
      console.log(`[WhatsApp] Already reconnecting for user ${userId}, skipping`);
      return;
    }

    try {
      this.isReconnecting.set(userId, true);
      this.connectionAttempts.set(userId, (this.connectionAttempts.get(userId) || 0) + 1);

      const userAuthDir = path.join(AUTH_DIR, userId);
      
      // COMPLETE RESET - Delete everything
      if (fs.existsSync(userAuthDir)) {
        fs.rmSync(userAuthDir, { recursive: true, force: true });
      }
      fs.mkdirSync(userAuthDir, { recursive: true });

      // Try to load from Supabase first
      let sessionData = null;
      try {
        const { data } = await supabaseAdmin
          .from('whatsapp_sessions')
          .select('session_data')
          .eq('user_id', userId)
          .single();
        if (data?.session_data) {
          sessionData = data.session_data;
          console.log(`[WhatsApp] Found session in Supabase for user ${userId}`);
        }
      } catch (err) {
        console.log(`[WhatsApp] No session in Supabase for user ${userId}`);
      }

      // If we have session data, restore it
      if (sessionData) {
        try {
          const credsPath = path.join(userAuthDir, 'creds.json');
          fs.writeFileSync(credsPath, JSON.stringify(sessionData.creds, null, 2));
          console.log(`[WhatsApp] Restored session from Supabase for user ${userId}`);
        } catch (writeError) {
          console.error('[WhatsApp] Failed to write session data:', writeError);
        }
      }

      const { state, saveCreds } = await useMultiFileAuthState(userAuthDir);

      // TRY DIFFERENT BROWSER STRINGS - Rotate through these
      const browserStrings = [
        ['Zoe (Ubuntu)', 'Chrome', '120.0.0.0'],
        ['WhatsApp Business', 'Chrome', '119.0.0.0'],
        ['Zoe Assistant', 'Firefox', '120.0.0.0'],
        ['Chrome (Windows)', 'Chrome', '120.0.0.0'],
      ];
      
      // Use a different browser string each attempt
      const attempt = this.connectionAttempts.get(userId) || 0;
      const browser = browserStrings[attempt % browserStrings.length];

      console.log(`[WhatsApp] Using browser: ${browser.join(' ')}`);

      const sock = makeWASocket({
        auth: state,
        logger: pino({ 
          level: 'silent',
        }),
        printQRInTerminal: true, // Also print to terminal for debugging
        mobile: false,
        browser: browser,
        keepAliveIntervalMs: 60000,
        generateHighQualityLinkPreview: false,
        defaultQueryTimeoutMs: 120000,
        connectTimeoutMs: 60000,
        patchMessage: true,
        markOnlineOnConnect: false, // Don't mark online immediately
        syncFullHistory: false,
        qrTimeout: 120000, // 2 minutes QR timeout
        version: [2, 2413, 1],
        transactionOpts: { maxRetries: 1 },
        shouldIgnoreJids: () => true,
        getMessage: async () => undefined,
        // Disable some features to reduce load
        fireInitQueries: false,
      });

      this.sockets.set(userId, sock);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log(`[WhatsApp] QR code received for user ${userId}`);
          try {
            const qrDataUrl = await QRCode.toDataURL(qr, {
              errorCorrectionLevel: 'H',
              margin: 2,
              width: 400,
            });
            this.qrCodes.set(userId, qrDataUrl);
            console.log(`[WhatsApp] QR code generated for user ${userId}`);
          } catch (err) {
            console.error('[WhatsApp] QR generation failed:', err);
          }
        }

        if (connection === 'open') {
          console.log(`[WhatsApp] ✅ Connected for user ${userId}`);
          this.qrCodes.delete(userId);
          this.connectionAttempts.delete(userId);
          this.isReconnecting.set(userId, false);
          
          const pairedNumber = sock.user?.id?.split(':')[0] || null;
          if (pairedNumber) {
            this.pairedUsers.set(userId, pairedNumber);
          }
          
          try {
            const { creds } = sock.authState;
            await supabaseAdmin
              .from('whatsapp_sessions')
              .upsert({
                user_id: userId,
                session_data: { creds },
                paired_number: pairedNumber,
                status: 'active',
                updated_at: new Date().toISOString(),
              }, {
                onConflict: 'user_id',
              });
            console.log(`[WhatsApp] Session saved for user ${userId}`);
          } catch (saveError) {
            console.error('[WhatsApp] Failed to save session:', saveError);
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          
          console.log(`[WhatsApp] Connection closed for user ${userId}, code: ${statusCode}`);
          
          // For 405, completely reset everything
          if (statusCode === 405) {
            console.log(`[WhatsApp] Connection blocked (405) for user ${userId}`);
            // Clear everything
            this.sockets.delete(userId);
            this.qrCodes.delete(userId);
            this.pairedUsers.delete(userId);
            this.isReconnecting.set(userId, false);
            
            // Delete the auth directory
            try {
              if (fs.existsSync(userAuthDir)) {
                fs.rmSync(userAuthDir, { recursive: true, force: true });
              }
            } catch (err) {
              console.error('[WhatsApp] Failed to delete auth directory:', err);
            }
            
            // Don't auto-reconnect on 405 - user must click "Reset Session"
            return;
          }
          
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 405;
          
          if (shouldReconnect) {
            const attempts = this.connectionAttempts.get(userId) || 0;
            if (attempts < this.MAX_ATTEMPTS) {
              const delay = 10000; // Fixed 10 second delay
              console.log(`[WhatsApp] Reconnecting in ${delay/1000}s (attempt ${attempts + 1}/${this.MAX_ATTEMPTS})`);
              this.isReconnecting.set(userId, false);
              setTimeout(() => {
                this._initSession(userId).catch(console.error);
              }, delay);
            } else {
              console.log(`[WhatsApp] Max reconnection attempts reached for user ${userId}`);
              this.sockets.delete(userId);
              this.qrCodes.delete(userId);
              this.isReconnecting.set(userId, false);
            }
          } else {
            console.log(`[WhatsApp] User ${userId} logged out`);
            this.sockets.delete(userId);
            this.qrCodes.delete(userId);
            this.connectionAttempts.delete(userId);
            this.pairedUsers.delete(userId);
            this.isReconnecting.set(userId, false);
          }
        }
      });

      sock.ev.on('creds.update', async (creds) => {
        try {
          const userAuthDir = path.join(AUTH_DIR, userId);
          if (!fs.existsSync(userAuthDir)) {
            fs.mkdirSync(userAuthDir, { recursive: true });
          }
          fs.writeFileSync(
            path.join(userAuthDir, 'creds.json'),
            JSON.stringify(creds, null, 2)
          );
        } catch (error) {
          console.error('[WhatsApp] Failed to update creds:', error);
        }
      });

    } catch (error) {
      console.error(`[WhatsApp] Failed to initialize for user ${userId}:`, error);
      this.isReconnecting.set(userId, false);
      throw error;
    }
  }

  getStatus(userId: string): string {
    const sock = this.sockets.get(userId);
    if (!sock) return 'disconnected';
    if (this.qrCodes.has(userId)) return 'qr_ready';
    return sock.user ? 'connected' : 'connecting';
  }

  getQRCode(userId: string): string | null {
    return this.qrCodes.get(userId) || null;
  }

  getPairedNumber(userId: string): string | null {
    return this.pairedUsers.get(userId) || null;
  }

  async sendTextMessage(userId: string, phoneNumber: string, text: string): Promise<any> {
    const sock = this.sockets.get(userId);
    if (!sock) throw new Error('WhatsApp not connected');
    if (!sock.user) throw new Error('WhatsApp not authenticated');

    const formattedNumber = this.formatPhoneNumber(phoneNumber);
    const jid = `${formattedNumber}@s.whatsapp.net`;

    try {
      const result = await sock.sendMessage(jid, { text });
      console.log(`[WhatsApp] Text message sent to ${phoneNumber}`);
      return result;
    } catch (error) {
      console.error('[WhatsApp] Send text failed:', error);
      throw error;
    }
  }

  async sendVoiceMessage(userId: string, phoneNumber: string, audioBuffer: Buffer): Promise<any> {
    const sock = this.sockets.get(userId);
    if (!sock) throw new Error('WhatsApp not connected');
    if (!sock.user) throw new Error('WhatsApp not authenticated');

    const formattedNumber = this.formatPhoneNumber(phoneNumber);
    const jid = `${formattedNumber}@s.whatsapp.net`;

    try {
      const oggBuffer = await this.convertToOggOpus(audioBuffer);
      const result = await sock.sendMessage(jid, {
        audio: oggBuffer,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
      } as any);
      console.log(`[WhatsApp] Voice message sent to ${phoneNumber}`);
      return result;
    } catch (error) {
      console.error('[WhatsApp] Send voice failed:', error);
      throw error;
    }
  }

  async disconnect(userId: string): Promise<void> {
    const sock = this.sockets.get(userId);
    if (sock) {
      try {
        await sock.logout();
      } catch (error) {
        console.error('[WhatsApp] Logout error:', error);
      }
      this.sockets.delete(userId);
      this.qrCodes.delete(userId);
      this.connectionAttempts.delete(userId);
      this.pairedUsers.delete(userId);
      this.isReconnecting.delete(userId);
    }
    
    try {
      const userAuthDir = path.join(AUTH_DIR, userId);
      if (fs.existsSync(userAuthDir)) {
        fs.rmSync(userAuthDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.error('[WhatsApp] Failed to clean up auth directory:', cleanupError);
    }
    
    console.log(`[WhatsApp] Disconnected user ${userId}`);
  }

  private formatPhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }
    if (!cleaned.startsWith('92')) {
      cleaned = `92${cleaned}`;
    }
    return cleaned;
  }

  private async convertToOggOpus(inputBuffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (!ffmpegPath) {
        return reject(new Error('ffmpeg-static path not found.'));
      }

      const ffmpeg = spawn(ffmpegPath, [
        '-i', 'pipe:0',
        '-acodec', 'libopus',
        '-ab', '16k',
        '-ac', '1',
        '-ar', '16000',
        '-f', 'ogg',
        'pipe:1'
      ]);

      const chunks: Buffer[] = [];
      const errorChunks: Buffer[] = [];

      ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
      ffmpeg.stderr.on('data', (chunk) => errorChunks.push(chunk));

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          const errorMsg = Buffer.concat(errorChunks).toString();
          reject(new Error(`FFmpeg error (code ${code}): ${errorMsg}`));
        }
      });

      ffmpeg.on('error', (err) => reject(err));

      ffmpeg.stdin.write(inputBuffer);
      ffmpeg.stdin.end();
    });
  }
}

export const waManager = new WhatsAppManager();