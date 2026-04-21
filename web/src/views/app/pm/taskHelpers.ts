function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function avatarColor(seed: string | undefined | null): string {
  if (!seed) return 'oklch(0.6 0.1 260)';
  return `oklch(0.6 0.12 ${hashHue(seed)})`;
}

export function initialOf(name: string | undefined | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() || '').join('') || '?';
}

export type WhenState = 'overdue' | 'today' | 'tomorrow' | 'later' | 'none';

export function formatWhen(iso: string | null | undefined): { text: string; state: WhenState } {
  if (!iso) return { text: '', state: 'none' };
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const delta = Math.round((that - today) / 86_400_000);
  const hasTime = !(d.getHours() === 0 && d.getMinutes() === 0);
  const time = hasTime ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
  if (delta < 0) {
    return { text: `Overdue · ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`, state: 'overdue' };
  }
  if (delta === 0) return { text: time ? `Today · ${time}` : 'Today', state: 'today' };
  if (delta === 1) return { text: time ? `Tomorrow · ${time}` : 'Tomorrow', state: 'tomorrow' };
  if (delta < 7) return { text: d.toLocaleDateString([], { weekday: 'long' }), state: 'later' };
  return { text: d.toLocaleDateString([], { month: 'short', day: 'numeric' }), state: 'later' };
}
