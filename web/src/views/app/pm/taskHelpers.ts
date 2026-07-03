import type { SpaceStatus, TaskTypeField } from '@squadhub/shared';
import { getTaskStatusCategory } from '@squadhub/shared';

/** Short scalar field types that can pair 2-up in the brief form. Long-form
 *  controls (textarea, multi_select, select) always span full width. */
export const PAIRABLE_FIELD_TYPES = new Set<string>(['text', 'url', 'number', 'date']);

/** Greedily group a flat field list so consecutive short scalars pair into
 *  2-up rows; everything else (and a lone trailing scalar) spans full width. */
export function groupDesignFields(fields: TaskTypeField[]): TaskTypeField[][] {
  const groups: TaskTypeField[][] = [];
  let i = 0;
  while (i < fields.length) {
    const f = fields[i];
    const next = fields[i + 1];
    if (PAIRABLE_FIELD_TYPES.has(f.field_type) && next && PAIRABLE_FIELD_TYPES.has(next.field_type)) {
      groups.push([f, next]);
      i += 2;
    } else {
      groups.push([f]);
      i += 1;
    }
  }
  return groups;
}

function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/** Does this status string represent a completed task? Handles the three forms
 *  tasks actually store: the literal category ('done'/'closed'), a built-in
 *  catalog key (task-type statuses), and a custom space status NAME resolved
 *  against the space's statuses (design/video spaces store names). */
export function statusIsComplete(status: string | null | undefined, statuses: SpaceStatus[]): boolean {
  if (!status) return false;
  if (status === 'done' || status === 'closed') return true;
  const cat = getTaskStatusCategory(status);
  if (cat === 'done' || cat === 'closed') return true;
  const match = statuses.find((s) => s.name === status);
  return match?.category === 'done' || match?.category === 'closed';
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

/**
 * Returns the next ISO date for the "set to today / advance" quick action.
 * - If no date set → today (midnight, no time)
 * - If date is today → tomorrow (midnight, no time)
 * - Otherwise → today (resets)
 * Uses midnight so formatWhen doesn't render a time component.
 */
export function nextQuickDate(currentIso: string | null | undefined): string {
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  if (!currentIso) return todayMidnight.toISOString();
  const cur = new Date(currentIso);
  cur.setHours(0, 0, 0, 0);
  if (cur.getTime() === todayMidnight.getTime()) {
    const tomorrow = new Date(todayMidnight);
    tomorrow.setDate(todayMidnight.getDate() + 1);
    return tomorrow.toISOString();
  }
  return todayMidnight.toISOString();
}

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
