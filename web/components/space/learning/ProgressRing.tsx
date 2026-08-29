/**
 * A topic's completion, drawn as a ring.
 *
 * This replaced a system emoji sitting in a bordered tile. The emoji was
 * whatever the model happened to pick, rendered at whatever the OS font
 * decided — it carried no information and read as clip art. The ring is the
 * one number the card is actually about, and it inherits the theme.
 */
export function ProgressRing({
  value,
  size = 36,
  stroke = 2.5,
  showLabel = true,
}: {
  /** Completion in 0..1. */
  value: number;
  size?: number;
  stroke?: number;
  showLabel?: boolean;
}) {
  const safe = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const percent = Math.round(safe * 100);

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} aria-hidden="true" className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        {safe > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - safe)}
            className="transition-[stroke-dashoffset] duration-500"
          />
        )}
      </svg>
      {showLabel && (
        <span className="absolute text-[10px] font-medium tabular-nums text-[var(--muted-foreground)]">
          {percent}
        </span>
      )}
    </span>
  );
}
