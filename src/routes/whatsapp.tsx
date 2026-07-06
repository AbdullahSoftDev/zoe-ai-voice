// src/routes/whatsapp.tsx
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { QrCode, CheckCircle2, Loader2, ArrowLeft, Waves, MessageSquare, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { CosmicBg } from "@/components/cosmic-bg";
import { ThemeToggle } from "@/components/theme-toggle";
import { getWhatsAppStatus, connectWhatsApp, disconnectWhatsApp } from "@/lib/ai-studio-api";

export const Route = createFileRoute("/whatsapp")({
  component: WhatsAppPage,
  head: () => ({
    meta: [
      { title: "Connect WhatsApp — Zoe AI Assistant" },
      { name: "description", content: "Connect your WhatsApp to start sending messages with Zoe." },
    ],
  }),
});

function WhatsAppPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [waStatus, setWaStatus] = useState<'disconnected' | 'connecting' | 'qr_ready' | 'connected'>('disconnected');
  const [waQrCode, setWaQrCode] = useState<string | null>(null);
  const [waPairedNumber, setWaPairedNumber] = useState<string | null>(null);
  const [waLoading, setWaLoading] = useState(false);
  const [showIframe, setShowIframe] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pollInterval = useRef<NodeJS.Timeout | null>(null);

  const BACKEND_URL = 'https://zoe-backend-production.up.railway.app';

  useEffect(() => {
    if (!user) {
      navigate({ to: "/login" });
    }
  }, [user, navigate]);

  useEffect(() => {
    if (user) {
      checkStatus();
    }
    return () => {
      if (pollInterval.current) clearInterval(pollInterval.current);
    };
  }, [user]);

  // Poll status when connecting or QR ready
  useEffect(() => {
    if (waStatus === 'connecting' || waStatus === 'qr_ready') {
      if (pollInterval.current) clearInterval(pollInterval.current);
      pollInterval.current = setInterval(checkStatus, 2000);
    } else {
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
        pollInterval.current = null;
      }
    }
  }, [waStatus]);

  // AUTO-CLOSE IFRAME AND REDIRECT WHEN CONNECTED
  useEffect(() => {
    if (waStatus === 'connected') {
      toast.success('WhatsApp connected successfully!');
      // Close iframe
      setShowIframe(false);
      // Redirect to voice page after 1.5 seconds
      setTimeout(() => {
        navigate({ to: "/voice" });
      }, 1500);
    }
  }, [waStatus, navigate]);

  const checkStatus = async () => {
    try {
      const result = await getWhatsAppStatus();
      if (result.success && result.data) {
        const data = result.data;
        setWaStatus(data.status);
        if (data.qrCodeUrl) setWaQrCode(data.qrCodeUrl);
        if (data.pairedUser) setWaPairedNumber(data.pairedUser);
      }
    } catch (error) {
      console.error('[WhatsApp] Status check failed:', error);
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleConnect = async () => {
    setWaLoading(true);
    setShowIframe(true);
    try {
      const result = await connectWhatsApp();
      if (result.success && result.data) {
        setWaStatus(result.data.status);
        if (result.data.qrCodeUrl) setWaQrCode(result.data.qrCodeUrl);
      }
    } catch (error) {
      console.error('[WhatsApp] Connect failed:', error);
      toast.error('Failed to connect WhatsApp');
    } finally {
      setWaLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectWhatsApp();
      setWaStatus('disconnected');
      setWaQrCode(null);
      setWaPairedNumber(null);
      setShowIframe(false);
      toast.info('WhatsApp disconnected');
    } catch (error) {
      console.error('[WhatsApp] Disconnect failed:', error);
    }
  };

  // Listen for postMessage from backend
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== BACKEND_URL) return;
      if (event.data === 'whatsapp_connected') {
        checkStatus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  if (checkingStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <div className="text-center">
          <Loader2 className="h-12 w-12 text-cyan-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Checking WhatsApp status...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#050505]">
      <CosmicBg stars={60} />

      <header className="relative z-10 flex items-center justify-between px-4 py-4 md:px-12 md:py-5">
        <Link to="/" className="flex items-center gap-2 font-bold text-lg">
          <div className="h-9 w-9 rounded-xl btn-glow flex items-center justify-center">
            <Waves className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="shimmer-text text-xl tracking-tight" style={{ fontFamily: "Space Grotesk" }}>Zoe</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {waStatus === 'connected' && (
            <button
              onClick={handleDisconnect}
              className="glass-pill flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:text-red-300 transition-all"
            >
              Disconnect
            </button>
          )}
        </div>
      </header>

      <main className="relative z-10 flex items-center justify-center min-h-[80vh] px-4">
        <div className="w-full max-w-md">
          {waStatus === 'connected' ? (
            <div className="glass-strong rounded-3xl p-8 text-center animate-scale-in border border-green-500/20">
              <div className="w-20 h-20 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="h-10 w-10 text-green-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">WhatsApp Connected!</h2>
              <p className="text-gray-400 mb-1">Paired with: <span className="text-green-400 font-medium">{waPairedNumber || 'Your WhatsApp'}</span></p>
              <p className="text-sm text-gray-500 mb-6">Redirecting to Zoe...</p>
              <Loader2 className="h-6 w-6 text-cyan-500 animate-spin mx-auto" />
            </div>
          ) : (
            <div className="glass-strong rounded-3xl p-8 text-center animate-fade-up border border-white/5">
              <div className="w-24 h-24 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mx-auto mb-6">
                <MessageSquare className="h-12 w-12 text-cyan-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Connect WhatsApp</h2>
              <p className="text-gray-400 text-sm mb-6 max-w-xs mx-auto">
                Connect your WhatsApp to send messages and voice notes through Zoe
              </p>
              
              <div className="space-y-3 text-left mb-8">
                <div className="flex items-center gap-3 text-sm text-gray-300">
                  <div className="w-8 h-8 rounded-full bg-cyan-500/10 flex items-center justify-center shrink-0">
                    <MessageSquare className="h-4 w-4 text-cyan-400" />
                  </div>
                  <span>Send WhatsApp text messages</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-300">
                  <div className="w-8 h-8 rounded-full bg-cyan-500/10 flex items-center justify-center shrink-0">
                    <QrCode className="h-4 w-4 text-cyan-400" />
                  </div>
                  <span>Scan QR code once, always connected</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-300">
                  <div className="w-8 h-8 rounded-full bg-cyan-500/10 flex items-center justify-center shrink-0">
                    <ExternalLink className="h-4 w-4 text-cyan-400" />
                  </div>
                  <span>Secure connection via Zoe backend</span>
                </div>
              </div>

              <button
                onClick={handleConnect}
                disabled={waLoading}
                className="w-full py-3.5 rounded-2xl btn-glow text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
              >
                {waLoading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <QrCode className="h-5 w-5" />
                    Connect WhatsApp
                  </>
                )}
              </button>

              <button
                onClick={() => window.open(BACKEND_URL, '_blank')}
                className="w-full mt-3 py-2 rounded-xl glass text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-all flex items-center justify-center gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Open QR in new tab
              </button>
            </div>
          )}
        </div>
      </main>

      {/* QR Code Iframe Modal - Auto closes when connected */}
      {showIframe && waStatus !== 'connected' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg bg-neutral-900 rounded-2xl border border-neutral-800 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-neutral-800">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-cyan-500/10 flex items-center justify-center">
                  <QrCode className="h-4 w-4 text-cyan-400" />
                </div>
                <span className="text-sm font-semibold text-white">Scan QR Code</span>
              </div>
              <button
                onClick={() => {
                  setShowIframe(false);
                  disconnectWhatsApp();
                }}
                className="p-2 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4">
              <p className="text-xs text-gray-400 text-center mb-4">
                Open WhatsApp → Settings → Linked Devices → Link a Device
              </p>
              <div className="bg-white rounded-xl p-4 flex items-center justify-center min-h-[400px]">
                <iframe
                  ref={iframeRef}
                  src={BACKEND_URL}
                  className="w-full h-[400px] rounded-lg"
                  allow="microphone; camera"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />
              </div>
              <p className="text-xs text-center text-gray-500 mt-4">
                Waiting for QR scan... Auto-closing when connected
              </p>
            </div>

            <div className="flex items-center justify-center gap-2 py-3 border-t border-neutral-800">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
              <span className="text-xs text-gray-400">Waiting for connection...</span>
            </div>
          </div>
        </div>
      )}

      <footer className="relative z-10 text-center py-6 text-xs text-gray-600">
        Your WhatsApp session is stored securely on Zoe backend
      </footer>
    </div>
  );
}