import { useEffect, useState } from 'react';

function formatHM(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

export default function LiveTimer({
  trackedSeconds,
  ticking = false,
  startedAt,
  baseTracked,
}: {
  trackedSeconds?: number;
  ticking?: boolean;
  startedAt?: number;
  baseTracked?: number;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  let total = trackedSeconds ?? 0;
  if (ticking && startedAt) {
    total = (baseTracked ?? 0) + Math.floor((Date.now() - startedAt) / 1000);
  }

  return (
    <span className={`cd-req-timer${ticking ? ' ticking' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      {ticking && <span className="tick-dot" />}
      <span aria-hidden>{/* make tick re-render */}{tick && ''}</span>
      {formatHM(total)}
    </span>
  );
}

export function formatHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0h';
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  const m = Math.round(hours * 60);
  return `${m}m`;
}
