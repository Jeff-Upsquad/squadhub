import type { Task } from '@squadhub/shared';

export type GroupBy = 'none' | 'work_date' | 'due_date' | 'priority' | 'space' | 'folder' | 'list';

export const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'work_date', label: 'Work date' },
  { value: 'due_date', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'space', label: 'Space' },
  { value: 'folder', label: 'Folder' },
  { value: 'list', label: 'List' },
];

export const PRIORITY_ORDER: Record<string, number> = {
  emergency: 0,
  urgent: 1,
  high: 2,
  normal: 3,
  low: 4,
  none: 5,
};

export const PRIORITY_LABELS: Record<string, string> = {
  emergency: 'Emergency',
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
  none: 'No priority',
};

export type Group = { key: string; label: string; sort: number | string; tasks: Task[] };

export function groupByDate(tasks: Task[], field: 'work_date' | 'due_date', tz: string, emptyLabel: string): Group[] {
  const fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const fmtLabel = new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
  const now = new Date();
  const todayKey = fmtKey.format(now);
  const tomorrowKey = fmtKey.format(new Date(now.getTime() + 86_400_000));

  const map = new Map<string, Group>();
  for (const t of tasks) {
    const raw = (t as unknown as Record<string, string | null>)[field];
    if (!raw) {
      const k = '__none__';
      if (!map.has(k)) map.set(k, { key: k, label: emptyLabel, sort: Number.MAX_SAFE_INTEGER, tasks: [] });
      map.get(k)!.tasks.push(t);
      continue;
    }
    const d = new Date(raw);
    const key = fmtKey.format(d);
    if (!map.has(key)) {
      let label: string;
      if (key === todayKey) label = 'Today';
      else if (key === tomorrowKey) label = 'Tomorrow';
      else if (key < todayKey) label = `Overdue · ${fmtLabel.format(d)}`;
      else label = fmtLabel.format(d);
      map.set(key, { key, label, sort: key, tasks: [] });
    }
    map.get(key)!.tasks.push(t);
  }
  return [...map.values()].sort((a, b) => {
    if (typeof a.sort === 'number' && typeof b.sort === 'number') return a.sort - b.sort;
    if (typeof a.sort === 'number') return 1;
    if (typeof b.sort === 'number') return -1;
    return (a.sort as string).localeCompare(b.sort as string);
  });
}

export function groupByPriority(tasks: Task[]): Group[] {
  const map = new Map<string, Group>();
  for (const t of tasks) {
    const p = (t.priority as string) || 'none';
    if (!map.has(p)) {
      map.set(p, {
        key: p,
        label: PRIORITY_LABELS[p] || p,
        sort: PRIORITY_ORDER[p] ?? 99,
        tasks: [],
      });
    }
    map.get(p)!.tasks.push(t);
  }
  return [...map.values()].sort((a, b) => (a.sort as number) - (b.sort as number));
}

export function groupByNamedRef(
  tasks: Task[],
  pick: (t: Task) => { id: string; name: string } | null | undefined,
  emptyLabel: string,
): Group[] {
  const map = new Map<string, Group>();
  for (const t of tasks) {
    const ref = pick(t);
    const key = ref?.id || '__none__';
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: ref?.name || emptyLabel,
        sort: ref ? (ref.name || '').toLowerCase() : '\uffff',
        tasks: [],
      });
    }
    map.get(key)!.tasks.push(t);
  }
  return [...map.values()].sort((a, b) => (a.sort as string).localeCompare(b.sort as string));
}

export function groupTasks(tasks: Task[], by: GroupBy, tz: string): Group[] {
  switch (by) {
    case 'work_date':
      return groupByDate(tasks, 'work_date', tz, 'No work date');
    case 'due_date':
      return groupByDate(tasks, 'due_date', tz, 'No due date');
    case 'priority':
      return groupByPriority(tasks);
    case 'space':
      return groupByNamedRef(tasks, (t) => t.space ?? null, 'No space');
    case 'folder':
      return groupByNamedRef(
        tasks,
        (t) => (t as unknown as { folder?: { id: string; name: string } | null }).folder ?? null,
        'No folder',
      );
    case 'list':
      return groupByNamedRef(tasks, (t) => t.list ?? null, 'No list');
    default:
      return [];
  }
}
