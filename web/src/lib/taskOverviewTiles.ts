import type { Task } from '@squadhub/shared';
import { isTaskCompleted } from './taskGrouping';
import { stageKeyOf } from './stageWorkflow';

export const OVERVIEW_TILES = [
  { key: 'all', name: 'All tasks', dot: '#B7BCC0' },
  { key: 'urgent', name: 'Urgent', dot: '#FF453A' },
  { key: 'today', name: 'Today', dot: '#39C66B' },
  { key: 'due', name: 'Due date', dot: '#FFB340' },
  { key: 'tomorrow', name: 'Tomorrow', dot: '#B7BCC0' },
  { key: 'attention', name: 'Needs attention', dot: '#7c3aed' },
] as const;
export type OverviewTile = typeof OVERVIEW_TILES[number]['key'];

export function overviewDay(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  // Calendar-only dates belong to the chosen day in every time zone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** The six shortcuts in the design use the same predicates for counts and rows. */
export function matchesOverviewTile(task: Task, tile: OverviewTile, tz: string, now = new Date()): boolean {
  if (tile === 'all') return true;
  if (isTaskCompleted(task)) return false;
  if (tile === 'urgent') return task.priority === 'urgent' || task.priority === 'top' || task.priority === 'emergency';
  if (tile === 'attention') return ['help', 'unblocked'].includes(stageKeyOf(task).toLowerCase());
  const today = overviewDay(now.toISOString(), tz)!;
  const work = overviewDay(task.work_date, tz);
  const due = overviewDay(task.due_date, tz);
  if (tile === 'today') return !!work && work <= today;
  if (tile === 'due') return !!due && due <= today;
  const next = new Date(`${today}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const tomorrow = next.toISOString().slice(0, 10);
  return work === tomorrow || due === tomorrow || overviewDay(task.start_date, tz) === tomorrow;
}

export function taskOverviewSummary(tasks: Task[], tz: string, scope?: string, now = new Date()): string {
  const open = tasks.filter((t) => !isTaskCompleted(t));
  const urgent = open.filter((t) => matchesOverviewTile(t, 'urgent', tz, now));
  const today = overviewDay(now.toISOString(), tz)!;
  const lead = open.find((t) => { const d = overviewDay(t.due_date, tz); return !!d && d < today; })
    || open.find((t) => overviewDay(t.due_date, tz) === today);
  return `You have ${open.length} open ${open.length === 1 ? 'task' : 'tasks'}${scope ? ` across ${scope}` : ''}`
    + (urgent.length ? `, ${urgent.length} marked urgent.` : '.')
    + (lead ? ` ${lead.title} is ${overviewDay(lead.due_date, tz)! < today ? 'overdue' : 'due today'}.` : '');
}
