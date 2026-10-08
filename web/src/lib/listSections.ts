import type { SpaceStatus, TaskType } from '@squadhub/shared';

// Groups in the List view can sit under a higher-level section: statuses
// under their picker section (Not started / Active / Blocked / Paused /
// Closed) and task types under their admin group (Task Types, Meetings &
// Collaboration, …). These helpers bucket already-ordered groups into
// sections without changing the order of groups inside each section.

export type ListSectionMeta = { key: string; label: string; emoji?: string | null; color?: string | null };

export type Sectioned<T> = { section: ListSectionMeta; items: T[] };

/**
 * Bucket items by section. Sections appear in `order` first (when given),
 * then in order of first appearance. Items without a section collect in a
 * trailing "Other" section. Returns null when nothing has a section, so
 * callers can fall back to a flat list.
 */
export function sectionize<T>(
  items: T[],
  sectionOf: (item: T) => ListSectionMeta | null,
  order?: string[],
): Sectioned<T>[] | null {
  const map = new Map<string, Sectioned<T>>();
  const other: Sectioned<T> = { section: { key: '__other__', label: 'Other' }, items: [] };
  let any = false;
  for (const item of items) {
    const meta = sectionOf(item);
    if (!meta) { other.items.push(item); continue; }
    any = true;
    let s = map.get(meta.key);
    if (!s) { s = { section: meta, items: [] }; map.set(meta.key, s); }
    s.items.push(item);
  }
  if (!any) return null;
  const sections = [...map.values()];
  if (order && order.length > 0) {
    const rank = (k: string) => { const i = order.indexOf(k); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
    sections.sort((a, b) => rank(a.section.key) - rank(b.section.key));
  }
  if (other.items.length > 0) sections.push(other);
  return sections;
}

/** Accent per status section, matching the bucket colours. */
const STATUS_SECTION_COLORS: Record<string, string> = {
  not_started: '#64748b',
  priority_urgency: '#e11d48',
  in_motion: '#2563eb',
  up_next: '#0891b2',
  scheduled_queued: '#0ea5e9',
  routines: '#7c3aed',
  blocked_paused: '#d97706',
  done: '#059669',
};

export function statusSection(s: SpaceStatus): ListSectionMeta | null {
  if (!s.group) return null;
  return { key: s.group, label: s.groupLabel || s.group, emoji: s.groupEmoji, color: STATUS_SECTION_COLORS[s.group] || null };
}

export function taskTypeSection(t: TaskType | null | undefined, groupOf: (t: TaskType) => string): ListSectionMeta | null {
  if (!t) return null;
  const name = groupOf(t);
  return { key: name, label: name };
}
