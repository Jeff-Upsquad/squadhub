import { supabaseAdmin } from '../supabase';
import type {
  DesignShareDailyPoint,
  DesignSharePlan,
  DesignShareStatusLane,
  DesignShareTask,
} from '@squadhub/shared';

// IST is the canonical timezone for this system's daily reporting (matches the
// time-summary bucketing in routes/pm/folders.ts).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Today's date (YYYY-MM-DD) in IST. */
export function istTodayISO(): string {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${pad2(ist.getUTCMonth() + 1)}-${pad2(ist.getUTCDate())}`;
}

/** First day (YYYY-MM-DD, IST) of the month `monthsBack` months before now. */
export function istMonthStartISO(monthsBack: number): string {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - monthsBack, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Maps a design-space list name to the status lane it backs, or null.
 * Server-side mirror of web/src/lib/designSpaceLists.ts `listNameToStatus`.
 */
export function listNameToLane(name: string): DesignShareStatusLane | null {
  const n = (name || '').trim().toLowerCase();
  if (n === 'briefs' || n === 'queued' || n === 'queue') return 'queued';
  if (n === 'in progress' || n === 'in-progress' || n === 'progress') return 'progress';
  if (n === 'reviews' || n === 'review' || n === 'in review') return 'review';
  if (n === 'completed' || n === 'done') return 'done';
  return null;
}

/**
 * Derives a task's status lane the same way useFolderTasks does on the client:
 * an explicit 'done' wins, otherwise the backing list's lane, otherwise the
 * raw task.status, else 'queued'.
 */
export function deriveTaskLane(taskStatus: string | null | undefined, listName: string): DesignShareStatusLane {
  const mapped = listNameToLane(listName);
  if (taskStatus === 'done') return 'done';
  if (mapped) return mapped;
  if (taskStatus === 'in_progress') return 'progress';
  if (taskStatus === 'review') return 'review';
  return 'queued';
}

/**
 * Aggregates task_time_entries across all tasks in a folder's lists into one
 * row per IST day that has logged time. Extracted from the GET
 * /pm/folders/:id/time-summary handler so the public share view reuses the
 * exact same bucketing.
 */
export async function aggregateFolderTimeSummary(
  folderId: string,
  from: string,
  to: string,
): Promise<DesignShareDailyPoint[]> {
  const { data: lists } = await supabaseAdmin
    .from('lists')
    .select('id')
    .eq('folder_id', folderId)
    .is('deleted_at', null);
  const listIds = (lists || []).map((l: any) => l.id);
  if (listIds.length === 0) return [];

  // NOTE: `tasks` has no `deleted_at` column (tasks are hard-deleted). Don't
  // filter on it — PostgREST errors and silently returns no rows.
  const { data: tasks } = await supabaseAdmin
    .from('tasks')
    .select('id')
    .in('list_id', listIds);
  const taskIds = (tasks || []).map((t: any) => t.id);
  if (taskIds.length === 0) return [];

  const fromStartUtc = new Date(`${from}T00:00:00+05:30`).toISOString();
  const toEndUtc = new Date(`${to}T23:59:59.999+05:30`).toISOString();

  const { data: entries, error } = await supabaseAdmin
    .from('task_time_entries')
    .select('started_at, duration_seconds')
    .in('task_id', taskIds)
    .gte('started_at', fromStartUtc)
    .lte('started_at', toEndUtc)
    .not('duration_seconds', 'is', null);
  if (error) throw new Error(error.message);

  const buckets: Record<string, number> = {};
  for (const e of entries || []) {
    const ist = new Date(new Date((e as any).started_at).getTime() + IST_OFFSET_MS);
    const key = `${ist.getUTCFullYear()}-${pad2(ist.getUTCMonth() + 1)}-${pad2(ist.getUTCDate())}`;
    buckets[key] = (buckets[key] || 0) + Number((e as any).duration_seconds || 0);
  }

  return Object.entries(buckets)
    .map(([date, total_work_seconds]) => ({ date, total_work_seconds }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Reads the hours plan (daily/weekly/monthly) from the subscription card linked
 * to this folder. Mirrors GET /pm/folders/:id/link-status but exposes only the
 * derived allotments — never card_code or billing dates.
 */
export async function getFolderPlanHours(folderId: string): Promise<DesignSharePlan> {
  const { data: card } = await supabaseAdmin
    .from('subscription_cards')
    .select('plan_snapshot')
    .eq('linked_folder_id', folderId)
    .maybeSingle();
  const snapshot = card?.plan_snapshot as
    | { plan?: { daily_hours?: number | null; weekly_hours?: number | null } }
    | null;
  const daily = snapshot?.plan?.daily_hours != null ? Number(snapshot.plan.daily_hours) : null;
  const weekly = snapshot?.plan?.weekly_hours != null ? Number(snapshot.plan.weekly_hours) : null;
  const monthly = daily != null ? daily * 20 : null;
  return { daily_hours: daily, weekly_hours: weekly, monthly_hours: monthly };
}

export interface DesignShareSnapshot {
  space: { name: string; template_slug: string | null; is_video: boolean };
  tasks: DesignShareTask[];
  plan: DesignSharePlan;
  time_summary: DesignShareDailyPoint[];
}

/**
 * Builds the full read-only payload for a design-space public share view:
 * space meta, the derived-lane task list (with assignee names/avatars), the
 * hours plan, and ~6 months of daily time totals.
 */
export async function buildDesignShareSnapshot(folderId: string): Promise<DesignShareSnapshot | null> {
  const { data: folder } = await supabaseAdmin
    .from('folders')
    .select('id, name, lists(id, name, deleted_at), client_space_template:client_space_template_id(slug)')
    .eq('id', folderId)
    .is('deleted_at', null)
    .single();
  if (!folder) return null;

  const templateSlug = ((folder as any).client_space_template?.slug as string | undefined) ?? null;
  const isVideo = templateSlug === 'video-editing-space';

  const lists = ((folder as any).lists || []).filter((l: any) => !l.deleted_at) as {
    id: string;
    name: string;
  }[];
  const listNameById = new Map(lists.map((l) => [l.id, l.name]));
  const listIds = lists.map((l) => l.id);

  let shareTasks: DesignShareTask[] = [];
  if (listIds.length > 0) {
    const { data: rawTasks } = await supabaseAdmin
      .from('tasks')
      .select(
        'id, title, status, priority, due_date, time_tracked, metadata, assignee_ids, display_number, created_at, list_id',
      )
      .in('list_id', listIds)
      .is('parent_task_id', null)
      .is('recurrence', null);

    const tasks = (rawTasks || []) as any[];
    const allAssigneeIds = Array.from(new Set(tasks.flatMap((t) => t.assignee_ids || [])));
    const usersById = new Map<string, { display_name: string | null; avatar_url: string | null }>();
    if (allAssigneeIds.length > 0) {
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, display_name, avatar_url')
        .in('id', allAssigneeIds);
      for (const u of users || []) {
        usersById.set((u as any).id, {
          display_name: (u as any).display_name ?? null,
          avatar_url: (u as any).avatar_url ?? null,
        });
      }
    }

    shareTasks = tasks.map((t) => {
      const listName = listNameById.get(t.list_id) || '';
      return {
        id: t.id,
        title: t.title,
        status: deriveTaskLane(t.status, listName),
        time_tracked: t.time_tracked || 0,
        priority: t.priority,
        due_date: t.due_date ?? null,
        category: (t.metadata as any)?.category ?? null,
        list_name: listName || null,
        display_number: t.display_number ?? null,
        created_at: t.created_at,
        assignees: (t.assignee_ids || [])
          .map((id: string) => usersById.get(id))
          .filter(Boolean) as { display_name: string | null; avatar_url: string | null }[],
      };
    });
  }

  const plan = await getFolderPlanHours(folderId);
  const time_summary = await aggregateFolderTimeSummary(folderId, istMonthStartISO(5), istTodayISO());

  return {
    space: { name: (folder as any).name, template_slug: templateSlug, is_video: isVideo },
    tasks: shareTasks,
    plan,
    time_summary,
  };
}
