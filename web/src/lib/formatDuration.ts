// Shared duration formatters used across timer/timesheet UIs.

export function formatTracked(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  if (h && m) return `${sign}${h}h ${m}m`;
  if (h) return `${sign}${h}h`;
  return `${sign}${m}m`;
}

export function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatTimeRange(startedAt: string, stoppedAt: string): string {
  const start = new Date(startedAt);
  const end = new Date(stoppedAt);
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${fmt(start)} – ${fmt(end)}`;
}

// Header label for a date grouping: "Today", "Yesterday", else weekday + date
// e.g. "Monday, Apr 21".
export function formatDateHeader(dateKey: string): string {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const yesterday = new Date(today.getTime() - 86_400_000);
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  if (dateKey === todayKey) return 'Today';
  if (dateKey === yesterdayKey) return 'Yesterday';
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString([], sameYear
    ? { weekday: 'long', month: 'short', day: 'numeric' }
    : { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

// "YYYY-MM-DD" key in the user's local timezone.
export function toLocalDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
