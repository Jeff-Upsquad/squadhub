import type { MeetingSlot } from '@squadhub/shared';

// Meeting primary accent — the teal-green from the mockup.
export const MEETING_ACCENT = '#0a7d55';

export function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) % 360;
  return h;
}
export function avatarColor(seed: string | undefined | null): string {
  if (!seed) return 'oklch(0.6 0.12 250)';
  return `oklch(0.6 0.12 ${hashHue(seed)})`;
}
export function initialOf(name: string | undefined | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const pad = (n: number) => String(n).padStart(2, '0');

// minute-of-day → "5:00 PM"
export function minToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${period}`;
}

// "HH:MM" (from a <input type=time>) → minutes
export function timeStrToMin(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
// minutes → "HH:MM" for an <input type=time>
export function minToTimeStr(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

// "YYYY-MM-DD" → "Feb 25, 2024"
export function formatSlotDate(slotDate: string): string {
  const d = new Date(`${slotDate}T00:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Human label for a slot's time range, or "All day" for dates-only slots.
export function slotTimeLabel(slot: Pick<MeetingSlot, 'start_min' | 'end_min'>): string {
  if (slot.start_min == null) return 'All day';
  const end = slot.end_min ?? slot.start_min + 30;
  return `${minToLabel(slot.start_min)} to ${minToLabel(end)}`;
}

export const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;
export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = min / 60;
  return Number.isInteger(h) ? `${h} hr` : `${Math.floor(min / 60)} hr ${min % 60} min`;
}
