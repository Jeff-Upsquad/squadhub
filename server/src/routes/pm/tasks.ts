import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { User } from '@squadhub/shared';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { checkResourceAccess, meetsAccessLevel, requirePermission, isWorkspaceAdmin, isResourceLocked, getPrimaryRolePermissions } from '../../middleware/permissions';
import { getUserRoleIds } from '../../utils/roles';
import { PARTNER_USER_TYPES } from '@squadhub/shared';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

const createSchema = z.object({
  list_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  status: z.string().optional(),
  priority: z.enum(['emergency', 'urgent', 'high', 'normal', 'low', 'none']).optional(),
  due_date: z.string().optional(),
  work_date: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  task_type_id: z.string().uuid().nullable().optional(),
  parent_task_id: z.string().uuid().nullable().optional(),
  assignee_ids: z.array(z.string().uuid()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().nullable().optional(),
  status: z.string().optional(),
  priority: z.enum(['emergency', 'urgent', 'high', 'normal', 'low', 'none']).optional(),
  due_date: z.string().nullable().optional(),
  work_date: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  task_type_id: z.string().uuid().nullable().optional(),
  time_estimate: z.number().int().min(0).nullable().optional(),
  time_tracked: z.number().int().min(0).optional(),
  assignee_ids: z.array(z.string().uuid()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  list_id: z.string().uuid().optional(),
});

// Helper to get list_id from a task
async function getTaskListId(taskId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('tasks').select('list_id').eq('id', taskId).single();
  return data?.list_id || null;
}

// Helper to attach hydrated assignees to one or more task rows.
// Tasks are stored with `assignee_ids: UUID[]`; the frontend expects
// `assignees: User[]` on each task.
async function hydrateAssignees<T extends { assignee_ids?: string[] | null }>(
  tasks: T[],
): Promise<(T & { assignees: User[] })[]> {
  const allIds = Array.from(new Set(tasks.flatMap(t => t.assignee_ids || [])));
  if (allIds.length === 0) {
    return tasks.map(t => ({ ...t, assignees: [] as User[] }));
  }
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, display_name, email, avatar_url, user_type, is_admin, status, created_at')
    .in('id', allIds);
  const byId = new Map<string, User>((users || []).map((u: any) => [u.id, u as User]));
  return tasks.map(t => ({
    ...t,
    assignees: (t.assignee_ids || [])
      .map(id => byId.get(id))
      .filter((u): u is User => !!u),
  }));
}

// Attach `list: { id, name }`, `folder: { id, name }`, and `space: { id, name }`
// to each task so the frontend can show the task's parent list/folder/space
// without a second round-trip.
async function hydrateLists<T extends { list_id: string }>(
  tasks: T[],
): Promise<(T & {
  list: { id: string; name: string } | null;
  folder: { id: string; name: string } | null;
  space: { id: string; name: string } | null;
})[]> {
  const listIds = Array.from(new Set(tasks.map(t => t.list_id).filter(Boolean)));
  if (listIds.length === 0) {
    return tasks.map(t => ({ ...t, list: null, folder: null, space: null }));
  }
  const { data: lists } = await supabaseAdmin
    .from('lists')
    .select('id, name, space_id, folder_id')
    .in('id', listIds);
  const spaceIds = Array.from(new Set((lists || []).map((l: any) => l.space_id).filter(Boolean)));
  const folderIds = Array.from(new Set((lists || []).map((l: any) => l.folder_id).filter(Boolean)));
  const [{ data: spaces }, { data: folders }] = await Promise.all([
    spaceIds.length
      ? supabaseAdmin.from('spaces').select('id, name').in('id', spaceIds)
      : Promise.resolve({ data: [] as any[] }),
    folderIds.length
      ? supabaseAdmin.from('folders').select('id, name').in('id', folderIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const listById = new Map<string, { id: string; name: string; space_id: string | null; folder_id: string | null }>(
    (lists || []).map((l: any) => [l.id, l]),
  );
  const spaceById = new Map<string, { id: string; name: string }>(
    (spaces || []).map((s: any) => [s.id, s]),
  );
  const folderById = new Map<string, { id: string; name: string }>(
    (folders || []).map((f: any) => [f.id, f]),
  );
  return tasks.map(t => {
    const l = listById.get(t.list_id);
    const s = l?.space_id ? spaceById.get(l.space_id) : null;
    const f = l?.folder_id ? folderById.get(l.folder_id) : null;
    return {
      ...t,
      list: l ? { id: l.id, name: l.name } : null,
      folder: f ? { id: f.id, name: f.name } : null,
      space: s ? { id: s.id, name: s.name } : null,
    };
  });
}

// Attach `parent_task: { id, title } | null` to each task so the frontend
// can show parent context on subtask rows without a second round-trip.
async function hydrateParents<T extends { parent_task_id: string | null }>(
  tasks: T[],
): Promise<(T & { parent_task: { id: string; title: string } | null })[]> {
  const parentIds = Array.from(
    new Set(tasks.map(t => t.parent_task_id).filter((id): id is string => !!id)),
  );
  if (parentIds.length === 0) {
    return tasks.map(t => ({ ...t, parent_task: null }));
  }
  const { data: parents } = await supabaseAdmin
    .from('tasks')
    .select('id, title')
    .in('id', parentIds);
  const byId = new Map<string, { id: string; title: string }>(
    (parents || []).map((p: any) => [p.id, { id: p.id, title: p.title }]),
  );
  return tasks.map(t => ({
    ...t,
    parent_task: t.parent_task_id ? byId.get(t.parent_task_id) || null : null,
  }));
}

// GET /pm/task-types — task types the caller can use when creating a task.
// Admins see every type. Non-admins get is_enabled types, with custom
// (non-system) types gated by task_type_role_access or task_type_user_access.
// ?include_ids=id1,id2 forces-include specific types (used when rendering a
// task whose current type isn't in the user's accessible set).
router.get('/task-types', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const includeIds = (req.query.include_ids as string || '')
      .split(',').map((s) => s.trim()).filter(Boolean);

    // Admin bypass
    const { data: me } = await supabaseAdmin
      .from('users')
      .select('is_admin')
      .eq('id', userId)
      .single();
    const isAdmin = !!(me as any)?.is_admin;

    const { data: types, error: typesErr } = await supabaseAdmin
      .from('task_types')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (typesErr) {
      res.status(500).json({ success: false, error: typesErr.message });
      return;
    }

    let visible = types || [];

    if (!isAdmin) {
      // Caller's workspace roles (primary + secondary)
      const roleIds = await getUserRoleIds(userId);

      // Access row sets (pulled once for all types)
      let accessibleTypeIds = new Set<string>();

      const { data: userAccess } = await supabaseAdmin
        .from('task_type_user_access')
        .select('task_type_id')
        .eq('user_id', userId);
      (userAccess || []).forEach((ua: any) => accessibleTypeIds.add(ua.task_type_id));

      if (roleIds.length > 0) {
        const { data: roleAccess } = await supabaseAdmin
          .from('task_type_role_access')
          .select('task_type_id')
          .in('role_id', roleIds);
        (roleAccess || []).forEach((ra: any) => accessibleTypeIds.add(ra.task_type_id));
      }

      visible = visible.filter((t: any) => {
        if (includeIds.includes(t.id)) return true;
        if (!t.is_enabled) return false;
        if (t.is_system) return true;
        return accessibleTypeIds.has(t.id);
      });
    }

    const visibleIds = visible.map((t: any) => t.id);
    const { data: fields, error: fieldsErr } = visibleIds.length
      ? await supabaseAdmin
          .from('task_type_fields')
          .select('*')
          .in('task_type_id', visibleIds)
          .order('position', { ascending: true })
      : { data: [] as any[], error: null };
    if (fieldsErr) {
      res.status(500).json({ success: false, error: fieldsErr.message });
      return;
    }

    const byType = new Map<string, any[]>();
    for (const f of fields || []) {
      const list = byType.get(f.task_type_id) || [];
      list.push(f);
      byType.set(f.task_type_id, list);
    }

    const result = visible.map((t: any) => ({ ...t, fields: byType.get(t.id) || [] }));
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Get task types error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/tasks?list_id=xxx — requires viewer access on the list
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const listId = req.query.list_id as string;
    if (!listId) {
      res.status(400).json({ success: false, error: 'list_id is required' });
      return;
    }

    const userLevel = await checkResourceAccess(req.userId!, 'list', listId);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this list' });
      return;
    }

    let query = supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('list_id', listId);

    // Filters
    if (req.query.status) query = query.eq('status', req.query.status as string);
    if (req.query.priority) query = query.eq('priority', req.query.priority as string);

    // Subtasks are shown inside their parent's detail panel, not in the list
    if (req.query.include_subtasks !== 'true') {
      query = query.is('parent_task_id', null);
    }

    // Sort
    const sort = (req.query.sort as string) || 'created_at';
    if (sort === 'due_date') {
      query = query.order('due_date', { ascending: true, nullsFirst: false });
    } else if (sort === 'priority') {
      query = query.order('priority').order('created_at', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const hydrated = await hydrateAssignees(data || []);
    res.json({ success: true, data: hydrated });
  } catch (err) {
    console.error('Get tasks error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/tasks/my — returns the logged-in user's assigned tasks
// bucketed by due-date in the requested timezone. Today and Tomorrow
// buckets also match on work_date and start_date.
// Used by the partner mobile app's Tasks tab.
router.get('/tasks/my', async (req: Request, res: Response) => {
  try {
    const tz = (req.query.tz as string) || 'Asia/Kolkata';
    const includeDone = req.query.include_done === 'true';

    let query = supabaseAdmin
      .from('tasks')
      .select('*')
      .contains('assignee_ids', [req.userId!]);

    if (!includeDone) {
      query = query.not('status', 'in', '(done,closed)');
    }

    const { data, error } = await query.order('due_date', { ascending: true, nullsFirst: false });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const withAssignees = await hydrateAssignees(data || []);
    const withLists = await hydrateLists(withAssignees);
    const tasks = await hydrateParents(withLists);

    // Compute day boundaries in user's timezone
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const now = new Date();
    const todayStr = fmt.format(now);
    const dayMs = 24 * 60 * 60 * 1000;
    const yesterdayStr = fmt.format(new Date(now.getTime() - dayMs));
    const tomorrowStr = fmt.format(new Date(now.getTime() + dayMs));
    const upcomingCutoffStr = fmt.format(new Date(now.getTime() + 7 * dayMs));

    const buckets: Record<'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'later' | 'focused' | 'day_planner', any[]> = {
      overdue: [], today: [], tomorrow: [], upcoming: [], later: [], focused: [], day_planner: [],
    };

    // All three date fields are TIMESTAMPTZ (migration 034 promoted
    // work_date and start_date from DATE). Format each into the user's
    // timezone before comparing — the naive YYYY-MM-DD slice off the raw
    // UTC timestamp drops a full day for users east of UTC.
    const toTzDay = (v: unknown): string | null => {
      if (!v) return null;
      return fmt.format(new Date(v as string));
    };

    for (const t of tasks) {
      const dueStr = toTzDay(t.due_date);
      const workStr = toTzDay(t.work_date);
      const startStr = toTzDay(t.start_date);
      const focusedAtDay = toTzDay((t as any).focused_at);
      const isSnoozed = (t as any).snoozed_until && new Date((t as any).snoozed_until as string) > now;
      const dateStrs = [dueStr, workStr, startStr].filter(Boolean) as string[];

      const hasToday = dateStrs.includes(todayStr);
      const hasTomorrow = dateStrs.includes(tomorrowStr);

      // Day Planner list: union of all four membership rules, minus snoozed.
      // A task can appear here *and* in today/tomorrow/overdue below.
      const isDueOverdue   = dueStr   && dueStr   <  todayStr;
      const isWorkTodayOr  = workStr  && workStr  <= todayStr;
      const isFocusedRecent = focusedAtDay && (focusedAtDay === todayStr || focusedAtDay === yesterdayStr);
      const isStartSoon    = startStr && (startStr === todayStr || startStr === tomorrowStr);
      if (!isSnoozed && (isDueOverdue || isWorkTodayOr || isFocusedRecent || isStartSoon)) {
        buckets.day_planner.push(t);
      }

      // Today and tomorrow take priority — so a task with work_date today but
      // due_date yesterday shows up on the user's Today list, not Overdue.
      if (hasToday) { buckets.today.push(t); continue; }
      if (hasTomorrow) { buckets.tomorrow.push(t); continue; }

      // Everything else still buckets by due_date only.
      if (!dueStr) { buckets.later.push(t); continue; }
      if (dueStr < todayStr) buckets.overdue.push(t);
      else if (dueStr <= upcomingCutoffStr) buckets.upcoming.push(t);
      else buckets.later.push(t);
    }

    // Starred ("Focus today") tasks are tracked client-side in pmStore and
    // surfaced on the Home focus list. They may not be in the assignee-filtered
    // result above (e.g. unassigned, or no date set), so we fetch any missing
    // ones here and return the full set in a separate `focused` bucket.
    const focusedIds = Array.from(new Set(
      ((req.query.focused_ids as string | undefined) ?? '')
        .split(',').map((s) => s.trim()).filter(Boolean)
    )).slice(0, 200);

    if (focusedIds.length > 0) {
      const alreadyFetched = new Map(tasks.map((t: any) => [t.id, t]));
      const missingIds = focusedIds.filter((id) => !alreadyFetched.has(id));
      let extras: any[] = [];
      if (missingIds.length > 0) {
        // Tasks not in the assignee-filtered set are only allowed in the
        // focused bucket if the caller created them — prevents random
        // unassigned tasks created by someone else from leaking onto the
        // user's focus list when a stale star ID is sent up.
        const { data: extra } = await supabaseAdmin
          .from('tasks')
          .select('*')
          .in('id', missingIds)
          .eq('created_by', req.userId!);
        const filteredExtras = includeDone
          ? (extra ?? [])
          : (extra ?? []).filter((t: any) => t.status !== 'done' && t.status !== 'closed');
        extras = await hydrateParents(await hydrateLists(await hydrateAssignees(filteredExtras)));
      }
      const fromExisting = focusedIds
        .map((id) => alreadyFetched.get(id))
        .filter(Boolean);
      buckets.focused = [...fromExisting, ...extras];
    }

    res.json({ success: true, data: buckets });
  } catch (err) {
    console.error('Get my tasks error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/tasks/emergency — all active EMERGENCY tasks the caller can see.
// Feeds the global EMERGENCY banner.
router.get('/tasks/emergency', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('priority', 'emergency')
      .not('status', 'in', '(done,closed)')
      .is('parent_task_id', null)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const rows = data || [];
    const listIds = Array.from(new Set(rows.map((t: any) => t.list_id).filter(Boolean)));
    const accessCache = new Map<string, boolean>();
    await Promise.all(listIds.map(async (listId) => {
      const level = await checkResourceAccess(req.userId!, 'list', listId as string);
      accessCache.set(listId as string, !!level);
    }));

    const visible = rows.filter((t: any) => accessCache.get(t.list_id) === true);
    const hydrated = await hydrateAssignees(visible);
    res.json({ success: true, data: hydrated });
  } catch (err) {
    console.error('Get emergency tasks error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/tasks/my-time-entries — returns the caller's task time entries
// (per-session history) joined with task + list/folder/space + parent_task for
// the Time Sheet panel. Sorted newest first; client groups by local date.
router.get('/tasks/my-time-entries', async (req: Request, res: Response) => {
  try {
    const { data: entries, error } = await supabaseAdmin
      .from('task_time_entries')
      .select('*')
      .eq('user_id', req.userId!)
      .order('started_at', { ascending: false })
      .limit(500);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const rows = entries || [];
    if (rows.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const taskIds = Array.from(new Set(rows.map((e: any) => e.task_id)));
    const { data: tasks } = await supabaseAdmin
      .from('tasks')
      .select('id, title, list_id, parent_task_id, time_tracked')
      .in('id', taskIds);

    const hydratedTasks = await hydrateParents(await hydrateLists(tasks || []));
    const taskById = new Map<string, any>(hydratedTasks.map((t: any) => [t.id, t]));

    const data = rows.map((e: any) => ({
      ...e,
      task: taskById.get(e.task_id) || null,
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('Get my time entries error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/tasks/:id/time-entries — record one timer session. Creates a row
// in task_time_entries AND atomically bumps tasks.time_tracked so existing
// aggregate UIs (task detail "Logged" field) stay in sync.
const createTimeEntrySchema = z.object({
  started_at: z.string(),
  duration_seconds: z.number().int().min(1),
});

router.post('/tasks/:id/time-entries', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const { started_at, duration_seconds } = createTimeEntrySchema.parse(req.body);

    // Resolve list → space → workspace for the entry's workspace_id
    const { data: task } = await supabaseAdmin
      .from('tasks')
      .select('id, list_id, time_tracked')
      .eq('id', taskId)
      .single();
    if (!task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    const userLevel = await checkResourceAccess(req.userId!, 'list', (task as any).list_id);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this task' });
      return;
    }

    const { data: list } = await supabaseAdmin
      .from('lists').select('space_id').eq('id', (task as any).list_id).single();
    const { data: space } = list?.space_id
      ? await supabaseAdmin.from('spaces').select('workspace_id').eq('id', (list as any).space_id).single()
      : { data: null as any };
    const workspaceId = (space as any)?.workspace_id;
    if (!workspaceId) {
      res.status(500).json({ success: false, error: 'Cannot resolve workspace for task' });
      return;
    }

    const stoppedAt = new Date(new Date(started_at).getTime() + duration_seconds * 1000).toISOString();

    const { data: entry, error: insertErr } = await supabaseAdmin
      .from('task_time_entries')
      .insert({
        task_id: taskId,
        user_id: req.userId!,
        workspace_id: workspaceId,
        started_at,
        stopped_at: stoppedAt,
        duration_seconds,
      })
      .select()
      .single();

    if (insertErr) {
      res.status(500).json({ success: false, error: insertErr.message });
      return;
    }

    // Bump aggregate cache on the task
    const newTotal = ((task as any).time_tracked || 0) + duration_seconds;
    await supabaseAdmin
      .from('tasks')
      .update({ time_tracked: newTotal })
      .eq('id', taskId);

    // Also update daily_time_summaries so the space dashboard reflects this time
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const startedIst = new Date(new Date(started_at).getTime() + IST_OFFSET);
    const entryDate = `${startedIst.getUTCFullYear()}-${String(startedIst.getUTCMonth() + 1).padStart(2, '0')}-${String(startedIst.getUTCDate()).padStart(2, '0')}`;

    const { data: existingSummary } = await supabaseAdmin
      .from('daily_time_summaries')
      .select('id, total_work_seconds')
      .eq('user_id', req.userId!)
      .eq('workspace_id', workspaceId)
      .eq('date', entryDate)
      .eq('context', 'default')
      .maybeSingle();

    if (existingSummary) {
      await supabaseAdmin
        .from('daily_time_summaries')
        .update({
          total_work_seconds: existingSummary.total_work_seconds + duration_seconds,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingSummary.id);
    } else {
      await supabaseAdmin
        .from('daily_time_summaries')
        .insert({
          user_id: req.userId!,
          workspace_id: workspaceId,
          context: 'default',
          date: entryDate,
          total_work_seconds: duration_seconds,
          total_break_seconds: 0,
          total_no_work_seconds: 0,
          session_count: 1,
          first_start: stoppedAt,
          last_stop: stoppedAt,
        });
    }

    res.json({ success: true, data: entry });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create time entry error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/tasks/:id — requires viewer access on parent list
router.get('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const listId = await getTaskListId(id);
    if (!listId) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    const userLevel = await checkResourceAccess(req.userId!, 'list', listId);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this task' });
      return;
    }

    const { data: task, error } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    // Get comment count (task_comments table may not exist)
    let commentCount = 0;
    try {
      const { count } = await supabaseAdmin
        .from('task_comments')
        .select('*', { count: 'exact', head: true })
        .eq('task_id', id);
      commentCount = count || 0;
    } catch { /* table may not exist */ }

    // Get creator
    const { data: creator } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url')
      .eq('id', task.created_by)
      .single();

    // Fetch subtasks (direct children)
    const { data: subtasks } = await supabaseAdmin
      .from('tasks')
      .select('id, title, status, priority, due_date, assignee_ids, created_at')
      .eq('parent_task_id', id)
      .order('created_at', { ascending: true });

    const [hydratedTask] = await hydrateAssignees([task]);
    const hydratedSubtasks = await hydrateAssignees(subtasks || []);

    res.json({
      success: true,
      data: {
        ...hydratedTask,
        subtasks: hydratedSubtasks,
        comment_count: commentCount,
        creator,
      },
    });
  } catch (err) {
    console.error('Get task error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/tasks — requires member access on the list
router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    const userLevel = await checkResourceAccess(req.userId!, 'list', body.list_id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'member')) {
      res.status(403).json({ success: false, error: 'Member access required to create tasks' });
      return;
    }

    const adminUser = await isWorkspaceAdmin(req.userId!);
    if (!adminUser && await isResourceLocked('list', body.list_id)) {
      res.status(403).json({ success: false, error: 'This list is locked' });
      return;
    }

    // If the list is under a client-tagged folder, assign a per-client
    // sequential display_number. Non-client tasks get null.
    let displayNumber: number | null = null;
    const { data: parentList } = await supabaseAdmin
      .from('lists')
      .select('folder_id')
      .eq('id', body.list_id)
      .single();
    if (parentList?.folder_id) {
      const { data: parentFolder } = await supabaseAdmin
        .from('folders')
        .select('client_id')
        .eq('id', parentList.folder_id)
        .single();
      if (parentFolder?.client_id) {
        const { data: n, error: nErr } = await supabaseAdmin.rpc(
          'increment_client_task_counter',
          { p_client_id: parentFolder.client_id },
        );
        if (nErr) {
          console.warn('[pm/tasks] increment_client_task_counter failed:', nErr);
        } else if (typeof n === 'number') {
          displayNumber = n;
        }
      }
    }

    // Resolve task_type_id + key: use supplied value or fall back to the default type
    let resolvedTypeId: string | null = body.task_type_id ?? null;
    let resolvedTypeKey: string | null = null;
    if (resolvedTypeId) {
      const { data: t } = await supabaseAdmin
        .from('task_types')
        .select('id, key')
        .eq('id', resolvedTypeId)
        .maybeSingle();
      resolvedTypeKey = (t as any)?.key ?? null;
    } else {
      const { data: defaultType } = await supabaseAdmin
        .from('task_types')
        .select('id, key')
        .eq('is_default', true)
        .maybeSingle();
      resolvedTypeId = (defaultType as any)?.id ?? null;
      resolvedTypeKey = (defaultType as any)?.key ?? null;
    }

    // Catalog-driven task type uses 'open' as its initial status; legacy types still use 'todo'.
    const defaultStatus = resolvedTypeKey === 'task' ? 'open' : 'todo';

    const insertData: Record<string, any> = {
      list_id: body.list_id,
      title: body.title,
      description: body.description || null,
      status: body.status || defaultStatus,
      priority: body.priority || 'none',
      due_date: body.due_date || null,
      work_date: body.work_date || null,
      start_date: body.start_date || null,
      task_type_id: resolvedTypeId,
      parent_task_id: body.parent_task_id || null,
      assignee_ids: body.assignee_ids || [],
      metadata: body.metadata || {},
      created_by: req.userId!,
    };
    if (displayNumber != null) {
      insertData.display_number = displayNumber;
    }

    const { data: task, error } = await supabaseAdmin
      .from('tasks')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const [hydratedTask] = await hydrateAssignees([task]);
    res.status(201).json({ success: true, data: hydratedTask });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create task error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /pm/tasks/:id — requires member access on parent list
router.put('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const body = updateSchema.parse(req.body);

    const listId = await getTaskListId(id);
    if (!listId) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    const userLevel = await checkResourceAccess(req.userId!, 'list', listId);
    if (!userLevel || !meetsAccessLevel(userLevel, 'member')) {
      res.status(403).json({ success: false, error: 'Member access required to update tasks' });
      return;
    }

    const adminUser = await isWorkspaceAdmin(req.userId!);
    if (!adminUser && await isResourceLocked('list', listId)) {
      res.status(403).json({ success: false, error: 'This list is locked' });
      return;
    }

    if (body.list_id && body.list_id !== listId) {
      const { data: destList } = await supabaseAdmin
        .from('lists')
        .select('id, deleted_at')
        .eq('id', body.list_id)
        .single();
      if (!destList || destList.deleted_at) {
        res.status(400).json({ success: false, error: 'Destination list does not exist' });
        return;
      }
      const destLevel = await checkResourceAccess(req.userId!, 'list', body.list_id);
      if (!destLevel || !meetsAccessLevel(destLevel, 'member')) {
        res.status(403).json({ success: false, error: 'Member access required on destination list' });
        return;
      }
      if (!adminUser && await isResourceLocked('list', body.list_id)) {
        res.status(403).json({ success: false, error: 'Destination list is locked' });
        return;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update({ ...body, last_modified_by: req.userId! })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const [hydratedTask] = await hydrateAssignees([data]);
    res.json({ success: true, data: hydratedTask });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update task error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /pm/tasks/:id/time-tracked — manual edit of the "Logged" value on a task.
// Requires can_edit_time_logs on the user's PRIMARY role (not unioned). This is
// separate from PUT /pm/tasks/:id so that ActiveTimer can keep writing through
// PUT without tripping the role check.
const patchTimeTrackedSchema = z.object({
  time_tracked: z.number().int().min(0),
});

router.patch('/tasks/:id/time-tracked', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { time_tracked } = patchTimeTrackedSchema.parse(req.body);

    const listId = await getTaskListId(id);
    if (!listId) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    const userLevel = await checkResourceAccess(req.userId!, 'list', listId);
    if (!userLevel || !meetsAccessLevel(userLevel, 'member')) {
      res.status(403).json({ success: false, error: 'Member access required' });
      return;
    }

    const primary = await getPrimaryRolePermissions(req.userId!);
    if (primary.can_edit_time_logs !== true) {
      res.status(403).json({ success: false, error: 'Your role cannot edit logged time' });
      return;
    }

    // Read the old aggregate + workspace_id to compute the delta and attribute
    // the entry correctly. If old == new, skip the entry (no-op edit).
    const { data: existing } = await supabaseAdmin
      .from('tasks')
      .select('time_tracked, list_id')
      .eq('id', id)
      .single();
    const oldTotal = (existing as any)?.time_tracked || 0;
    const delta = time_tracked - oldTotal;

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update({ time_tracked })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    if (delta !== 0) {
      const { data: list } = await supabaseAdmin
        .from('lists').select('space_id').eq('id', (existing as any).list_id).single();
      const { data: space } = list?.space_id
        ? await supabaseAdmin.from('spaces').select('workspace_id').eq('id', (list as any).space_id).single()
        : { data: null as any };
      const workspaceId = (space as any)?.workspace_id;
      if (workspaceId) {
        const now = new Date().toISOString();
        await supabaseAdmin.from('task_time_entries').insert({
          task_id: id,
          user_id: req.userId!,
          workspace_id: workspaceId,
          started_at: now,
          stopped_at: now,
          duration_seconds: delta,
          source: 'manual',
        });
      }
    }

    const [hydrated] = await hydrateAssignees([data]);
    res.json({ success: true, data: hydrated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Patch time_tracked error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/tasks/:id — requires member access on parent list
router.delete('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const listId = await getTaskListId(id);
    if (!listId) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    const userLevel = await checkResourceAccess(req.userId!, 'list', listId);
    if (!userLevel || !meetsAccessLevel(userLevel, 'member')) {
      res.status(403).json({ success: false, error: 'Member access required to delete tasks' });
      return;
    }

    const adminUser = await isWorkspaceAdmin(req.userId!);
    if (!adminUser && await isResourceLocked('list', listId)) {
      res.status(403).json({ success: false, error: 'This list is locked' });
      return;
    }

    const { error } = await supabaseAdmin.from('tasks').delete().eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Task deleted' });
  } catch (err) {
    console.error('Delete task error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/tasks/:id/assignable-users — users with viewer+ access to the
// task's parent list (direct membership on list, or inherited from the
// parent folder / space). Used by the assignee picker in the UI.
router.get('/tasks/:id/assignable-users', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;

    const listId = await getTaskListId(taskId);
    if (!listId) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    const userLevel = await checkResourceAccess(req.userId!, 'list', listId);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this task' });
      return;
    }

    // Resolve the chain of resources that grant access to this list:
    // list → folder → space. A user who is a member of any of those
    // is an assignable candidate.
    const resourceFilters: Array<{ type: string; id: string }> = [
      { type: 'list', id: listId },
    ];

    const { data: list } = await supabaseAdmin
      .from('lists')
      .select('folder_id, space_id')
      .eq('id', listId)
      .single();
    if ((list as any)?.folder_id) {
      resourceFilters.push({ type: 'folder', id: (list as any).folder_id });
    }
    if ((list as any)?.space_id) {
      resourceFilters.push({ type: 'space', id: (list as any).space_id });
    }

    // Union-query across the (type, id) pairs.
    const orClauses = resourceFilters
      .map(f => `and(resource_type.eq.${f.type},resource_id.eq.${f.id})`)
      .join(',');

    const { data: memberships, error } = await supabaseAdmin
      .from('resource_memberships')
      .select('user_id, users!resource_memberships_user_id_fkey(id, display_name, email, avatar_url, user_type, is_admin, status, created_at)')
      .or(orClauses);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Dedupe by user_id, drop inactive users.
    const seen = new Set<string>();
    const users: User[] = [];
    for (const m of (memberships || []) as any[]) {
      if (!m.users || seen.has(m.user_id)) continue;
      if (m.users.status && m.users.status !== 'active') continue;
      seen.add(m.user_id);
      users.push(m.users as User);
    }

    users.sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email));

    res.json({ success: true, data: users });
  } catch (err) {
    console.error('Get assignable users error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/tasks/:id/comments — requires viewer access on parent list
router.get('/tasks/:id/comments', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;

    const listId = await getTaskListId(taskId);
    if (listId) {
      const userLevel = await checkResourceAccess(req.userId!, 'list', listId);
      if (!userLevel) {
        res.status(403).json({ success: false, error: 'You do not have access to this task' });
        return;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('task_comments')
      .select('*, users(id, display_name, email, avatar_url)')
      .eq('task_id', taskId)
      .order('created_at');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const comments = (data || []).map((c: any) => ({
      ...c,
      user: c.users,
      users: undefined,
    }));

    res.json({ success: true, data: comments });
  } catch (err) {
    console.error('Get comments error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/tasks/:id/comments — requires commenter access on parent list
const commentSchema = z.object({
  content: z.string().min(1),
  mentions: z.array(z.string().uuid()).max(100).optional(),
});

router.post('/tasks/:id/comments', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }
    const { content, mentions } = parsed.data;

    if (!content.trim()) {
      res.status(400).json({ success: false, error: 'Content is required' });
      return;
    }

    const listId = await getTaskListId(taskId);
    if (listId) {
      const userLevel = await checkResourceAccess(req.userId!, 'list', listId);
      if (!userLevel || !meetsAccessLevel(userLevel, 'commenter')) {
        res.status(403).json({ success: false, error: 'Commenter access required to add comments' });
        return;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('task_comments')
      .insert({
        task_id: taskId,
        user_id: req.userId!,
        content: content.trim(),
        mentions: mentions || [],
      })
      .select('*, users(id, display_name, email, avatar_url)')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({
      success: true,
      data: { ...data, user: (data as any).users, users: undefined },
    });
  } catch (err) {
    console.error('Create comment error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/task-comments/:id — requires can_delete_messages or member access
router.delete('/task-comments/:id', requirePermission('can_delete_messages'), async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { error } = await supabaseAdmin.from('task_comments').delete().eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Comment deleted' });
  } catch (err) {
    console.error('Delete comment error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /pm/tasks/:id/focus — set or clear the "Focus today" star on a task.
// Body: { focused: boolean }. When true, focused_at is set to now(); when false, cleared.
router.patch('/tasks/:id/focus', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const focused = !!req.body?.focused;
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update({ focused_at: focused ? new Date().toISOString() : null })
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('Patch focus error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /pm/tasks/:id/snooze — set or clear the snooze timestamp on a task.
// Body: { until: ISO string | null }. Day Planner hides snoozed tasks until that moment.
router.patch('/tasks/:id/snooze', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const until = req.body?.until;
    if (until !== null && typeof until !== 'string') {
      res.status(400).json({ success: false, error: 'until must be an ISO string or null' });
      return;
    }
    if (until && Number.isNaN(Date.parse(until))) {
      res.status(400).json({ success: false, error: 'until is not a valid ISO timestamp' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update({ snoozed_until: until })
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('Patch snooze error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
