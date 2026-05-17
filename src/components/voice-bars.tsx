type Props = { active?: boolean; bars?: number };

export function VoiceBars({ active = true, bars = 24 }: Props) {
  return (
    <div className="flex h-12 items-center justify-center gap-1">
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="w-1 rounded-full bg-primary"
          style={{
            height: `${20 + (i % 5) * 10}%`,
            animation: active
              ? `wave 1.${(i % 6) + 1}s ease-in-out ${i * 40}ms infinite`
              : "none",
            opacity: active ? 1 : 0.3,
          }}
        />
      ))}
    </div>
  );
}
