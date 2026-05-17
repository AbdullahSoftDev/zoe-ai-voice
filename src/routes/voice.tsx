import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Mic, MicOff, Send, Volume2, VolumeX, X, Sparkles, Bot, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Orb } from "@/components/orb";
import { VoiceBars } from "@/components/voice-bars";
import { ThemeToggle } from "@/components/theme-toggle";

const SearchSchema = z.object({
  q: z.string().optional(),
  mode: z.enum(["call", "chat"]).optional(),
});

export const Route = createFileRoute("/voice")({
  component: VoicePage,
  validateSearch: (s) => SearchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Talk to Zoe — Voice Chat" },
      { name: "description", content: "Have a real-time voice conversation with Zoe, your AI assistant." },
    ],
  }),
});

type Msg = { role: "user" | "assistant"; content: string };

function VoicePage() {
  const search = Route.useSearch();

  const [mode, setMode] = useState<"call" | "chat">(search.mode === "chat" ? "chat" : "call");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [muteVoice, setMuteVoice] = useState(false);

  const recogRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);


  // ---- Speech Recognition (browser) ----
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = false;
    r.interimResults = false;
    r.lang = "en-US";
    r.onresult = (e: any) => {
      const text = e.results[0][0].transcript as string;
      setListening(false);
      void send(text);
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recogRef.current = r;
    return () => {
      try { r.stop(); } catch {}
    };
  }, []);

  const startListening = () => {
    if (!recogRef.current) {
      toast.error("Voice not supported", { description: "Try Chrome / Edge for speech recognition." });
      return;
    }
    stopSpeaking();
    try {
      recogRef.current.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  const stopListening = () => {
    try { recogRef.current?.stop(); } catch {}
    setListening(false);
  };

  // ---- TTS ----
  const speak = (text: string) => {
    if (muteVoice || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    // Strip the Urdu reasoning section for cleaner spoken answer
    const cleaned = text.replace(/وجہ[\s\S]*$/u, "").replace(/^Answer:\s*/i, "").trim() || text;
    const u = new SpeechSynthesisUtterance(cleaned);
    u.rate = 1.02;
    u.pitch = 1.05;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };

  const stopSpeaking = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  };

  // ---- Send message (UI demo — wire real AI later) ----
  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    const next: Msg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setThinking(true);
    try {
      await new Promise((r) => setTimeout(r, 700));
      const reply = `Answer: I hear you — "${trimmed}". (Connect your AI provider to get real responses.)\n\nوجہ (Reason): یہ ایک ڈیمو جواب ہے، اصل AI جوڑنے کے بعد یہاں مکمل وجہ آئے گی۔`;
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      speak(reply);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setThinking(false);
    }
  };

  // Initial query from search param
  useEffect(() => {
    if (sentInitial.current) return;
    if (search.q) {
      sentInitial.current = true;
      void send(search.q);
    }
  }, [search.q]); // eslint-disable-line react-hooks/exhaustive-deps


  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="aurora-bg" />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between p-6">
        <Link to="/" className="glass-pill flex h-10 w-10 items-center justify-center transition-transform hover:scale-110">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="glass-pill flex items-center gap-2 px-4 py-2 text-xs">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Zoe 1.0 <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary">Beta</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={() => setMuteVoice((m) => !m)}
            className="glass-pill flex h-10 w-10 items-center justify-center"
            aria-label={muteVoice ? "Unmute" : "Mute"}
          >
            {muteVoice ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Mode tabs */}
      <div className="relative z-20 mx-auto -mt-2 flex w-fit gap-1 rounded-full glass p-1 text-sm">
        {(["call", "chat"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-full px-5 py-1.5 capitalize transition ${
              mode === m ? "btn-gradient" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "call" ? "Voice call" : "Chat"}
          </button>
        ))}
      </div>

      {/* Main content */}
      <main className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-6 pb-32 pt-6">
        {mode === "call" ? (
          <CallMode
            messages={messages}
            listening={listening}
            speaking={speaking}
            thinking={thinking}
            onMic={listening ? stopListening : startListening}
            onEnd={() => { stopListening(); stopSpeaking(); }}
          />
        ) : (
          <ChatMode messages={messages} thinking={thinking} scrollRef={scrollRef} />
        )}
      </main>

      {/* Composer (chat mode) */}
      {mode === "chat" && (
        <div className="fixed inset-x-0 bottom-0 z-20 px-6 pb-6">
          <form
            onSubmit={(e) => { e.preventDefault(); void send(input); }}
            className="glass-strong mx-auto flex max-w-3xl items-center gap-2 rounded-3xl p-2"
          >
            <button
              type="button"
              onClick={listening ? stopListening : startListening}
              className={`flex h-11 w-11 items-center justify-center rounded-2xl transition ${
                listening ? "btn-gradient animate-pulse-soft" : "glass"
              }`}
              aria-label="Voice input"
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? "Listening…" : "Message Zoe…"}
              className="flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={!input.trim() || thinking}
              className="btn-gradient flex h-11 w-11 items-center justify-center rounded-2xl disabled:opacity-40"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function CallMode({
  messages, listening, speaking, thinking, onMic, onEnd,
}: {
  messages: Msg[];
  listening: boolean;
  speaking: boolean;
  thinking: boolean;
  onMic: () => void;
  onEnd: () => void;
}) {
  const last = messages[messages.length - 1];
  const status = listening ? "Listening…" : speaking ? "Speaking…" : thinking ? "Thinking…" : "Tap to talk";
  return (
    <div className="flex w-full flex-col items-center pt-2 animate-fade-in">
      <Orb size={200} active={listening || speaking || thinking} />

      <div className="mt-10 min-h-[6rem] max-w-xl text-center">
        {last ? (
          <>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{last.role === "user" ? "You said" : "Zoe"}</p>
            <p className="mt-2 whitespace-pre-line text-balance text-lg leading-relaxed">{last.content}</p>
          </>
        ) : (
          <p className="text-balance text-xl text-muted-foreground">
            Take a quick note. Ask anything. Zoe is ready when you are.
          </p>
        )}
      </div>

      <div className="mt-10 flex flex-col items-center">
        <div className="mb-3 h-6">
          <VoiceBars active={listening || speaking} bars={28} />
        </div>
        <p className="mb-4 text-sm text-muted-foreground">{status}</p>

        <button
          onClick={onMic}
          disabled={thinking}
          className={`relative flex h-20 w-20 items-center justify-center rounded-full btn-gradient transition-all ${
            listening ? "scale-110 animate-pulse-soft" : ""
          } disabled:opacity-50`}
          aria-label="Microphone"
        >
          {listening ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
          {listening && (
            <span className="absolute inset-0 -z-0 rounded-full bg-primary/40 blur-xl animate-pulse-soft" />
          )}
        </button>

        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={onEnd}
            className="glass-pill flex h-12 w-12 items-center justify-center text-destructive"
            aria-label="End"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatMode({
  messages, thinking, scrollRef,
}: { messages: Msg[]; thinking: boolean; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={scrollRef} className="w-full max-h-[calc(100vh-260px)] overflow-y-auto pb-6 pt-2">
      {messages.length === 0 && (
        <div className="flex flex-col items-center pt-12 text-center animate-fade-in">
          <Orb size={180} />
          <h2 className="mt-8 text-2xl font-semibold tracking-tight">How can I help?</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Type a message or tap the mic. I'll explain my reasoning in Urdu so you always know why.
          </p>
        </div>
      )}
      <div className="space-y-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}
            style={{ animation: "rise 0.4s both" }}
          >
            {m.role === "assistant" && (
              <div className="glass flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                <Bot className="h-4 w-4 text-primary" />
              </div>
            )}
            <div
              className={`max-w-[78%] whitespace-pre-line rounded-3xl px-5 py-3 text-sm leading-relaxed ${
                m.role === "user" ? "btn-gradient" : "glass"
              }`}
            >
              {m.content}
            </div>
            {m.role === "user" && (
              <div className="glass flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                <UserIcon className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}
        {thinking && (
          <div className="flex items-center gap-3 animate-fade-in">
            <div className="glass flex h-8 w-8 items-center justify-center rounded-full">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="glass flex items-center gap-1.5 rounded-3xl px-5 py-3.5">
              <span className="h-2 w-2 animate-bounce rounded-full bg-primary" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:120ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:240ms]" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
