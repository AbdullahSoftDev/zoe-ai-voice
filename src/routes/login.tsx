// src/routes/login.tsx
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Mail, Lock, ArrowRight, Waves, Loader2, Mic, Sparkles, Phone, Globe2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { CosmicBg, VoiceOrb, Waveform } from "@/components/cosmic-bg";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabase } from "@/integrations/supabase/client";
import { signInWithGoogle } from "@/lib/firebase-service";
import { sendOtpEmail } from "@/lib/email-service";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Sign in to Zoe — AI Voice Agent" },
      { name: "description", content: "Sign in to Zoe with Google or email to start talking with your AI voice assistant." },
    ],
  }),
});

type SignupStep = 'details' | 'otp';

function LoginPage() {
  const navigate = useNavigate();
  const { signIn: demoSignIn, user, loading: authLoading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signupStep, setSignupStep] = useState<SignupStep>('details');
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [generatedOtp, setGeneratedOtp] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [tempUserId, setTempUserId] = useState<string | null>(null);

  // Redirect if already logged in (with loading check)
  useEffect(() => {
    if (!authLoading && user) {
      navigate({ to: "/voice" });
    }
  }, [user, authLoading, navigate]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  // ✅ FIXED: Google Sign-In with REAL Supabase user ID for session persistence
  // In login.tsx - handleGoogle function
// In login.tsx - handleGoogle function
const handleGoogle = async () => {
  setOauthLoading(true);
  try {
    const result = await signInWithGoogle();
    
    if (result.error) {
      toast.error(result.error);
      return;
    }
    
    if (result.user) {
      console.log('[Google] User signed in:', result.user.email);
      console.log('[Google] User ID:', result.user.uid);
      
      if (result.user.requiresOtp) {
        toast.info(`Verification email sent to ${result.user.email}. Please check your inbox.`);
        // Still sign in with the user info we have
        demoSignIn(result.user.email, result.user.uid);
        toast.success(`Welcome ${result.user.displayName || result.user.email}!`);
        navigate({ to: "/voice" });
        return;
      }
      
      // ✅ Try to get Supabase session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) {
        console.error('[Google] Session error:', sessionError);
        demoSignIn(result.user.email, result.user.uid);
        toast.success(`Signed in as ${result.user.displayName || result.user.email}`);
        navigate({ to: "/voice" });
        return;
      }
      
      if (session?.user) {
        console.log('[Google] ✅ Supabase session found:', session.user.id);
        demoSignIn(session.user.email || result.user.email, session.user.id);
        toast.success(`Signed in as ${session.user.email || result.user.displayName}`);
        navigate({ to: "/voice" });
      } else {
        // ✅ Try to sign in with OTP if no session
        console.log('[Google] No Supabase session, sending OTP...');
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: result.user.email!,
        });
        
        if (otpError) {
          console.error('[Google] OTP error:', otpError);
          demoSignIn(result.user.email, result.user.uid);
          toast.success(`Signed in as ${result.user.displayName || result.user.email}`);
          navigate({ to: "/voice" });
        } else {
          toast.info(`Verification email sent to ${result.user.email}`);
          demoSignIn(result.user.email, result.user.uid);
          navigate({ to: "/voice" });
        }
      }
    }
  } catch (error: any) {
    console.error("Google sign in error:", error);
    toast.error(error.message || "Google sign in failed");
  } finally {
    setOauthLoading(false);
  }
};  // Step 1: Create user in Supabase and send OTP
  const handleSendOtp = async () => {
    if (!email || !password || !name) {
      toast.error("Please fill in all fields");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (!email.includes('@')) {
      toast.error("Please enter a valid email address");
      return;
    }

    setOtpLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password: password,
        options: {
          data: {
            full_name: name,
          },
          emailRedirectTo: window.location.origin + '/login',
        },
      });

      if (error) {
        if (error.message.includes('already registered')) {
          toast.error("An account with this email already exists. Please sign in.");
          setMode("signin");
          setOtpLoading(false);
          return;
        }
        throw error;
      }

      if (data.user) {
        setTempUserId(data.user.id);
        
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        setGeneratedOtp(otpCode);
        
        console.log('[OTP] Generated code:', otpCode);
        console.log('[OTP] Sending to:', email, 'Name:', name);
        
        const result = await sendOtpEmail(email, name, otpCode);
        
        console.log('[OTP] Result:', result);
        
        if (result.success) {
          toast.success("Verification code sent to your email");
          setSignupStep('otp');
        } else {
          toast.error(result.error || "Failed to send verification code");
        }
      }
    } catch (err: any) {
      console.error("Signup error:", err);
      toast.error(err.message || "Sign up failed");
    } finally {
      setOtpLoading(false);
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (resendCooldown > 0) {
      toast.info(`Please wait ${resendCooldown} seconds before resending`);
      return;
    }
    
    setOtpLoading(true);
    try {
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      setGeneratedOtp(otpCode);
      
      const emailResult = await sendOtpEmail(email, name, otpCode);
      if (emailResult.success) {
        toast.success("New verification code sent");
        setResendCooldown(60);
      } else {
        toast.error(emailResult.error || "Failed to resend code");
      }
    } catch (err: any) {
      toast.error("Failed to resend code");
    } finally {
      setOtpLoading(false);
    }
  };

  // Step 2: Verify OTP and complete signup
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const otpCode = otp.join('');
    
    if (otpCode.length !== 6) {
      toast.error("Please enter the 6-digit verification code");
      return;
    }
    
    if (otpCode !== generatedOtp) {
      toast.error("Invalid verification code. Please try again.");
      return;
    }
    
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      });
      
      if (error) throw error;
      
      if (data.user) {
        // ✅ Pass REAL user ID for session persistence
        demoSignIn(data.user.email, data.user.id);
        toast.success("Account verified! Welcome to Zoe!");
        navigate({ to: "/voice" });
      }
    } catch (err: any) {
      console.error("Verification error:", err);
      toast.error(err.message || "Verification failed. Please try signing in manually.");
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    
    if (value && index < 5) {
      const nextInput = document.getElementById(`otp-${index + 1}`);
      nextInput?.focus();
    }
  };

  // REAL Supabase Email/Password Sign In
  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please enter email and password");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      });
      if (error) throw error;
      if (data.user) {
        // ✅ Pass REAL user ID for session persistence
        demoSignIn(data.user.email, data.user.id);
        toast.success("Signed in successfully");
        navigate({ to: "/voice" });
      }
    } catch (err: any) {
      console.error("Login error:", err);
      toast.error(err.message || "Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  // Reset signup flow
  const resetSignup = () => {
    setSignupStep('details');
    setOtp(['', '', '', '', '', '']);
    setGeneratedOtp(null);
    setTempUserId(null);
  };

  // Show loading state
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <div className="text-center">
          <Loader2 className="h-12 w-12 text-cyan-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

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
                { icon: ShieldCheck, label: "Secure" },
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
              {mode === "signin" ? (
                // SIGN IN FORM
                <>
                  <h1 className="text-3xl font-bold text-center mb-1" style={{ fontFamily: "Space Grotesk" }}>
                    Welcome back
                  </h1>
                  <p className="text-center text-sm text-muted-foreground mb-6">
                    Sign in to talk to Zoe
                  </p>

                  {/* Google Sign-In */}
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

                  <form onSubmit={handleEmailSignIn} className="space-y-3">
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
                      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Sign in <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" /></>}
                    </button>
                  </form>

                  <p className="text-center text-sm text-muted-foreground mt-6">
                    New here?{" "}
                    <button
                      onClick={() => { setMode("signup"); resetSignup(); }}
                      className="text-primary font-semibold story-link"
                    >
                      Create an account
                    </button>
                  </p>
                </>
              ) : signupStep === 'details' ? (
                // SIGN UP - DETAILS STEP
                <>
                  <h1 className="text-3xl font-bold text-center mb-1" style={{ fontFamily: "Space Grotesk" }}>
                    Create account
                  </h1>
                  <p className="text-center text-sm text-muted-foreground mb-6">
                    Enter your details to get started
                  </p>

                  <form onSubmit={(e) => { e.preventDefault(); handleSendOtp(); }} className="space-y-3">
                    <input
                      type="text"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="w-full px-4 py-3 rounded-xl bg-input border border-border focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-glow)] outline-none transition-all duration-300"
                    />
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
                        placeholder="Password (min 6 characters)"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 rounded-xl bg-input border border-border focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-glow)] outline-none transition-all duration-300"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={otpLoading}
                      className="group w-full py-3 rounded-xl btn-glow text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-60 hover:gap-3 transition-all"
                    >
                      {otpLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Send Verification Code <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" /></>}
                    </button>
                  </form>

                  <p className="text-center text-sm text-muted-foreground mt-6">
                    Already have an account?{" "}
                    <button
                      onClick={() => { setMode("signin"); resetSignup(); }}
                      className="text-primary font-semibold story-link"
                    >
                      Sign in
                    </button>
                  </p>
                </>
              ) : (
                // SIGN UP - OTP VERIFICATION STEP
                <>
                  <h1 className="text-3xl font-bold text-center mb-1" style={{ fontFamily: "Space Grotesk" }}>
                    Verify your email
                  </h1>
                  <p className="text-center text-sm text-muted-foreground mb-6">
                    Enter the 6-digit code sent to {email}
                  </p>

                  <form onSubmit={handleVerifyOtp} className="space-y-6">
                    <div className="flex justify-center gap-2">
                      {otp.map((digit, index) => (
                        <input
                          key={index}
                          id={`otp-${index}`}
                          type="text"
                          maxLength={1}
                          value={digit}
                          onChange={(e) => handleOtpChange(index, e.target.value)}
                          className="w-12 h-12 text-center text-xl font-bold rounded-xl bg-input border border-border focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-glow)] outline-none transition-all duration-300"
                          autoFocus={index === 0}
                        />
                      ))}
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="group w-full py-3 rounded-xl btn-glow text-primary-foreground font-semibold flex items-center justify-center gap-2 disabled:opacity-60 hover:gap-3 transition-all"
                    >
                      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Verify & Sign In <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" /></>}
                    </button>
                  </form>

                  <p className="text-center text-sm text-muted-foreground mt-6">
                    Didn't receive code?{" "}
                    <button
                      onClick={handleResendOtp}
                      disabled={resendCooldown > 0}
                      className="text-primary font-semibold story-link disabled:opacity-50"
                    >
                      {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                    </button>
                  </p>

                  <button
                    onClick={resetSignup}
                    className="w-full text-center text-sm text-muted-foreground mt-4 hover:text-primary transition-colors"
                  >
                    ← Back to details
                  </button>
                </>
              )}
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
