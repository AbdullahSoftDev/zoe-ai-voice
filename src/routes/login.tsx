import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Mail, Lock, ArrowRight, Waves, Loader2, Mic, Sparkles, Phone, Globe2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { CosmicBg, VoiceOrb, Waveform } from "@/components/cosmic-bg";
import { ThemeToggle } from "@/components/theme-toggle";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Sign in to Zoe — AI Voice Agent" },
      { name: "description", content: "Sign in to Zoe with Google or email to start talking with your AI voice assistant." },
    ],
  }),
});

function LoginPage() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  // UI-only handlers — wire real auth (Supabase / Firebase) later.
  const handleGoogle = async () => {
    setOauthLoading(true);
    setTimeout(() => {
      signIn("you@gmail.com");
      toast.success("Signed in (demo)");
      navigate({ to: "/" });
    }, 400);
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      signIn(email || "demo@zoe.app");
      toast.success(mode === "signup" ? "Account created (demo)" : "Signed in (demo)");
      navigate({ to: "/" });
    }, 400);
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      <CosmicBg stars={80} />

      <div className="absolute top-5 right-5 z-20">
        <ThemeToggle />
      </div>

      <div className="relative grid lg:grid-cols-2 min-h-screen">
        {/* LEFT — animated hero */}
        <div className="hidden lg:flex flex-col items-center justify-center p-12 relative animate-slide-in-left">
          <Link to="/" className="absolute top-8 left-8 flex items-center gap-2">
            <div className="h-10 w-10 rounded-xl btn-glow flex items-center justify-center">
              <Waves className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-2xl font-bold shimmer-text" style={{ fontFamily: "Space Grotesk" }}>Zoe</span>
          </Link>

          <VoiceOrb size={320} active>
            <Mic className="h-20 w-20 text-primary animate-glow-pulse" strokeWidth={1.5} />
          </VoiceOrb>

          <div className="mt-12 text-center max-w-md animate-fade-up" style={{ animationDelay: "0.4s" }}>
            <h2 className="text-4xl font-extrabold leading-tight" style={{ fontFamily: "Space Grotesk" }}>
              Your voice, <span className="shimmer-text">understood</span>.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Speak. Call. Type. Zoe replies in natural voice and reasons in
              <span className="font-urdu inline-block align-middle text-xl mx-1">اردو</span>
              every time.
            </p>
            <div className="mt-6"><Waveform bars={32} /></div>

            <div className="mt-8 flex justify-center gap-6 text-xs text-muted-foreground">
              {[
                { icon: Phone, label: "Live calls" },
                { icon: Globe2, label: "اردو reasoning" },
                { icon: Sparkles, label: "Real-time" },
              ].map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 animate-fade-up"
                  style={{ animationDelay: `${0.6 + i * 0.15}s` }}
                >
                  <f.icon className="h-3.5 w-3.5 text-primary" />
                  {f.label}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — auth form */}
        <div className="flex items-center justify-center px-6 py-12 animate-slide-in-right">
          <div className="w-full max-w-md">
            <Link to="/" className="flex lg:hidden items-center justify-center gap-2 mb-8">
              <div className="h-10 w-10 rounded-xl btn-glow flex items-center justify-center">
                <Waves className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="text-2xl font-bold shimmer-text" style={{ fontFamily: "Space Grotesk" }}>Zoe</span>
            </Link>

            <div className="glass rounded-3xl p-8 shadow-2xl card-3d animate-fade-up">
              <h1 className="text-3xl font-bold text-center mb-1" style={{ fontFamily: "Space Grotesk" }}>
                {mode === "signin" ? "Welcome back" : "Create account"}
              </h1>
              <p className="text-center text-sm text-muted-foreground mb-6">
                {mode === "signin" ? "Sign in to talk to Zoe" : "Start talking with Zoe today"}
              </p>

              <button
                onClick={handleGoogle}
                disabled={oauthLoading}
                className="group w-full flex items-center justify-center gap-3 py-3 rounded-xl glass text-foreground font-semibold hover:bg-white hover:text-gray-800 hover:scale-[1.03] hover:shadow-2xl transition-all duration-300 disabled:opacity-60"
              >
                {oauthLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <svg className="h-5 w-5 group-hover:rotate-12 transition-transform" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
                  </svg>
                )}
                Continue with Google
              </button>

              <div className="flex items-center gap-3 my-6">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or with email</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <form onSubmit={handleEmail} className="space-y-3">
                {mode === "signup" && (
                  <input
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-input border border-border focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-glow)] outline-none transition-all duration-300"
                  />
                )}
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="email"
                    required
                    placeholder="you@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-input border border-border focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-glow)] outline-none transition-all duration-300"
                  />
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-input border border-border focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-glow)] outline-none transition-all duration-300"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="group w-full py-3 rounded-xl btn-glow text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-60 hover:gap-3 transition-all"
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      {mode === "signin" ? "Sign in" : "Create account"}
                      <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>
              </form>

              <p className="text-center text-sm text-muted-foreground mt-6">
                {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
                <button
                  onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                  className="text-primary font-semibold story-link"
                >
                  {mode === "signin" ? "Create an account" : "Sign in"}
                </button>
              </p>
            </div>

            <div
              className="flex items-center justify-center gap-2 mt-6 text-xs text-muted-foreground animate-fade-up"
              style={{ animationDelay: "0.4s" }}
            >
              <Mic className="h-3.5 w-3.5 animate-pulse text-primary" /> Voice ready · اردو reasoning included
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
