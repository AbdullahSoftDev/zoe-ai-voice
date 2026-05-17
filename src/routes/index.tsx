import { createFileRoute, Link } from "@tanstack/react-router";
import { Mic, Sparkles, Globe2, Waves, ShieldCheck, Brain, LogOut, ArrowRight } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { CosmicBg, VoiceOrb, Waveform } from "@/components/cosmic-bg";
import { ThemeToggle } from "@/components/theme-toggle";

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () => ({
    meta: [
      { title: "Zoe — Your Smart AI Voice Assistant" },
      { name: "description", content: "Speak. Zoe listens. A beautifully crafted voice agent that answers and reasons in Urdu, every time." },
    ],
  }),
});

function HomePage() {
  const { user, signOut } = useAuth();
  const name = user?.user_metadata?.full_name?.split(" ")[0] ?? user?.email?.split("@")[0] ?? "friend";

  return (
    <div className="min-h-screen overflow-hidden relative">
      <CosmicBg stars={70} />

      <header className="relative z-10 flex items-center justify-between px-4 py-4 md:px-12 md:py-5">
        <Link to="/" className="flex items-center gap-2 font-bold text-lg">
          <div className="h-9 w-9 rounded-xl btn-glow flex items-center justify-center">
            <Waves className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="shimmer-text text-xl tracking-tight" style={{ fontFamily: "Space Grotesk" }}>Zoe</span>
          <span className="glass-pill ml-1 hidden sm:inline px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary">Beta</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <button
              onClick={() => signOut()}
              className="glass-pill flex h-10 items-center gap-2 px-4 text-sm transition-transform hover:scale-105"
            >
              <LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Sign out</span>
            </button>
          ) : (
            <Link
              to="/login"
              className="group h-10 flex items-center gap-2 px-5 rounded-full btn-glow text-primary-foreground text-sm font-semibold hover:gap-3 transition-all"
            >
              Sign in
              <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          )}
        </div>
      </header>

      <main className="relative">
        {/* Hero */}
        <section className="px-6 md:px-12 pt-8 pb-24 max-w-6xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
          <div className="animate-fade-up">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass text-xs font-medium text-muted-foreground mb-6">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              AI voice agent · with Urdu reasoning
            </div>
            {user && <p className="text-sm text-muted-foreground mb-3">Welcome back, {name} 👋</p>}
            <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold leading-[1.05] tracking-tight"
                style={{ fontFamily: "Space Grotesk" }}>
              Speak. <span className="shimmer-text">Zoe listens.</span>
              <br />Reasons in <span className="font-urdu inline-block align-middle text-3xl sm:text-4xl md:text-5xl">اردو</span>
            </h1>
            <p className="mt-6 text-lg text-muted-foreground max-w-xl">
              A beautifully crafted voice agent. Talk or type — get instant answers, with the reasoning explained back to you in Urdu, every time.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/voice"
                className="group px-7 py-3.5 rounded-full btn-glow text-primary-foreground font-semibold flex items-center gap-2 hover:gap-3 transition-all"
              >
                <Mic className="h-4 w-4 group-hover:scale-125 transition-transform" /> Start voice call
                <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                to="/voice"
                search={{ mode: "chat" } as never}
                className="px-7 py-3.5 rounded-full glass font-semibold hover:bg-white/5 hover:scale-105 transition-all"
              >
                Send a message
              </Link>
            </div>
            <div className="mt-10 max-w-md"><Waveform bars={36} /></div>
          </div>
          <div className="animate-fade-up flex justify-center lg:justify-end" style={{ animationDelay: "0.2s" }}>
            <VoiceOrb size={340} active>
              <Mic className="h-16 w-16 text-primary animate-glow-pulse" strokeWidth={1.5} />
            </VoiceOrb>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="px-6 md:px-12 py-12 max-w-6xl mx-auto">
          <div className="grid md:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="glass rounded-2xl p-6 card-3d animate-fade-up"
                style={{ animationDelay: `${i * 0.08}s` }}
              >
                <div
                  className="h-11 w-11 rounded-xl btn-glow flex items-center justify-center mb-4 animate-float"
                  style={{ animationDelay: `${i * 0.2}s` }}
                >
                  <f.icon className="h-5 w-5 text-primary-foreground" />
                </div>
                <h3 className="font-bold text-lg mb-1.5" style={{ fontFamily: "Space Grotesk" }}>{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Quick prompts */}
        <section className="px-6 md:px-12 pb-16 max-w-6xl mx-auto">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">Try asking</h2>
          <div className="flex flex-wrap gap-2">
            {prompts.map((p, i) => (
              <Link
                key={p}
                to="/voice"
                search={{ q: p } as never}
                className="glass-pill px-4 py-2 text-sm transition-all hover:scale-105 hover:-translate-y-0.5"
                style={{ animation: `fade-up 0.6s ${i * 0.06}s both` }}
              >
                {p}
              </Link>
            ))}
          </div>
        </section>

        <footer className="px-6 md:px-12 py-10 text-center text-sm text-muted-foreground">
          Built with care · Zoe © {new Date().getFullYear()}
        </footer>
      </main>
    </div>
  );
}

const features = [
  { icon: Mic, title: "Voice & call", desc: "Tap to talk or hold for a live call. Zoe hears you, responds with natural speech." },
  { icon: Globe2, title: "اردو reasoning", desc: "Every answer comes with a clear, written reasoning in Urdu Nastaliq." },
  { icon: Brain, title: "Lightning fast", desc: "Powered by frontier AI models for instant, accurate responses." },
  { icon: ShieldCheck, title: "Private by default", desc: "Your conversations stay yours with strict access controls." },
  { icon: Sparkles, title: "Live transcripts", desc: "Watch your words appear in real-time as you speak." },
  { icon: Waves, title: "Beautiful interface", desc: "An interface designed to feel calm, alive, and trustworthy." },
];

const prompts = [
  "Plan my day for tomorrow",
  "Summarize the latest tech news",
  "Help me write an email",
  "Suggest a healthy dinner",
  "Explain quantum computing simply",
];
