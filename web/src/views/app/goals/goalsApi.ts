import { useMemo } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  effectiveGoalStatus,
  wouldCreateGoalCycle,
  type Goal,
  type GoalDependency,
  type GoalInput,
  type GoalProject,
  type GoalsData,
  type GoalTask,
} from '@squadhub/shared';
import api from '../../../services/api';
import { showToast } from '../../../components/Toast';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { errorMessage, shiftDay, taskRange, todayKey } from './goalUtils';
import { queueGoalTaskWrite } from './goalMutationQueue';

const EMPTY: GoalsData = { projects: [], goals: [] };
export const goalsKey = (workspaceId: string | undefined) => ['goals', workspaceId] as const;

/**
 * Every goal the viewer can see, with tasks and progress. One query backs the
 * Goals page, the open goal, Home's card and the flag next to each task, so
 * they never disagree. `live` adds a slow poll while a goal surface is open.
 */
export function useGoalsQuery(opts: { live?: boolean; enabled?: boolean } = {}) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  return useQuery<GoalsData>({
    queryKey: goalsKey(workspaceId),
    queryFn: async () => (await api.get('/pm/goals', { params: { workspace_id: workspaceId } })).data.data,
    enabled: !!workspaceId && opts.enabled !== false,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
    refetchInterval: opts.live ? 45_000 : false,
  });
}

export function useGoalsData(opts: { live?: boolean } = {}) {
  const q = useGoalsQuery(opts);
  return { ...q, data: q.data || EMPTY };
}

export function useGoal(goalId: string | null, opts: { live?: boolean } = {}) {
  const { data, ...rest } = useGoalsData(opts);
  const goal = goalId ? data.goals.find((g) => g.id === goalId) || null : null;
  const project = goal ? data.projects.find((p) => p.id === goal.project_id) || null : null;
  return { goal, project, data, ...rest };
}

// task id → goals it belongs to. Built once per goals payload and shared by
// every row's flag, so long task lists don't each scan all goals.
const indexCache = new WeakMap<GoalsData, Map<string, Goal[]>>();
export function goalIndex(data: GoalsData): Map<string, Goal[]> {
  let index = indexCache.get(data);
  if (!index) {
    index = new Map();
    for (const g of data.goals) for (const t of g.tasks) index.set(t.id, [...(index.get(t.id) || []), g]);
    indexCache.set(data, index);
  }
  return index;
}

export function useTaskGoals(taskId: string | null | undefined): Goal[] {
  const { data } = useGoalsQuery();
  return useMemo(() => (data && taskId ? goalIndex(data).get(taskId) || [] : []), [data, taskId]);
}

// ── Optimistic cache helpers ───────────────────────────────────────────────

function withCounts(g: Goal, total: number, done: number): Goal {
  const task_count = Math.max(0, total);
  const completed_count = Math.min(task_count, Math.max(0, done));
  return {
    ...g,
    task_count,
    completed_count,
    progress: task_count ? Math.round((completed_count / task_count) * 100) : 0,
    status: effectiveGoalStatus(g.stored_status, task_count, completed_count),
  };
}

type Patch = (data: GoalsData) => GoalsData;

function mapGoal(goalId: string, fn: (g: Goal) => Goal): Patch {
  return (d) => ({ ...d, goals: d.goals.map((g) => (g.id === goalId ? fn(g) : g)) });
}

/** Patch a task everywhere it appears (a task can serve several goals). */
function mapTask(taskId: string, fn: (t: GoalTask, g: Goal) => GoalTask): Patch {
  return (d) => ({
    ...d,
    goals: d.goals.map((g) => (g.tasks.some((t) => t.id === taskId)
      ? { ...g, tasks: g.tasks.map((t) => (t.id === taskId ? fn(t, g) : t)) }
      : g)),
  });
}

const batches = new WeakMap<QueryClient, { pending: number; tasks: boolean; timer: ReturnType<typeof setTimeout> | null }>();
function mutationBatch(qc: QueryClient) {
  let batch = batches.get(qc);
  if (!batch) { batch = { pending: 0, tasks: false, timer: null }; batches.set(qc, batch); }
  return batch;
}
/** Coalesce follow-up refetches: rapid drags settle into one round-trip. */
function refreshSoon(qc: QueryClient, opts: { tasks?: boolean } = {}) {
  const batch = mutationBatch(qc);
  batch.tasks ||= !!opts.tasks;
  if (batch.timer) clearTimeout(batch.timer);
  batch.timer = setTimeout(() => {
    batch.timer = null;
    if (batch.pending) return;
    if (batch.tasks) {
      batch.tasks = false;
      for (const key of ['tasks', 'task', 'folder-tasks', 'space-tasks', 'my-tasks', 'my-tasks-summary', 'day-planner', 'day-plans']) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    }
    void qc.invalidateQueries({ queryKey: ['goals'] });
  }, 700);
}

export type ScheduleDates = Partial<Pick<GoalTask, 'work_date' | 'work_end_date' | 'start_date' | 'due_date'>>;

export function useGoalActions() {
  const qc = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const key = goalsKey(workspaceId);

  /** Apply a cache patch now, run the request, roll back + toast on failure. */
  async function optimistic<T>(patch: Patch | null, request: () => Promise<T>, opts: { tasks?: boolean; quiet?: boolean } = {}): Promise<T> {
    const batch = mutationBatch(qc);
    batch.pending++;
    const before = qc.getQueryData<GoalsData>(key);
    if (patch && before) {
      void qc.cancelQueries({ queryKey: key });
      qc.setQueryData<GoalsData>(key, patch(before));
    }
    const applied = qc.getQueryData<GoalsData>(key);
    try {
      return await request();
    } catch (e) {
      // A failed earlier write must not erase a later optimistic edit.
      if (patch && before && qc.getQueryData(key) === applied) qc.setQueryData(key, before);
      if (!opts.quiet) showToast(errorMessage(e, 'Couldn’t save that change'), 'error');
      throw e;
    } finally {
      batch.pending--;
      refreshSoon(qc, opts);
    }
  }

  const replaceGoal = (goal: Goal | null | undefined) => {
    if (!goal) return;
    qc.setQueryData<GoalsData>(key, (d) => {
      const data = d || EMPTY;
      const exists = data.goals.some((g) => g.id === goal.id);
      if (exists && mutationBatch(qc).pending > 1) return data;
      return { ...data, goals: exists ? data.goals.map((g) => (g.id === goal.id ? goal : g)) : [goal, ...data.goals] };
    });
  };

  return {
    async createProject(name: string, color: string): Promise<GoalProject> {
      const project: GoalProject = (await api.post('/pm/goal-projects', { workspace_id: workspaceId, name, color })).data.data;
      qc.setQueryData<GoalsData>(key, (d) => ({ ...(d || EMPTY), projects: [...(d || EMPTY).projects, project] }));
      return project;
    },

    updateProject(id: string, patch: Partial<Pick<GoalProject, 'name' | 'color'>>) {
      return optimistic(
        (d) => ({ ...d, projects: d.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }),
        () => api.patch(`/pm/goal-projects/${id}`, patch),
      );
    },

    deleteProject(id: string) {
      return optimistic(
        (d) => ({ projects: d.projects.filter((p) => p.id !== id), goals: d.goals.filter((g) => g.project_id !== id) }),
        () => api.delete(`/pm/goal-projects/${id}`),
      );
    },

    async createGoal(input: GoalInput & { task_ids?: string[] }): Promise<Goal> {
      const goal: Goal = (await api.post('/pm/goals', input)).data.data;
      replaceGoal(goal);
      if (input.task_ids?.length) refreshSoon(qc);
      return goal;
    },

    updateGoal(id: string, patch: Partial<GoalInput>) {
      return optimistic(
        mapGoal(id, (g) => {
          const next = { ...g, ...patch } as Goal;
          if (patch.status) {
            next.stored_status = patch.status;
            next.status = effectiveGoalStatus(patch.status, g.task_count, g.completed_count);
          }
          return next;
        }),
        async () => replaceGoal((await queueGoalTaskWrite(qc, `goal:${id}`, () => api.patch(`/pm/goals/${id}`, patch))).data.data),
      );
    },

    deleteGoal(id: string) {
      return optimistic(
        (d) => ({ ...d, goals: d.goals.filter((g) => g.id !== id) }),
        () => api.delete(`/pm/goals/${id}`),
      );
    },

    /** Link tasks; they appear in the tray (or timeline, if dated) right away. */
    async linkTasks(goalId: string, tasks: GoalTask[]) {
      const ids = tasks.map((t) => t.id);
      const result = await optimistic(
        mapGoal(goalId, (g) => {
          const fresh = tasks.filter((t) => !g.tasks.some((x) => x.id === t.id));
          const merged = g.tasks.map((t) => (ids.includes(t.id) ? { ...t, direct: true } : t));
          return withCounts({ ...g, tasks: [...merged, ...fresh] },
            g.task_count + fresh.length,
            g.completed_count + fresh.filter((t) => t.completed).length);
        }),
        async () => (await api.post(`/pm/goals/${goalId}/tasks`, { task_ids: ids })).data.data as { linked: string[]; skipped: { id: string; reason: string }[] },
      );
      if (result.skipped.length) showToast(result.skipped[0].reason, 'error');
      return result;
    },

    unlinkTask(goalId: string, task: GoalTask) {
      const stays = task.source_ids.length > 0;
      return optimistic(
        mapGoal(goalId, (g) => (stays
          ? { ...g, tasks: g.tasks.map((t) => (t.id === task.id ? { ...t, direct: false } : t)) }
          : withCounts({
            ...g,
            tasks: g.tasks.filter((t) => t.id !== task.id),
            dependencies: g.dependencies.filter((e) => e.from_task_id !== task.id && e.to_task_id !== task.id),
          }, g.task_count - 1, g.completed_count - (task.completed ? 1 : 0)))),
        () => api.delete(`/pm/goals/${goalId}/tasks/${task.id}`),
      );
    },

    /** Place on/off the timeline and/or move dates (dates update the task everywhere). */
    schedule(goalId: string, taskId: string, patch: ScheduleDates & { scheduled?: boolean }) {
      const { scheduled, ...dates } = patch;
      const hasDates = Object.keys(dates).length > 0;
      return optimistic(
        (d) => {
          const moved = hasDates ? mapTask(taskId, (t) => ({ ...t, ...dates }))(d) : d;
          return mapGoal(goalId, (g) => ({
            ...g,
            tasks: g.tasks.map((t) => (t.id === taskId ? { ...t, scheduled: scheduled ?? (hasDates ? true : t.scheduled) } : t)),
          }))(moved);
        },
        () => queueGoalTaskWrite(qc, taskId, () => api.patch(`/pm/goals/${goalId}/tasks/${taskId}/schedule`, patch)),
        { tasks: hasDates },
      );
    },

    /** Put a task on the timeline: its own dates if it has any, else a 3-day block from today. */
    place(goalId: string, task: GoalTask) {
      const dated = !!(taskRange(task, 'work') || taskRange(task, 'plan'));
      if (dated || !task.can_edit) return this.schedule(goalId, task.id, { scheduled: true });
      const start = todayKey();
      return this.schedule(goalId, task.id, { scheduled: true, work_date: start, work_end_date: shiftDay(start, 2) });
    },

    addDependency(goal: Goal, dep: Omit<GoalDependency, 'id' | 'goal_id'>) {
      if (goal.dependencies.some((e) => e.from_task_id === dep.from_task_id && e.to_task_id === dep.to_task_id)) {
        showToast('These tasks are already connected', 'info');
        return Promise.resolve(null);
      }
      if (wouldCreateGoalCycle(goal.dependencies, dep.from_task_id, dep.to_task_id)) {
        showToast('That would create a loop — tasks can’t depend on each other in a circle', 'error');
        return Promise.resolve(null);
      }
      const temp: GoalDependency = { ...dep, id: `temp-${Date.now()}`, goal_id: goal.id };
      return optimistic(
        mapGoal(goal.id, (g) => ({ ...g, dependencies: [...g.dependencies, temp] })),
        async () => {
          const saved: GoalDependency = (await api.post(`/pm/goals/${goal.id}/dependencies`, dep)).data.data;
          qc.setQueryData<GoalsData>(key, (d) => d && mapGoal(goal.id, (g) => ({
            ...g, dependencies: g.dependencies.map((e) => (e.id === temp.id ? saved : e)),
          }))(d));
          return saved;
        },
      );
    },

    removeDependency(goalId: string, depId: string) {
      return optimistic(
        mapGoal(goalId, (g) => ({ ...g, dependencies: g.dependencies.filter((e) => e.id !== depId) })),
        () => api.delete(`/pm/goals/${goalId}/dependencies/${depId}`),
      );
    },

    async addSource(goalId: string, source: { resource_type: 'folder' | 'list'; resource_id: string }) {
      await optimistic(null, () => api.post(`/pm/goals/${goalId}/sources`, source));
      await qc.invalidateQueries({ queryKey: ['goals'] });
    },

    removeSource(goalId: string, sourceId: string) {
      return optimistic(
        mapGoal(goalId, (g) => ({ ...g, sources: g.sources.filter((s) => s.id !== sourceId) })),
        () => api.delete(`/pm/goals/${goalId}/sources/${sourceId}`),
      );
    },

    /**
     * Complete / reopen a task from inside a goal. Goes through the normal task
     * endpoint, so the completion gate (open subtasks / checklist) still applies.
     */
    setTaskCompleted(task: GoalTask, done: boolean) {
      return optimistic(
        (d) => ({
          ...d,
          goals: d.goals.map((g) => {
            const t = g.tasks.find((x) => x.id === task.id);
            if (!t || t.completed === done) return g;
            return withCounts(
              { ...g, tasks: g.tasks.map((x) => (x.id === task.id ? { ...x, completed: done, status: done ? 'done' : 'todo' } : x)) },
              g.task_count,
              g.completed_count + (done ? 1 : -1),
            );
          }),
        }),
        () => queueGoalTaskWrite(qc, task.id, () => api.put(`/pm/tasks/${task.id}`, { status: done ? 'done' : 'todo' })),
        { tasks: true },
      );
    },
  };
}

export type GoalActions = ReturnType<typeof useGoalActions>;
