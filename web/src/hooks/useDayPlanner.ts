import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { Task, TaskDayPlan } from '@squadhub/shared';
import { usePMStore } from '../stores/pmStore';

// ---------- helpers ----------

function tzNow(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// YYYY-MM-DD in user's local tz. Mirrors web/src/lib/taskGrouping.ts.
export function planDateKey(d = new Date(), tz = tzNow()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(d);
}

// Snooze targets: Tomorrow / This Saturday / Next Monday, returned as ISO
// timestamps representing 00:00 local time on the target date (UTC ISO).
// "This Saturday" rolls to next Saturday if today is already Saturday.
// "Next Monday" is the Monday of the next week (skipping any Monday today).
export interface SnoozeTargets {
  tomorrow: { label: string; date: string; iso: string };
  saturday: { label: string; date: string; iso: string };
  nextMonday: { label: string; date: string; iso: string };
}

export function computeSnoozeTargets(now = new Date()): SnoozeTargets {
  const dayMs = 24 * 60 * 60 * 1000;

  const startOfDay = (d: Date) => {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    return c;
  };

  const tomorrow = new Date(startOfDay(now).getTime() + dayMs);

  // Saturday = day 6 (Sun=0..Sat=6). If today is Sat (6), pick next Sat.
  const day = now.getDay();
  const daysUntilSat = day >= 6 ? 7 : 6 - day;
  const saturday = new Date(startOfDay(now).getTime() + daysUntilSat * dayMs);

  // Monday = day 1. Always pick the Monday after this week (>= 7 days out).
  const daysUntilMon = day === 0 ? 8 : (8 - day);
  const nextMonday = new Date(startOfDay(now).getTime() + daysUntilMon * dayMs);

  const labelFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const pack = (d: Date, label: string) => ({
    label,
    date: labelFmt.format(d),
    iso: d.toISOString(),
  });

  return {
    tomorrow:   pack(tomorrow,   'Tomorrow'),
    saturday:   pack(saturday,   'This Saturday'),
    nextMonday: pack(nextMonday, 'Next Monday'),
  };
}

type MyTasksBuckets = {
  overdue: Task[];
  today: Task[];
  tomorrow: Task[];
  upcoming: Task[];
  later: Task[];
  focused: Task[];
  day_planner: Task[];
};

// ---------- queries ----------

export function useDayPlannerTasks() {
  const tz = tzNow();
  return useQuery<Task[]>({
    queryKey: ['day-planner', 'tasks', tz],
    queryFn: async () => {
      const params = new URLSearchParams({ tz });
      const res = await api.get(`/pm/tasks/my?${params.toString()}`);
      const buckets = (res.data?.data ?? {}) as Partial<MyTasksBuckets>;
      return buckets.day_planner ?? [];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useDayPlans(date: string) {
  return useQuery<TaskDayPlan[]>({
    queryKey: ['day-plans', date],
    queryFn: async () => {
      // tz lets the server derive timed/all-day occurrences from task dates.
      const params = new URLSearchParams({ date, tz: tzNow() });
      const res = await api.get(`/pm/day-plans?${params.toString()}`);
      return (res.data?.data ?? []) as TaskDayPlan[];
    },
    enabled: !!date,
    staleTime: 30_000,
  });
}

// ---------- mutations ----------

// Patch any cached list/board/folder/space/my-tasks queries that contain this task.
// Mirrors the snapshot/rollback pattern from web/src/hooks/useTasks.ts.
function patchTaskInCaches(
  qc: QueryClient,
  taskId: string,
  patch: Record<string, unknown>,
): Array<[readonly unknown[], unknown]> {
  const snapshots: Array<[readonly unknown[], unknown]> = [];

  const patchInArray = (arr: unknown): unknown => {
    if (!Array.isArray(arr)) return arr;
    let changed = false;
    const next = arr.map((t) => {
      if (t && typeof t === 'object' && (t as { id?: string }).id === taskId) {
        changed = true;
        return { ...(t as object), ...patch };
      }
      return t;
    });
    return changed ? next : arr;
  };

  // ['task', id] cache
  const taskKey = ['task', taskId];
  const prevTask = qc.getQueryData(taskKey);
  if (prevTask !== undefined) {
    snapshots.push([taskKey, prevTask]);
    qc.setQueryData(taskKey, (old: unknown) =>
      old && typeof old === 'object' ? { ...(old as object), ...patch } : old,
    );
  }

  // Array-shaped task queries
  for (const queryKey of [['tasks'], ['my-tasks'], ['day-planner']] as const) {
    for (const [key, data] of qc.getQueriesData({ queryKey: queryKey as readonly unknown[] })) {
      const next = patchInArray(data);
      if (next !== data) {
        snapshots.push([key, data]);
        qc.setQueryData(key, next);
      }
    }
  }

  // Bucket-shaped queries (my-tasks returns { overdue, today, ..., day_planner })
  for (const queryKey of [['my-tasks']] as const) {
    for (const [key, data] of qc.getQueriesData({ queryKey: queryKey as readonly unknown[] })) {
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        let changed = false;
        const out: Record<string, unknown> = {};
        for (const [bucket, val] of Object.entries(data as Record<string, unknown>)) {
          const nextVal = patchInArray(val);
          if (nextVal !== val) changed = true;
          out[bucket] = nextVal;
        }
        if (changed) {
          snapshots.push([key, data]);
          qc.setQueryData(key, out);
        }
      }
    }
  }

  // folder-tasks / space-tasks ({ tasks: Task[] } shape)
  for (const queryKey of [['folder-tasks'], ['space-tasks']] as const) {
    for (const [key, data] of qc.getQueriesData({ queryKey: queryKey as readonly unknown[] })) {
      if (data && typeof data === 'object' && 'tasks' in data) {
        const tasks = (data as { tasks?: unknown }).tasks;
        const nextTasks = patchInArray(tasks);
        if (nextTasks !== tasks) {
          snapshots.push([key, data]);
          qc.setQueryData(key, { ...(data as object), tasks: nextTasks });
        }
      }
    }
  }

  return snapshots;
}

function removeTaskFromDayPlannerCache(
  qc: QueryClient,
  taskId: string,
): Array<[readonly unknown[], unknown]> {
  const snapshots: Array<[readonly unknown[], unknown]> = [];
  for (const [key, data] of qc.getQueriesData({ queryKey: ['day-planner'] })) {
    if (!Array.isArray(data)) continue;
    const next = data.filter((t: any) => t?.id !== taskId);
    if (next.length !== data.length) {
      snapshots.push([key, data]);
      qc.setQueryData(key, next);
    }
  }
  return snapshots;
}

function rollback(qc: QueryClient, snapshots: Array<[readonly unknown[], unknown]>) {
  for (const [key, data] of snapshots) {
    qc.setQueryData(key, data);
  }
}

export function useFocusTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, focused }: { id: string; focused: boolean }) => {
      const res = await api.patch(`/pm/tasks/${id}/focus`, { focused });
      return res.data?.data as Task;
    },
    onMutate: async ({ id, focused }) => {
      await qc.cancelQueries({ queryKey: ['day-planner'] });
      const focused_at = focused ? new Date().toISOString() : null;
      const snapshots = patchTaskInCaches(qc, id, { focused_at });
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshots) rollback(qc, ctx.snapshots);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['day-planner'] });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}

export function useSnoozeTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, until }: { id: string; until: string | null }) => {
      const res = await api.patch(`/pm/tasks/${id}/snooze`, { until });
      return res.data?.data as Task;
    },
    onMutate: async ({ id, until }) => {
      await qc.cancelQueries({ queryKey: ['day-planner'] });
      const patchSnap = patchTaskInCaches(qc, id, { snoozed_until: until });
      // If snoozing into the future, immediately drop the task from the day planner list.
      const isSnoozing = !!until && new Date(until) > new Date();
      const removeSnap = isSnoozing ? removeTaskFromDayPlannerCache(qc, id) : [];
      return { snapshots: [...patchSnap, ...removeSnap] };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshots) rollback(qc, ctx.snapshots);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['day-planner'] });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}

// Scan the React Query cache for a task we already have hydrated so the
// optimistic plan can render with the real title + status immediately.
function findCachedTask(qc: QueryClient, taskId: string): Task | undefined {
  const direct = qc.getQueryData<Task>(['task', taskId]);
  if (direct) return direct;

  const matchInArray = (arr: unknown): Task | undefined => {
    if (!Array.isArray(arr)) return undefined;
    return arr.find((t: any) => t?.id === taskId) as Task | undefined;
  };

  // Array-shaped task queries: ['day-planner', ...], ['tasks', ...]
  for (const queryKey of [['day-planner'], ['tasks']] as const) {
    for (const [, data] of qc.getQueriesData({ queryKey: queryKey as readonly unknown[] })) {
      const found = matchInArray(data);
      if (found) return found;
    }
  }
  // Bucket-shaped my-tasks queries
  for (const [, data] of qc.getQueriesData({ queryKey: ['my-tasks'] })) {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const bucket of Object.values(data as Record<string, unknown>)) {
        const found = matchInArray(bucket);
        if (found) return found;
      }
    }
  }
  // folder-tasks / space-tasks ({ tasks: Task[] })
  for (const queryKey of [['folder-tasks'], ['space-tasks']] as const) {
    for (const [, data] of qc.getQueriesData({ queryKey: queryKey as readonly unknown[] })) {
      if (data && typeof data === 'object' && 'tasks' in data) {
        const found = matchInArray((data as { tasks?: unknown }).tasks);
        if (found) return found;
      }
    }
  }
  return undefined;
}

export function useScheduleTaskOnDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      task_id: string;
      plan_date: string;
      start_minute: number;
      duration_minutes: number;
    }) => {
      // Fire schedule + auto-focus together. The Day Planner is an opinionated
      // "today" view, so anything scheduled here is also treated as a focus
      // task — pinning it across the next day in the list.
      const [schedRes] = await Promise.all([
        api.post('/pm/day-plans', vars),
        api.patch(`/pm/tasks/${vars.task_id}/focus`, { focused: true }).catch(() => null),
      ]);
      return schedRes.data?.data as TaskDayPlan;
    },
    // Optimistic insert: drop the block onto the calendar immediately. The
    // TodayList filter also recomputes against this cache so the list row
    // vanishes in the same tick — no perceived round-trip delay.
    onMutate: async (vars) => {
      const queryKey = ['day-plans', vars.plan_date] as const;
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<TaskDayPlan[]>(queryKey);

      const task = findCachedTask(qc, vars.task_id);
      const tempId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimisticPlan: TaskDayPlan = {
        id: tempId,
        task_id: vars.task_id,
        user_id: '',
        plan_date: vars.plan_date,
        start_minute: vars.start_minute,
        duration_minutes: vars.duration_minutes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        task: task
          ? {
              id: task.id,
              title: task.title,
              priority: task.priority,
              status_id: task.status_id,
              time_estimate: task.time_estimate,
              list_id: task.list_id,
              status: (task as Task & { status?: string | null }).status ?? null,
              list: task.list ?? null,
            }
          : undefined,
      };

      qc.setQueryData<TaskDayPlan[]>(queryKey, (old) => [
        ...(old || []),
        optimisticPlan,
      ]);

      // Also optimistically set focused_at on the task in every cached list
      // so the star lights up immediately wherever the task appears.
      const focusSnapshots = patchTaskInCaches(qc, vars.task_id, {
        focused_at: new Date().toISOString(),
      });

      // The legacy task detail panel reads focus from pmStore's local list
      // (not from task.focused_at). Mirror the focus into pmStore so the
      // star indicator in the detail panel lights up too. resetFocusTodayIfStale
      // first wipes yesterday's IDs if the day rolled over.
      const pm = usePMStore.getState();
      pm.resetFocusTodayIfStale();
      if (!pm.isFocusedToday(vars.task_id)) {
        pm.toggleFocusToday(vars.task_id);
      }

      return { prev, queryKey, tempId, focusSnapshots };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      qc.setQueryData(ctx.queryKey, ctx.prev);
      if (ctx.focusSnapshots) rollback(qc, ctx.focusSnapshots);
    },
    onSuccess: (data, _vars, ctx) => {
      if (!ctx || !data) return;
      // Swap the temp row for the server-returned plan (real id + embed).
      qc.setQueryData<TaskDayPlan[]>(ctx.queryKey, (old) =>
        (old || []).map((p) => (p.id === ctx.tempId ? data : p)),
      );
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ['day-plans', vars.plan_date] });
      qc.invalidateQueries({ queryKey: ['day-planner'] });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
    },
  });
}

// Move or resize a calendar block. Identified by (task_id, plan_date) instead
// of plan id so it works on freshly-dropped optimistic blocks whose temp id
// hasn't yet been swapped for the server UUID. POST /pm/day-plans is already
// an upsert on the unique (task_id, user_id, plan_date) key, so we reuse it.
export function useUpdateDayPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      task_id: string;
      plan_date: string;
      start_minute: number;
      duration_minutes: number;
    }) => {
      const res = await api.post('/pm/day-plans', vars);
      return res.data?.data as TaskDayPlan;
    },
    onMutate: async ({ task_id, plan_date, start_minute, duration_minutes }) => {
      await qc.cancelQueries({ queryKey: ['day-plans', plan_date] });
      const prev = qc.getQueryData<TaskDayPlan[]>(['day-plans', plan_date]);
      qc.setQueryData<TaskDayPlan[]>(['day-plans', plan_date], (old) =>
        (old || []).map((p) =>
          p.task_id === task_id ? { ...p, start_minute, duration_minutes } : p,
        ),
      );
      return { prev, plan_date };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) qc.setQueryData(['day-plans', ctx.plan_date], ctx.prev);
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ['day-plans', vars.plan_date] });
    },
  });
}

export function useUnscheduleTask() {
  const qc = useQueryClient();
  return useMutation({
    // Delete by (task_id, plan_date) instead of plan id so the × button works
    // even on freshly-dropped optimistic blocks whose temp id ("optimistic-…")
    // hasn't yet been swapped for the server's real UUID.
    mutationFn: async ({ task_id, plan_date }: { task_id: string; plan_date: string }) => {
      const params = new URLSearchParams({ task_id, plan_date });
      await api.delete(`/pm/day-plans?${params.toString()}`);
    },
    onMutate: async ({ task_id, plan_date }) => {
      await qc.cancelQueries({ queryKey: ['day-plans', plan_date] });
      const prev = qc.getQueryData<TaskDayPlan[]>(['day-plans', plan_date]);
      qc.setQueryData<TaskDayPlan[]>(['day-plans', plan_date], (old) =>
        (old || []).filter((p) => p.task_id !== task_id),
      );
      return { prev, plan_date };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) qc.setQueryData(['day-plans', ctx.plan_date], ctx.prev);
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ['day-plans', vars.plan_date] });
    },
  });
}
