// Generate a deterministic striped SVG placeholder cover from a seed.
export function coverFor(seed: number, label?: string): string {
  const hues = [12, 230, 300, 160, 50, 195];
  const h = hues[((seed % hues.length) + hues.length) % hues.length];
  const bg1 = `oklch(0.78 0.1 ${h})`;
  const bg2 = `oklch(0.72 0.08 ${h + 30})`;
  const stripe = `oklch(0.6 0.14 ${h})`;
  const svg = `
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 220' preserveAspectRatio='xMidYMid slice'>
      <defs>
        <linearGradient id='g${seed}' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0' stop-color='${bg1}'/><stop offset='1' stop-color='${bg2}'/>
        </linearGradient>
        <pattern id='p${seed}' width='12' height='12' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'>
          <rect width='12' height='12' fill='transparent'/>
          <line x1='0' y1='0' x2='0' y2='12' stroke='${stripe}' stroke-width='1' opacity='0.18'/>
        </pattern>
      </defs>
      <rect width='400' height='220' fill='url(#g${seed})'/>
      <rect width='400' height='220' fill='url(#p${seed})'/>
      <text x='14' y='28' font-family='ui-monospace, Menlo, monospace' font-size='10' fill='rgba(20,20,25,0.55)' letter-spacing='0.12em'>${(label || 'ARTWORK').toUpperCase()}</text>
      <text x='14' y='210' font-family='ui-monospace, Menlo, monospace' font-size='9' fill='rgba(20,20,25,0.35)' letter-spacing='0.08em'>PLACEHOLDER · ${String(seed).padStart(3, '0')}</text>
    </svg>
  `.trim();
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

// Turn a task id into a stable integer seed.
export function seedFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Human-friendly request ID.
 * Prefers the sequential `tasks.display_number` (starting at 1000) when
 * available; falls back to a last-4 slug of the UUID for legacy rows
 * that haven't been backfilled yet.
 */
export function shortRequestId(taskOrId: { id: string; display_number?: number | null } | string): string {
  if (typeof taskOrId === 'string') {
    return `REQ-${taskOrId.replace(/-/g, '').slice(-4).toUpperCase()}`;
  }
  if (taskOrId.display_number != null) {
    return `REQ-${taskOrId.display_number}`;
  }
  return `REQ-${taskOrId.id.replace(/-/g, '').slice(-4).toUpperCase()}`;
}
