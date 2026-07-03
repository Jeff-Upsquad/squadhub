import { supabaseAdmin } from '../supabase';
import { getTaskStatusDef, type SpaceStatus } from '@squadhub/shared';
import { todayIST, isNonWorkingDay } from '../utils/ist';
import { getFolderPlanTimeline, segmentDailyForDate } from '../utils/folderCommittedHours';

// ============================================================
// Elapsed time core (idle-day plan consumption).
// ============================================================
// When a design/video space has NO active tasks on a working day, the cron
// "elapses" that day's plan hours in two independent stages (12:01 pm half,
// 3:00 pm remaining). This module holds the reusable logic — enumerating the
// billable spaces, deciding whether a space is idle, and writing the rows —
// so the cron (server/src/cron/elapsed-time-cron.ts) is a thin scheduler and
// the same logic can be invoked directly from a test/REPL.

// Stage names that count as DONE for elapsing. Per product spec the active range
// is "New Request → Changes"; only "For Review" and "Closed" are done. NOTE we
// split by stage NAME (not category): the design pipeline seeds "Changes" as
// category 'done' even though it is still active work, so a category check would
// wrongly treat it as done.
const DONE_STAGE_NAMES = new Set(['For Review', 'Closed']);

const DESIGN_TEMPLATE_SLUGS = ['design-space', 'video-editing-space'];

/**
 * Server-side mirror of `resolveStage` in web/src/lib/designSpaceLists.ts:
 * map a task's raw `status` string to the space stage it sits in.
 *   1. exact stage name ("Work in Progress")
 *   2. a bare StatusCategory string ('todo'|'active'|'done'|'closed')
 *   3. a TASK_STATUS_CATALOG key (e.g. 'in_progress') → its category → first
 *      stage of that category
 *   4. fallback to the default stage (or the first one)
 */
export function resolveStage(
  taskStatus: string | null | undefined,
  statuses: SpaceStatus[],
): SpaceStatus | null {
  if (!statuses.length) return null;
  if (taskStatus) {
    const byName = statuses.find((s) => s.name === taskStatus);
    if (byName) return byName;
    const byCategory = statuses.find((s) => s.category === taskStatus);
    if (byCategory) return byCategory;
    const catalogCat = getTaskStatusDef(taskStatus)?.category;
    if (catalogCat) {
      const byCatalog = statuses.find((s) => s.category === catalogCat);
      if (byCatalog) return byCatalog;
    }
  }
  return statuses.find((s) => s.is_default) || statuses[0] || null;
}

/** True when a task's status resolves to a "done" stage (For Review / Closed). */
function isTaskDone(status: string | null | undefined, statuses: SpaceStatus[]): boolean {
  const stage = resolveStage(status, statuses);
  if (stage) return stage.category === 'closed' || DONE_STAGE_NAMES.has(stage.name);
  // No stages resolved (space not set up): fall back to the catalog completes.
  return status === 'done' || status === 'closed';
}

export interface ElapsibleSpace {
  folderId: string;
  spaceId: string;
  workspaceId: string | null;
  dailyHours: number;
}

/**
 * Every design/video space currently linked to a subscription card, with the
 * daily hours in effect TODAY. Term-aware: the allotment comes from the
 * assignment term covering today (via the folder plan timeline), so a paused
 * or cancelled subscription — or the sourcing gap while a replacement talent
 * is found — elapses nothing, and a mid-engagement plan change elapses the
 * new plan's hours from its effective date. Spaces with no linked card, a
 * closed/paused card, a non-design template, or a zero allotment are skipped.
 */
export async function listElapsibleSpaces(): Promise<ElapsibleSpace[]> {
  const { data: cards } = await supabaseAdmin
    .from('subscription_cards')
    .select('id, linked_folder_id, state, paused_at')
    .not('linked_folder_id', 'is', null);
  if (!cards || cards.length === 0) return [];

  // Daily hours in effect today, per folder (first positive allotment wins).
  // Fast-skip closed/paused cards before the per-folder timeline queries.
  const today = todayIST();
  const dailyByFolder = new Map<string, number>();
  for (const c of cards as any[]) {
    const fid = c.linked_folder_id as string;
    if (dailyByFolder.has(fid)) continue;
    if (c.state === 'closed' || c.paused_at) continue;
    const timeline = await getFolderPlanTimeline(fid);
    const daily = segmentDailyForDate(timeline, today);
    if (daily != null && daily > 0) dailyByFolder.set(fid, daily);
  }
  if (dailyByFolder.size === 0) return [];

  const { data: folders } = await supabaseAdmin
    .from('folders')
    .select(
      'id, space_id, client_space_template:client_space_template_id(slug), space:space_id(workspace_id)',
    )
    .in('id', Array.from(dailyByFolder.keys()))
    .not('client_space_template_id', 'is', null)
    .is('deleted_at', null);

  const out: ElapsibleSpace[] = [];
  for (const f of (folders || []) as any[]) {
    const slug = f.client_space_template?.slug as string | undefined;
    if (!slug || !DESIGN_TEMPLATE_SLUGS.includes(slug)) continue;
    if (!f.space_id) continue;
    out.push({
      folderId: f.id,
      spaceId: f.space_id,
      workspaceId: f.space?.workspace_id ?? null,
      dailyHours: dailyByFolder.get(f.id)!,
    });
  }
  return out;
}

/**
 * Whether a design/video space folder has any ACTIVE task right now (a task
 * whose stage is New Request … Changes — anything that isn't For Review/Closed).
 * Tasks with no active stage, plus a space with zero tasks, count as idle.
 */
export async function folderHasActiveTasks(folderId: string, spaceId: string): Promise<boolean> {
  const { data: statuses } = await supabaseAdmin
    .from('space_statuses')
    .select('id, space_id, name, color, position, is_default, category')
    .eq('space_id', spaceId);
  const spaceStatuses = (statuses || []) as SpaceStatus[];

  const { data: lists } = await supabaseAdmin
    .from('lists')
    .select('id')
    .eq('folder_id', folderId)
    .is('deleted_at', null);
  const listIds = (lists || []).map((l: any) => l.id);
  if (listIds.length === 0) return false;

  // tasks are hard-deleted (no deleted_at). Top-level, non-recurring only —
  // subtasks/recurrence templates aren't "requests" on the board.
  const { data: tasks } = await supabaseAdmin
    .from('tasks')
    .select('status')
    .in('list_id', listIds)
    .is('parent_task_id', null)
    .is('recurrence', null);

  for (const t of (tasks || []) as any[]) {
    if (!isTaskDone(t.status, spaceStatuses)) return true;
  }
  return false;
}

export interface ElapsedCheckpointResult {
  date: string;
  stage: 'midday' | 'afternoon';
  inserted: number;
  skippedActive: number;
  skippedExisting: number;
  nonWorkingDay: boolean;
}

/**
 * Run one checkpoint of the elapse logic. Exported so the cron and a manual
 * test can both invoke it.
 *   - stage 'midday'    → elapse round(dailyHours/2) hours
 *   - stage 'afternoon' → elapse the remaining half (dailyHours*3600 - midday)
 * Idempotent per (folder, date, stage): a unique index + ON CONFLICT DO NOTHING
 * means a re-run never double-counts, and an active task appearing later in the
 * day does not reverse an already-written row.
 *
 * `dateOverride` (YYYY-MM-DD, IST) is for tests; production uses today IST.
 */
export async function runElapsedCheckpoint(
  stage: 'midday' | 'afternoon',
  dateOverride?: string,
): Promise<ElapsedCheckpointResult> {
  const date = dateOverride || todayIST();
  const result: ElapsedCheckpointResult = {
    date,
    stage,
    inserted: 0,
    skippedActive: 0,
    skippedExisting: 0,
    nonWorkingDay: false,
  };

  // Respect the org's working-days config + holiday calendar (same source the
  // check-in / timesheet crons use). Nothing elapses on a non-working day.
  if (await isNonWorkingDay(date)) {
    result.nonWorkingDay = true;
    return result;
  }

  const spaces = await listElapsibleSpaces();
  if (spaces.length === 0) return result;

  // For the afternoon stage, the remaining half must net to the full day even
  // for odd splits, so read what midday already elapsed for each folder.
  const middayByFolder = new Map<string, number>();
  if (stage === 'afternoon') {
    const { data: midRows } = await supabaseAdmin
      .from('elapsed_time_entries')
      .select('folder_id, seconds')
      .eq('date', date)
      .eq('stage', 'midday')
      .in('folder_id', spaces.map((s) => s.folderId));
    for (const r of (midRows || []) as any[]) {
      middayByFolder.set(r.folder_id, Number(r.seconds || 0));
    }
  }

  for (const sp of spaces) {
    if (await folderHasActiveTasks(sp.folderId, sp.spaceId)) {
      result.skippedActive += 1;
      continue;
    }

    const fullSeconds = Math.round(sp.dailyHours * 3600);
    const halfSeconds = Math.round(fullSeconds / 2);
    const seconds =
      stage === 'midday'
        ? halfSeconds
        : Math.max(0, fullSeconds - (middayByFolder.get(sp.folderId) ?? halfSeconds));

    const { data: inserted, error } = await supabaseAdmin
      .from('elapsed_time_entries')
      .upsert(
        {
          folder_id: sp.folderId,
          workspace_id: sp.workspaceId,
          date,
          stage,
          seconds,
          source: 'auto',
          created_by: null,
        },
        { onConflict: 'folder_id,date,stage', ignoreDuplicates: true },
      )
      .select('id');

    if (error) {
      console.error(`[Elapsed Cron] upsert failed (folder ${sp.folderId})`, error.message);
      continue;
    }
    if (inserted && inserted.length > 0) result.inserted += 1;
    else result.skippedExisting += 1;
  }

  return result;
}
