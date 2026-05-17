import { useEffect, useState } from "react";

/**
 * Aria-style cosmic background: aurora blobs + twinkling starfield.
 * Stars are generated client-only to avoid SSR/hydration mismatches.
 */
export function CosmicBg({ stars = 60 }: { stars?: number }) {
  const [starList, setStarList] = useState<
    Array<{ id: number; top: number; left: number; delay: number; duration: number; scale: number }>
  >([]);

  useEffect(() => {
    setStarList(
      Array.from({ length: stars }, (_, i) => ({
        id: i,
        top: Math.random() * 100,
        left: Math.random() * 100,
        delay: Math.random() * 4,
        duration: 2 + Math.random() * 3,
        scale: 0.5 + Math.random() * 1.5,
      })),
    );
  }, [stars]);

  return (
    <div className="cosmic-bg" aria-hidden>
      <div
        className="aurora animate-aurora"
        style={{
          width: 520,
          height: 520,
          top: "-10%",
          left: "-10%",
          background: "var(--gradient-orb)",
        }}
      />
      <div
        className="aurora animate-aurora"
        style={{
          width: 600,
          height: 600,
          bottom: "-15%",
          right: "-12%",
          background:
            "radial-gradient(circle at 30% 30%, var(--accent), var(--primary) 70%)",
          animationDelay: "3s",
        }}
      />
      <div
        className="aurora animate-aurora"
        style={{
          width: 380,
          height: 380,
          top: "40%",
          left: "55%",
          background:
            "radial-gradient(circle, var(--primary-glow), transparent 70%)",
          animationDelay: "6s",
          opacity: 0.4,
        }}
      />
      {starList.map((s) => (
        <span
          key={s.id}
          className="star animate-twinkle"
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.duration}s`,
            transform: `scale(${s.scale})`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Animated voice orb — concentric ripples, spinning conic shine, orbiting
 * accent dots, floating glass core. Aria-style.
 */
export function VoiceOrb({
  size = 240,
  active = false,
  children,
}: {
  size?: number;
  active?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="relative flex items-center justify-center pointer-events-none"
      style={{ width: size, height: size }}
    >
      {/* Ripples */}
      <span
        className="absolute inset-0 rounded-full animate-ripple"
        style={{ background: "var(--gradient-orb)", opacity: 0.35 }}
      />
      <span
        className="absolute inset-0 rounded-full animate-ripple"
        style={{
          background: "var(--gradient-orb)",
          opacity: 0.25,
          animationDelay: "0.7s",
        }}
      />
      {/* Orbiting dots */}
      {[0, 120, 240].map((deg, i) => (
        <span
          key={i}
          className="absolute h-2.5 w-2.5 rounded-full bg-primary"
          style={{
            boxShadow: "0 0 12px var(--color-primary)",
            animation: `orb-spin ${10 + i * 2}s linear infinite`,
            transformOrigin: `${size / 2 + 20}px center`,
            transform: `rotate(${deg}deg)`,
          }}
        />
      ))}
      {/* Core orb */}
      <div
        className={`relative rounded-full overflow-hidden animate-pulse-glow animate-float ${active ? "animate-glow-pulse" : ""}`}
        style={{
          width: size * 0.78,
          height: size * 0.78,
          background: "var(--gradient-orb)",
        }}
      >
        <div
          className="absolute inset-0 animate-orb-spin opacity-60"
          style={{
            background:
              "conic-gradient(from 0deg, transparent, oklch(0.95 0.1 200 / 0.5), transparent 60%)",
          }}
        />
        <div className="absolute inset-5 rounded-full glass flex items-center justify-center">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Animated equalizer-style waveform bars */
export function Waveform({ bars = 24, active = true }: { bars?: number; active?: boolean }) {
  return (
    <div className="flex items-center justify-center gap-1 h-12">
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={`w-1 rounded-full bg-gradient-to-t from-primary to-accent ${active ? "animate-wave-bar" : ""}`}
          style={{
            height: "100%",
            animationDelay: `${(i % 6) * 0.12}s`,
            animationDuration: `${0.8 + (i % 4) * 0.15}s`,
            opacity: active ? 1 : 0.3,
          }}
        />
      ))}
    </div>
  );
}
