'use client';

// Thin hand-rolled fill bar for target progress. Green at/above 100%.
export default function ProgressBar({
  pct,
  title,
  className = '',
}: {
  pct: number;
  title?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className={`h-1 w-full overflow-hidden rounded-full bg-canvas ring-1 ring-divider ${className}`}
      title={title}
    >
      <div
        className={`h-full rounded-full ${pct >= 100 ? 'bg-[#16A34A]' : 'bg-accent'}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
