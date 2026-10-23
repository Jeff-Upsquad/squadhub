import { supabaseAdmin } from '../supabase';
import type { DesignShareDailyPoint } from '@squadhub/shared';

// IST is the canonical timezone for this system's daily reporting (matches the
// time-summary bucketing in routes/pm/folders.ts).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
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

