import { Mic } from "lucide-react";
import { VoiceOrb } from "@/components/cosmic-bg";

type Props = {
  size?: number;
  active?: boolean;
  className?: string;
};

/**
 * Compatibility wrapper — keeps the `Orb` export used across the app while
 * delegating to the Aria-style VoiceOrb (ripples + orbit + glow + glass core).
 */
export function Orb({ size = 280, active = false }: Props) {
  return (
    <VoiceOrb size={size} active={active}>
      <Mic
        className="text-primary animate-glow-pulse"
        style={{ width: size * 0.22, height: size * 0.22 }}
        strokeWidth={1.5}
      />
    </VoiceOrb>
  );
}
