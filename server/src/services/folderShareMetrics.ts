import { supabaseAdmin } from '../supabase';
import type {
  DesignShareDailyPoint,
  DesignSharePlan,
  DesignShareSpace,
  DesignShareStatusLane,
  DesignShareTask,
  TaskTypeField,
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

export interface DesignTaskTypeInfo {
  id: string;
  key: string;
  fields: TaskTypeField[];
}

/**
 * The design/video task type (id, key) and its brief field definitions for a
 * space. Used by the public view to render the new-request form and by the
 * public submit to validate field values + derive the category.
 */
export async function getDesignTaskType(isVideo: boolean): Promise<DesignTaskTypeInfo | null> {
  const key = isVideo ? 'video_edit_task' : 'design_task';
  const { data: type } = await supabaseAdmin
    .from('task_types')
    .select('id, key')
    .eq('key', key)
    .maybeSingle();
  if (!type) return null;
  const { data: fields } = await supabaseAdmin
    .from('task_type_fields')
    .select('*')
    .eq('task_type_id', (type as any).id)
    .order('position', { ascending: true });
  return { id: (type as any).id, key: (type as any).key, fields: (fields || []) as TaskTypeField[] };
}

/**
 * Sanitizes client-submitted custom design-field values against the task type's
 * field definitions (this is a PUBLIC endpoint, so untrusted input must be
 * whitelisted — no arbitrary metadata injection), and derives the `category`
 * label the same way the internal New Design Task form does (first selected
 * `brief_type` option). Output shape matches task.metadata.custom exactly so the
 * internal task detail panel renders client briefs identically.
 */
export function sanitizeDesignCustom(
  fields: TaskTypeField[],
  raw: unknown,
): { custom: Record<string, unknown>; category?: string } {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { custom: out };
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const str = (v: unknown, max: number) => String(v).slice(0, max);

  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k.endsWith('_other')) {
      const base = byKey.get(k.slice(0, -6));
      if (base?.allow_other && typeof v === 'string' && v.trim()) out[k] = str(v.trim(), 200);
      continue;
    }
    const f = byKey.get(k);
    if (!f) continue;
    const optionValues = new Set(f.options.map((o) => o.value));
    switch (f.field_type) {
      case 'multi_select': {
        if (!Array.isArray(v)) break;
        const arr = v
          .filter((x): x is string => typeof x === 'string')
          .filter((x) => optionValues.has(x) || (f.allow_other && x === '__other__'))
          .slice(0, 50);
        if (arr.length) out[k] = arr;
        break;
      }
      case 'select': {
        if (typeof v === 'string' && (optionValues.has(v) || (f.allow_other && v === '__other__'))) out[k] = v;
        break;
      }
      case 'number': {
        const n = typeof v === 'number' ? v : Number(v);
        if (Number.isFinite(n)) out[k] = n;
        break;
      }
      case 'checkbox': {
        if (typeof v === 'boolean') out[k] = v;
        break;
      }
      case 'date': {
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) out[k] = str(v, 40);
        break;
      }
      case 'textarea': {
        if (typeof v === 'string' && v.trim()) out[k] = str(v, 4000);
        break;
      }
      default: {
        // text | url
        if (typeof v === 'string' && v.trim()) out[k] = str(v, 1000);
      }
    }
  }

  // Category = label of the first selected brief_type option (mirrors TaskCreatePanel).
  let category: string | undefined;
  const briefField = byKey.get('brief_type');
  const briefArr = (out['brief_type'] as string[] | undefined) || [];
  if (briefField && briefArr.length) {
    const first = briefArr[0];
    category =
      first === '__other__'
        ? ((out['brief_type_other'] as string) || 'Other')
        : briefField.options.find((o) => o.value === first)?.label || first;
  }

  return { custom: out, category };
}

/**
 * Builds one space's read-only data from a template-folder row (which must
 * already have its `lists` and `client_space_template(slug)` embedded): the
 * derived-lane task list (with assignee names/avatars), the hours plan, ~6
 * months of daily time totals, and the brief field definitions.
 */
async function buildSpaceData(folder: any): Promise<DesignShareSpace> {
  const templateSlug = (folder.client_space_template?.slug as string | undefined) ?? null;
  const isVideo = templateSlug === 'video-editing-space';

  const lists = (folder.lists || []).filter((l: any) => !l.deleted_at) as {
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

  const plan = await getFolderPlanHours(folder.id);
  const time_summary = await aggregateFolderTimeSummary(folder.id, istMonthStartISO(5), istTodayISO());
  const designType = await getDesignTaskType(isVideo);

  return {
    id: folder.id,
    name: folder.name,
    template_slug: templateSlug,
    is_video: isVideo,
    tasks: shareTasks,
    plan,
    time_summary,
    fields: designType?.fields || [],
  };
}

export interface ClientShareSnapshot {
  client: { name: string };
  spaces: DesignShareSpace[];
}

/**
 * Builds the full read-only payload for a CLIENT-folder public share view: the
 * client name plus every design/video space (template sub-folder) under that
 * client folder, each with its own dashboard data. Returns null if the client
 * folder is missing/deleted.
 */
export async function buildClientShareSnapshot(
  clientFolderId: string,
): Promise<ClientShareSnapshot | null> {
  const { data: clientFolder } = await supabaseAdmin
    .from('folders')
    .select('id, name, folder_type')
    .eq('id', clientFolderId)
    .is('deleted_at', null)
    .single();
  // Only ever render a client folder publicly — never a regular project folder,
  // even if a stale link somehow points at one.
  if (!clientFolder || (clientFolder as any).folder_type !== 'client') return null;

  const { data: childFolders } = await supabaseAdmin
    .from('folders')
    .select(
      'id, name, position, lists(id, name, deleted_at), client_space_template:client_space_template_id(slug)',
    )
    .eq('parent_folder_id', clientFolderId)
    .not('client_space_template_id', 'is', null)
    .is('deleted_at', null)
    .order('position', { ascending: true });

  const spaces: DesignShareSpace[] = [];
  for (const f of childFolders || []) {
    const built = await buildSpaceData(f);
    // Only surface a space to the client if it actually exists as a working
    // space: it has at least one task, OR it's been set up with a real workflow
    // (more than a single backing list — a freshly instantiated space seeds
    // multiple stage lists). This keeps empty stub spaces — e.g. a Video Editing
    // Space folder that was created but never used — out of the client's space
    // switcher, while still showing a newly set-up space so they can submit a
    // first request.
    const activeLists = (((f as any).lists as any[]) || []).filter((l) => !l.deleted_at);
    if (built.tasks.length > 0 || activeLists.length > 1) {
      spaces.push(built);
    }
  }

  return { client: { name: (clientFolder as any).name }, spaces };
}

/**
 * Verifies that `spaceFolderId` is a design/video space directly under
 * `clientFolderId` (so a public submit/upload can only target the linked
 * client's own spaces). Returns the space's template slug, or null if invalid.
 */
export async function getClientSpaceTemplate(
  spaceFolderId: string,
  clientFolderId: string,
): Promise<{ template_slug: string | null; client_id: string | null } | null> {
  const { data } = await supabaseAdmin
    .from('folders')
    .select('id, client_id, client_space_template:client_space_template_id(slug)')
    .eq('id', spaceFolderId)
    .eq('parent_folder_id', clientFolderId)
    .not('client_space_template_id', 'is', null)
    .is('deleted_at', null)
    .maybeSingle();
  if (!data) return null;
  return {
    template_slug: ((data as any).client_space_template?.slug as string | undefined) ?? null,
    client_id: ((data as any).client_id as string | null) ?? null,
  };
}
