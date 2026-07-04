import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { User, TaskRecurrence, TaskTag, TaskListPath } from '@squadhub/shared';
import { taskRecurrenceOccursOn, getTaskStatusCategory } from '@squadhub/shared';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { checkResourceAccess, meetsAccessLevel, requirePermission, isWorkspaceAdmin, isResourceLocked, getPrimaryRolePermissions } from '../../middleware/permissions';
import { getUserRoleIds } from '../../utils/roles';
import { PARTNER_USER_TYPES } from '@squadhub/shared';
import { spawnRoutineInstance } from '../../services/routineSpawner';
import { todayIST } from '../../utils/ist';
import { logTaskTimeEntry } from '../../utils/taskTime';
import { logTaskActivity, type TaskActivityEvent } from '../../utils/taskActivity';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

// Routines: recurrence rule shape (same dialect as work_blocks, but no
// 'none' kind — "does not repeat" is recurrence = null).
const recurrenceDateRe = /^\d{4}-\d{2}-\d{2}$/;
const recurrenceSchema = z.object({
  kind: z.enum(['daily', 'weekdays', 'weekly', 'monthly']),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  day_of_month: z.number().int().min(1).max(28).optional(),
  starts_on: z.string().regex(recurrenceDateRe).optional(),
  ends_on: z.string().regex(recurrenceDateRe).nullable().optional(),
});

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
  recurrence: recurrenceSchema.nullable().optional(),
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
  recurrence: recurrenceSchema.nullable().optional(),
});

// Helper to get list_id from a task
async function getTaskListId(taskId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('tasks').select('list_id').eq('id', taskId).single();
  return data?.list_id || null;
}

// ---- Completion gate --------------------------------------------------------
// A task can only move INTO a done/closed status once every direct subtask is
// complete and every checklist item is checked. The web client shows a blocking
// prompt before it ever calls PUT; this is the authoritative backstop for every
// other write path (board drag, home rows, mobile apps).

// Custom (design/video) spaces store the status NAME on tasks, so completion
// checks must resolve the list's space statuses, not just literal categories.
async function getSpaceDoneStatusNames(listId: string | null): Promise<Set<string>> {
  const names = new Set<string>();
  if (!listId) return names;
  const { data: list } = await supabaseAdmin.from('lists').select('space_id').eq('id', listId).single();
  const spaceId = (list as any)?.space_id;
  if (!spaceId) return names;
  const { data } = await supabaseAdmin
    .from('space_statuses')
    .select('name, category')
    .eq('space_id', spaceId)
    .in('category', ['done', 'closed']);
  for (const s of (data || []) as { name: string }[]) names.add(s.name);
  return names;
}

// Open (not yet complete) direct subtasks + unchecked checklist items.
async function countOpenCompletionItems(
  taskId: string,
  isDoneStatus: (st: string | null | undefined) => boolean,
): Promise<{ open_subtasks: number; open_checklist_items: number }> {
  const { data: subs } = await supabaseAdmin
    .from('tasks')
    .select('status')
    .eq('parent_task_id', taskId);
  const open_subtasks = (subs || []).filter((s: any) => !isDoneStatus(s.status)).length;

  const { data: cls } = await supabaseAdmin
    .from('task_checklists')
    .select('id')
    .eq('task_id', taskId);
  let open_checklist_items = 0;
  if (cls && cls.length > 0) {
    const { count } = await supabaseAdmin
      .from('task_checklist_items')
      .select('id', { count: 'exact', head: true })
      .in('checklist_id', cls.map((c: any) => c.id))
      .eq('is_done', false);
    open_checklist_items = count || 0;
  }
  return { open_subtasks, open_checklist_items };
}

// Helper to attach hydrated assignees to one or more task rows.
// Tasks are stored with `assignee_ids: UUID[]`; the frontend expects
// `assignees: User[]` on each task.
export async function hydrateAssignees<T extends { assignee_ids?: string[] | null }>(
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

// Attach hydrated labels (`tags: TaskTag[]`) to one or more task rows from the
// task_tag_assignments join. Attached labels always render on the task (read),
// regardless of the viewer's group visibility — visibility only gates the
// picker (GET /pm/labels), not labels already on a task.
export async function hydrateLabels<T extends { id: string }>(
  tasks: T[],
): Promise<(T & { tags: TaskTag[] })[]> {
  const taskIds = tasks.map(t => t.id);
  if (taskIds.length === 0) return tasks.map(t => ({ ...t, tags: [] as TaskTag[] }));

  const { data: assigns } = await supabaseAdmin
    .from('task_tag_assignments')
    .select('task_id, tag_id')
    .in('task_id', taskIds);

  const tagIds = Array.from(new Set((assigns || []).map((a: any) => a.tag_id)));
  const tagsById = new Map<string, TaskTag>();
  if (tagIds.length) {
    const { data: tags } = await supabaseAdmin
      .from('task_tags')
      .select('id, workspace_id, group_id, name, color')
      .in('id', tagIds);
    (tags || []).forEach((t: any) => tagsById.set(t.id, t as TaskTag));
  }

  const byTask = new Map<string, TaskTag[]>();
  for (const a of assigns || []) {
    const tag = tagsById.get((a as any).tag_id);
    if (!tag) continue;
    const arr = byTask.get((a as any).task_id) || [];
    arr.push(tag);
    byTask.set((a as any).task_id, arr);
  }

  return tasks.map(t => ({ ...t, tags: byTask.get(t.id) || [] }));
}

// Attach `list: { id, name }`, `folder: { id, name }`, and `space: { id, name }`
// to each task so the frontend can show the task's parent list/folder/space
// without a second round-trip.
type GroupContainer = { type: 'list' | 'folder' | 'space'; id: string; name: string } | null;

// For each given list id, resolve its full list/folder/space chain plus the
// nearest ancestor with Group Tasks ON (innermost-first: list → folder → space).
// Shared by hydrateLists (a task's primary list) and hydrateMultiHomeGroups
// (a task's secondary "ALSO IN" lists).
async function resolveListContainers(
  listIds: string[],
): Promise<Map<string, {
  list: { id: string; name: string };
  folder: { id: string; name: string } | null;
  space: { id: string; name: string } | null;
  group_container: GroupContainer;
}>> {
  const out = new Map<string, {
    list: { id: string; name: string };
    folder: { id: string; name: string } | null;
    space: { id: string; name: string } | null;
    group_container: GroupContainer;
  }>();
  if (listIds.length === 0) return out;
  const { data: lists } = await supabaseAdmin
    .from('lists')
    .select('id, name, space_id, folder_id, group_tasks')
    .in('id', listIds);
  const spaceIds = Array.from(new Set((lists || []).map((l: any) => l.space_id).filter(Boolean)));
  const folderIds = Array.from(new Set((lists || []).map((l: any) => l.folder_id).filter(Boolean)));
  const [{ data: spaces }, { data: folders }] = await Promise.all([
    spaceIds.length
      ? supabaseAdmin.from('spaces').select('id, name, group_tasks').in('id', spaceIds)
      : Promise.resolve({ data: [] as any[] }),
    folderIds.length
      ? supabaseAdmin.from('folders').select('id, name, group_tasks').in('id', folderIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const spaceById = new Map<string, { id: string; name: string; group_tasks?: boolean }>(
    (spaces || []).map((s: any) => [s.id, s]),
  );
  const folderById = new Map<string, { id: string; name: string; group_tasks?: boolean }>(
    (folders || []).map((f: any) => [f.id, f]),
  );
  for (const l of lists || []) {
    const s = l.space_id ? spaceById.get(l.space_id) : null;
    const f = l.folder_id ? folderById.get(l.folder_id) : null;
    const group_container: GroupContainer = l.group_tasks
      ? { type: 'list', id: l.id, name: l.name }
      : f?.group_tasks
        ? { type: 'folder', id: f.id, name: f.name }
        : s?.group_tasks
          ? { type: 'space', id: s.id, name: s.name }
          : null;
    out.set(l.id, {
      list: { id: l.id, name: l.name },
      folder: f ? { id: f.id, name: f.name } : null,
      space: s ? { id: s.id, name: s.name } : null,
      group_container,
    });
  }
  return out;
}

export async function hydrateLists<T extends { list_id: string }>(
  tasks: T[],
): Promise<(T & {
  list: { id: string; name: string } | null;
  folder: { id: string; name: string } | null;
  space: { id: string; name: string } | null;
  group_container: GroupContainer;
})[]> {
  const listIds = Array.from(new Set(tasks.map(t => t.list_id).filter(Boolean)));
  if (listIds.length === 0) {
    return tasks.map(t => ({ ...t, list: null, folder: null, space: null, group_container: null }));
  }
  const byList = await resolveListContainers(listIds);
  return tasks.map(t => {
    const c = byList.get(t.list_id);
    // Innermost-first: a task collapses under the nearest ancestor with grouping
    // ON (its own list, else folder, else space).
    return {
      ...t,
      list: c?.list ?? null,
      folder: c?.folder ?? null,
      space: c?.space ?? null,
      group_container: c?.group_container ?? null,
    };
  });
}

// Multi-homing: augment each already-list-hydrated task with `group_containers`,
// the deduped set of grouped containers it belongs to — its PRIMARY list chain
// (group_container) PLUS any secondary "ALSO IN" list (task_list_links) whose
// chain has Group Tasks ON. Home renders the task inside EACH of these groups.
// Only used by GET /pm/tasks/my; other endpoints leave group_containers undefined
// and the frontend falls back to [group_container].
export async function hydrateMultiHomeGroups<T extends { id: string; group_container: GroupContainer }>(
  tasks: T[],
): Promise<(T & { group_containers: NonNullable<GroupContainer>[] })[]> {
  const taskIds = Array.from(new Set(tasks.map(t => t.id).filter(Boolean)));
  if (taskIds.length === 0) {
    return tasks.map(t => ({ ...t, group_containers: t.group_container ? [t.group_container] : [] }));
  }
  const { data: links } = await supabaseAdmin
    .from('task_list_links')
    .select('task_id, list_id')
    .in('task_id', taskIds);
  const secondaryListIds = Array.from(new Set((links || []).map((r: any) => r.list_id).filter(Boolean)));
  const byList = await resolveListContainers(secondaryListIds);
  const secondaryByTask = new Map<string, GroupContainer[]>();
  for (const r of links || []) {
    const gc = byList.get((r as any).list_id)?.group_container;
    if (!gc) continue;
    const arr = secondaryByTask.get((r as any).task_id) || [];
    arr.push(gc);
    secondaryByTask.set((r as any).task_id, arr);
  }
  return tasks.map(t => {
    const containers: NonNullable<GroupContainer>[] = [];
    const seen = new Set<string>();
    for (const gc of [t.group_container, ...(secondaryByTask.get(t.id) || [])]) {
      if (gc && !seen.has(gc.id)) {
        seen.add(gc.id);
        containers.push(gc);
      }
    }
    return { ...t, group_containers: containers };
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

    // Multi-homing: a list shows its own tasks (list_id = listId) PLUS any tasks
    // ADDED into it from elsewhere (task_list_links). Fetch the linked task ids
    // first, then OR them into the query.
    const { data: linkRows } = await supabaseAdmin
      .from('task_list_links')
      .select('task_id')
      .eq('list_id', listId);
    const linkedIds = Array.from(new Set((linkRows || []).map((r: any) => r.task_id).filter(Boolean)));

    let query = supabaseAdmin
      .from('tasks')
      .select('*')
      // Routine templates never render in list views — only their spawned copies do.
      .is('recurrence', null);

    if (linkedIds.length) {
      query = query.or(`list_id.eq.${listId},id.in.(${linkedIds.join(',')})`);
    } else {
      query = query.eq('list_id', listId);
    }

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

    const withAssignees = await hydrateAssignees(data || []);
    const hydrated = await hydrateParents(withAssignees);
    // Flag rows that are only in this view because they were ADDED to this list
    // (their primary list_id points elsewhere) so the UI can badge them.
    const linkedSet = new Set(linkedIds);
    const flagged = hydrated.map((t: any) =>
      t.list_id !== listId && linkedSet.has(t.id) ? { ...t, linked_in_list: true } : t,
    );
    res.json({ success: true, data: flagged });
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
      .contains('assignee_ids', [req.userId!])
      // Hide routine templates — their spawned copies carry the real work.
      .is('recurrence', null);

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
    // Multi-home grouping: a task also collapses into any secondary "ALSO IN"
    // list whose chain has Group Tasks ON, not just its primary list chain.
    const withGroups = await hydrateMultiHomeGroups(withLists);
    const withParents = await hydrateParents(withGroups);
    // Attach Labels (`tags`) so the Home "disappearing cards" (Recordings /
    // Meetings / Calls) can filter by label name client-side.
    const tasks = await hydrateLabels(withParents);

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

    const buckets: Record<'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'later' | 'focused' | 'in_progress_today' | 'day_planner', any[]> = {
      overdue: [], today: [], tomorrow: [], upcoming: [], later: [], focused: [], in_progress_today: [], day_planner: [],
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

    // Starred ("Focus") tasks are tracked server-side via the tasks.focused_at
    // column (set by PATCH /tasks/:id/focus from any device, incl. the desktop
    // app), so the focus list is cross-device. Surface the caller's focused
    // tasks: any they're assigned to (already fetched above) plus any they
    // created (which may be unassigned or dateless, so missing from that set).
    {
      // Focus is persistent: a star stays until explicitly cleared (focused_at
      // set to null). It does NOT reset overnight. The future-work-date gate
      // (hide a starred task until its work_date arrives) is applied client-side
      // in the Home Today list, so this bucket carries all focused tasks.
      const isFocused = (t: any) => t.focused_at != null;
      const existingIds = new Set(tasks.map((t: any) => t.id));
      const fromExisting = (tasks as any[]).filter(isFocused);
      const { data: createdFocused } = await supabaseAdmin
        .from('tasks')
        .select('*')
        .not('focused_at', 'is', null)
        .eq('created_by', req.userId!);
      let extra = (createdFocused ?? []).filter((t: any) => !existingIds.has(t.id) && isFocused(t));
      if (!includeDone) {
        extra = extra.filter((t: any) => t.status !== 'done' && t.status !== 'closed');
      }
      const hydratedExtra = await hydrateLabels(await hydrateParents(await hydrateLists(await hydrateAssignees(extra))));
      buckets.focused = [...fromExisting, ...hydratedExtra];
    }

    // "In progress today" — tasks the caller has logged time on today (in their
    // tz), via ANY entry: real timer sessions or manual "Time logged" edits.
    // Pulls recent time entries and keeps those whose started_at lands on
    // todayStr, most-recently-worked first. Full task objects (assignees, dates,
    // parents) so the Home list renders these rows identically to the focus list.
    const { data: recentEntries } = await supabaseAdmin
      .from('task_time_entries')
      .select('task_id, started_at, source')
      .eq('user_id', req.userId!)
      .order('started_at', { ascending: false })
      .limit(300);
    const workedTodayIds: string[] = [];
    const seenWorked = new Set<string>();
    for (const e of recentEntries || []) {
      if (toTzDay((e as any).started_at) !== todayStr) continue;
      const id = (e as any).task_id as string;
      if (seenWorked.has(id)) continue;
      seenWorked.add(id);
      workedTodayIds.push(id);
    }
    if (workedTodayIds.length > 0) {
      const have = new Map(tasks.map((t: any) => [t.id, t]));
      const missingWorked = workedTodayIds.filter((id) => !have.has(id));
      let workedExtras: any[] = [];
      if (missingWorked.length > 0) {
        // The user has time entries on these, so they had access — no created_by
        // gate here (unlike the focus bucket). Still hide done/closed unless asked.
        const { data: extraRows } = await supabaseAdmin
          .from('tasks')
          .select('*')
          .in('id', missingWorked);
        const filtered = includeDone
          ? (extraRows ?? [])
          : (extraRows ?? []).filter((t: any) => t.status !== 'done' && t.status !== 'closed');
        workedExtras = await hydrateParents(await hydrateLists(await hydrateAssignees(filtered)));
      }
      const workedById = new Map<string, any>([
        ...have,
        ...workedExtras.map((t: any) => [t.id, t] as [string, any]),
      ]);
      buckets.in_progress_today = workedTodayIds
        .map((id) => workedById.get(id))
        .filter(Boolean);
    }

    res.json({ success: true, data: buckets });
  } catch (err) {
    console.error('Get my tasks error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/tasks/new — the My Home "New Tasks" review queue: open tasks the caller
// is assigned to, PLUS open tasks they created that are still unassigned. Tasks the
// caller has already ticked as reviewed (task_reviews) drop out, unless
// ?include_reviewed=true, in which case every row carries a `reviewed` boolean so
// the popup can render its "Show reviewed" mode and un-review.
//
// MUST stay declared before '/tasks/:id' below, or that param route swallows "new".
router.get('/tasks/new', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const includeReviewed = req.query.include_reviewed === 'true';

    // Same base shape as /tasks/my: skip routine templates and done/closed tasks.
    // Also skip mirrored Course/Meeting tasks — they're auto-materialised, not
    // something the user needs to "review" as a freshly-assigned task.
    const base = () =>
      supabaseAdmin
        .from('tasks')
        .select('*')
        .is('recurrence', null)
        .is('source_kind', null)
        .not('status', 'in', '(done,closed)');

    // (A) Assigned to me.
    const assignedRes = await base().contains('assignee_ids', [userId]);
    if (assignedRes.error) {
      res.status(500).json({ success: false, error: assignedRes.error.message });
      return;
    }

    // (B) Created by me and still unassigned. An empty UUID[] is '{}', not NULL, so
    // PostgREST can't express "no assignees" cleanly — filter in JS after the fetch.
    const createdRes = await base().eq('created_by', userId);
    if (createdRes.error) {
      res.status(500).json({ success: false, error: createdRes.error.message });
      return;
    }
    const createdUnassigned = (createdRes.data || []).filter(
      (t: any) => !t.assignee_ids || t.assignee_ids.length === 0,
    );

    // Merge + dedupe (a task I created and assigned to myself hits both queries).
    const byId = new Map<string, any>();
    for (const t of [...(assignedRes.data || []), ...createdUnassigned]) byId.set(t.id, t);

    // Which of these has the caller already reviewed?
    const reviewedRes = await supabaseAdmin
      .from('task_reviews')
      .select('task_id')
      .eq('user_id', userId);
    const reviewedSet = new Set((reviewedRes.data || []).map((r: any) => r.task_id as string));

    let rows = Array.from(byId.values());
    if (!includeReviewed) rows = rows.filter((t) => !reviewedSet.has(t.id));
    // Newest first — a review queue reads top-down as "what just landed".
    rows.sort((a, b) =>
      a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
    );

    let hydrated = await hydrateParents(await hydrateLists(await hydrateAssignees(rows)));

    // Drop tasks completed under a custom (space) status whose category is done/closed.
    // Catalog (task_type='task') completes resolve to 'closed' and were already removed by
    // the status NOT IN (done,closed) filter above; this catches custom task types whose
    // "done" status is a space-specific name (e.g. "Delivered", "Shipped").
    const spaceIds = Array.from(new Set(hydrated.map((t: any) => t.space?.id).filter(Boolean)));
    if (spaceIds.length > 0) {
      const { data: spaceStatuses } = await supabaseAdmin
        .from('space_statuses')
        .select('space_id, name, category')
        .in('space_id', spaceIds as string[]);
      const doneStatusKeys = new Set(
        (spaceStatuses || [])
          .filter((s: any) => s.category === 'done' || s.category === 'closed')
          .map((s: any) => `${s.space_id}::${s.name}`),
      );
      if (doneStatusKeys.size > 0) {
        hydrated = hydrated.filter(
          (t: any) => !(t.space?.id && doneStatusKeys.has(`${t.space.id}::${t.status}`)),
        );
      }
    }

    const data = hydrated.map((t: any) => ({ ...t, reviewed: reviewedSet.has(t.id) }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('Get new tasks error:', err);
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
      .is('recurrence', null)
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

    // Work-block entries carry a sub-breakdown: the tasks worked on / completed
    // during the run, shown nested under the block in the Time Sheet.
    const runIds = Array.from(new Set(
      rows
        .filter((e: any) => e.source === 'work_block' && e.work_block_run_id)
        .map((e: any) => e.work_block_run_id as string),
    ));
    const childrenByRun = new Map<string, { task_id: string; title: string; seconds: number; completed: boolean }[]>();
    if (runIds.length > 0) {
      const [{ data: times }, { data: comps }] = await Promise.all([
        supabaseAdmin
          .from('work_block_task_times')
          .select('run_id, task_id, duration_seconds')
          .in('run_id', runIds),
        supabaseAdmin
          .from('work_block_completions')
          .select('run_id, completed_task_id')
          .in('run_id', runIds),
      ]);

      // Aggregate seconds per (run, task); union in completed-without-timer tasks.
      const perRun = new Map<string, Map<string, { seconds: number; completed: boolean }>>();
      const ensure = (runId: string, taskId: string) => {
        let m = perRun.get(runId);
        if (!m) { m = new Map(); perRun.set(runId, m); }
        let a = m.get(taskId);
        if (!a) { a = { seconds: 0, completed: false }; m.set(taskId, a); }
        return a;
      };
      for (const t of (times || []) as any[]) ensure(t.run_id, t.task_id).seconds += t.duration_seconds || 0;
      for (const c of (comps || []) as any[]) ensure(c.run_id, c.completed_task_id).completed = true;

      const childTaskIds = Array.from(new Set(
        Array.from(perRun.values()).flatMap((m) => Array.from(m.keys())),
      ));
      const { data: childTasks } = childTaskIds.length
        ? await supabaseAdmin.from('tasks').select('id, title').in('id', childTaskIds)
        : { data: [] as any[] };
      const titleById = new Map((childTasks || []).map((t: any) => [t.id, t.title as string]));

      for (const [runId, m] of perRun.entries()) {
        childrenByRun.set(runId, Array.from(m.entries())
          .map(([taskId, a]) => ({
            task_id: taskId,
            title: titleById.get(taskId) || 'Task',
            seconds: a.seconds,
            completed: a.completed,
          }))
          .sort((x, y) => y.seconds - x.seconds));
      }
    }

    const data = rows.map((e: any) => ({
      ...e,
      task: taskById.get(e.task_id) || null,
      children: e.source === 'work_block' && e.work_block_run_id
        ? (childrenByRun.get(e.work_block_run_id) || [])
        : undefined,
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

    // Access control: caller must have access to the task's list.
    const { data: task } = await supabaseAdmin
      .from('tasks')
      .select('id, list_id')
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

    // If this timer overlapped a work-block run, the block already counts this
    // wall-clock toward the daily total — log the entry (per-task history +
    // "Logged" field) but skip the daily aggregate so we don't double-count.
    const stoppedAt = new Date(new Date(started_at).getTime() + duration_seconds * 1000).toISOString();
    const { data: activeRun } = await supabaseAdmin
      .from('work_block_runs')
      .select('id')
      .eq('user_id', req.userId!)
      .is('ended_at', null)
      .lte('started_at', stoppedAt)
      .limit(1);
    let withinBlock = !!(activeRun && activeRun.length);
    if (!withinBlock) {
      const { data: closedRun } = await supabaseAdmin
        .from('work_block_runs')
        .select('id')
        .eq('user_id', req.userId!)
        .not('ended_at', 'is', null)
        .lte('started_at', stoppedAt)
        .gte('ended_at', started_at)
        .limit(1);
      withinBlock = !!(closedRun && closedRun.length);
    }

    const result = await logTaskTimeEntry({
      taskId,
      userId: req.userId!,
      startedAt: started_at,
      durationSeconds: duration_seconds,
      source: 'timer',
      skipDailySummary: withinBlock,
    });
    if (!result.ok) {
      res.status(result.error === 'Task not found' ? 404 : 500)
        .json({ success: false, error: result.error });
      return;
    }

    res.json({ success: true, data: result.entry });
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

    const [withAssignees] = await hydrateAssignees([task]);
    // Attach `parent_task: { id, title } | null` so the detail panel can show
    // (and link to) the parent when this task is a subtask.
    const [withParent] = await hydrateParents([withAssignees]);
    // Attach `tags: TaskTag[]` (Labels) so the detail panel renders them.
    const [hydratedTask] = await hydrateLabels([withParent]);
    const hydratedSubtasks = await hydrateAssignees(subtasks || []);

    // Spawned routine copies link back to their template so the detail
    // panel can show "Part of routine" with the rule and a jump link.
    let routineTemplate: { id: string; title: string; recurrence: unknown } | null = null;
    if ((task as any).recurring_parent_id) {
      const { data: tpl } = await supabaseAdmin
        .from('tasks')
        .select('id, title, recurrence')
        .eq('id', (task as any).recurring_parent_id)
        .maybeSingle();
      if (tpl) routineTemplate = tpl as any;
    }

    res.json({
      success: true,
      data: {
        ...hydratedTask,
        subtasks: hydratedSubtasks,
        comment_count: commentCount,
        creator,
        routine_template: routineTemplate,
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
    // Auto-assign: gather each container level's configured members so we can
    // pick the nearest non-empty going up the tree (list -> folder -> space).
    let listAutoIds: string[] = [];
    let folderAutoIds: string[] = [];
    let spaceAutoIds: string[] = [];
    const { data: parentList } = await supabaseAdmin
      .from('lists')
      .select('folder_id, space_id, auto_assignee_ids')
      .eq('id', body.list_id)
      .single();
    listAutoIds = (parentList?.auto_assignee_ids as string[] | null) || [];
    if (parentList?.folder_id) {
      const { data: parentFolder } = await supabaseAdmin
        .from('folders')
        .select('client_id, auto_assignee_ids')
        .eq('id', parentList.folder_id)
        .single();
      folderAutoIds = (parentFolder?.auto_assignee_ids as string[] | null) || [];
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
    if (parentList?.space_id) {
      const { data: parentSpace } = await supabaseAdmin
        .from('spaces')
        .select('auto_assignee_ids')
        .eq('id', parentList.space_id)
        .single();
      spaceAutoIds = (parentSpace?.auto_assignee_ids as string[] | null) || [];
    }
    // Nearest-wins down the tree, then merge with the creator's manual picks.
    const inheritedAutoIds = listAutoIds.length ? listAutoIds
      : folderAutoIds.length ? folderAutoIds
      : spaceAutoIds;
    const mergedAssigneeIds = Array.from(
      new Set([...(body.assignee_ids || []), ...inheritedAutoIds]),
    );

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
      assignee_ids: mergedAssigneeIds,
      metadata: body.metadata || {},
      created_by: req.userId!,
    };
    if (displayNumber != null) {
      insertData.display_number = displayNumber;
    }
    // A recurrence rule makes this task a routine template (hidden from
    // list views; the spawner materialises dated copies).
    if (body.recurrence) {
      insertData.recurrence = body.recurrence;
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

    // If the brand-new routine already fires today, materialise today's copy
    // immediately so the user sees it without waiting for the midnight cron.
    if (body.recurrence && taskRecurrenceOccursOn(body.recurrence as TaskRecurrence, todayIST())) {
      await spawnRoutineInstance(task, todayIST());
    }

    // Activity: the task's own "created" event, plus a "subtask_added" event on
    // the parent when this is a subtask (so the parent's feed shows it too).
    await logTaskActivity((task as any).id, req.userId!, [{ event_type: 'created' }]);
    if ((task as any).parent_task_id) {
      await logTaskActivity((task as any).parent_task_id, req.userId!, [{
        event_type: 'subtask_added',
        new_value: { id: (task as any).id, title: (task as any).title },
      }]);
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

    // Snapshot the prior row before updating so we can diff what actually moved
    // for both the estimate audit (task_estimate_changes, migration 134) and the
    // activity feed (task_activity, migration 147). One lightweight read.
    const { data: prior } = await supabaseAdmin
      .from('tasks')
      .select('time_estimate, list_id, title, description, status, priority, due_date, work_date, start_date, task_type_id, assignee_ids, recurrence, metadata')
      .eq('id', id)
      .single();
    const priorEstimate: number | null = (prior as any)?.time_estimate ?? null;
    const estimateListId: string | null = (prior as any)?.list_id ?? null;

    // Completion gate: only fires on the transition INTO a done/closed status —
    // tasks already complete can be re-saved (or moved between done states)
    // freely. Rejects with structured counts so clients can explain the bounce.
    if (body.status !== undefined) {
      const doneNames = await getSpaceDoneStatusNames(listId);
      const isDoneStatus = (st: string | null | undefined): boolean => {
        if (!st) return false;
        if (st === 'done' || st === 'closed') return true;
        const cat = getTaskStatusCategory(st);
        if (cat === 'done' || cat === 'closed') return true;
        return doneNames.has(st);
      };
      if (isDoneStatus(body.status) && !isDoneStatus((prior as any)?.status)) {
        const { open_subtasks, open_checklist_items } = await countOpenCompletionItems(id, isDoneStatus);
        if (open_subtasks > 0 || open_checklist_items > 0) {
          const parts: string[] = [];
          if (open_subtasks > 0) parts.push(`${open_subtasks} subtask${open_subtasks === 1 ? '' : 's'}`);
          if (open_checklist_items > 0) parts.push(`${open_checklist_items} checklist item${open_checklist_items === 1 ? '' : 's'}`);
          res.status(409).json({
            success: false,
            code: 'INCOMPLETE_ITEMS',
            error: `Complete ${parts.join(' and ')} before closing this task`,
            details: { open_subtasks, open_checklist_items },
          });
          return;
        }
      }
    }

    const updatePayload: Record<string, any> = { ...body, last_modified_by: req.userId! };
    if (body.recurrence !== undefined) {
      if (body.recurrence) {
        // Task becomes (or updates) a routine template. If it was itself a
        // spawned copy, detach it from its old routine first — a task is
        // either a template or an instance, never both.
        updatePayload.recurring_parent_id = null;
        updatePayload.recurrence_instance_date = null;
      } else {
        // Rule removed: back to a normal task; clear pause so a future
        // re-enable starts fresh.
        updatePayload.recurrence_paused = false;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // If the task was MOVED into a list it was also LINKED into, drop the now
    // redundant link so it isn't double-counted (primary + link) in that list.
    if (body.list_id && body.list_id !== listId) {
      await supabaseAdmin
        .from('task_list_links')
        .delete()
        .eq('task_id', id)
        .eq('list_id', body.list_id);
    }

    // Rule just set/changed and fires today → materialise today's copy now
    // (idempotent: skipped if today's instance already exists).
    if (body.recurrence && !(data as any).recurrence_paused
      && taskRecurrenceOccursOn(body.recurrence as TaskRecurrence, todayIST())) {
      await spawnRoutineInstance(data, todayIST());
    }

    // Record who changed the time estimate (only when the value actually moved).
    // Best-effort and isolated: an audit failure must never fail the task update.
    if (body.time_estimate !== undefined && (body.time_estimate ?? null) !== (priorEstimate ?? null)) {
      try {
        let workspaceId: string | null = null;
        if (estimateListId) {
          const { data: list } = await supabaseAdmin
            .from('lists').select('space_id').eq('id', estimateListId).single();
          const { data: space } = (list as any)?.space_id
            ? await supabaseAdmin.from('spaces').select('workspace_id').eq('id', (list as any).space_id).single()
            : { data: null as any };
          workspaceId = (space as any)?.workspace_id ?? null;
        }
        await supabaseAdmin.from('task_estimate_changes').insert({
          task_id: id,
          user_id: req.userId!,
          workspace_id: workspaceId,
          old_estimate: priorEstimate ?? null,
          new_estimate: body.time_estimate ?? null,
        });
      } catch (auditErr) {
        console.error('Estimate-change audit insert failed:', auditErr);
      }
    }

    // Activity feed: append one event per tracked field that actually changed.
    // Best-effort — name lookups and the insert must never fail the update.
    try {
      const events: TaskActivityEvent[] = [];
      const p: any = prior || {};

      // Scalar fields. time_estimate is audited separately (folded in at read
      // time); time_tracked is timer noise — both intentionally excluded.
      const SCALAR_FIELDS = ['title', 'description', 'status', 'priority', 'due_date', 'work_date', 'start_date'] as const;
      for (const f of SCALAR_FIELDS) {
        if ((body as any)[f] === undefined) continue;
        const oldV = p[f] ?? null;
        const newV = (body as any)[f] ?? null;
        if (oldV === newV) continue;
        events.push({ event_type: 'field_change', field: f, old_value: oldV, new_value: newV });
      }

      // Task type change → snapshot {id, name} both sides.
      if (body.task_type_id !== undefined && (body.task_type_id ?? null) !== (p.task_type_id ?? null)) {
        const ids = [p.task_type_id, body.task_type_id].filter(Boolean) as string[];
        const nameById = new Map<string, string>();
        if (ids.length) {
          const { data: types } = await supabaseAdmin.from('task_types').select('id, name').in('id', ids);
          for (const t of (types || []) as any[]) nameById.set(t.id, t.name);
        }
        events.push({
          event_type: 'field_change', field: 'task_type_id',
          old_value: p.task_type_id ? { id: p.task_type_id, name: nameById.get(p.task_type_id) ?? null } : null,
          new_value: body.task_type_id ? { id: body.task_type_id, name: nameById.get(body.task_type_id) ?? null } : null,
        });
      }

      // Moved to another list → snapshot {id, name} both sides.
      if (body.list_id && body.list_id !== estimateListId) {
        const ids = [estimateListId, body.list_id].filter(Boolean) as string[];
        const nameById = new Map<string, string>();
        if (ids.length) {
          const { data: lists } = await supabaseAdmin.from('lists').select('id, name').in('id', ids);
          for (const l of (lists || []) as any[]) nameById.set(l.id, l.name);
        }
        events.push({
          event_type: 'moved',
          old_value: estimateListId ? { id: estimateListId, name: nameById.get(estimateListId) ?? null } : null,
          new_value: { id: body.list_id, name: nameById.get(body.list_id) ?? null },
        });
      }

      // Assignees → one added/removed event per person.
      if (body.assignee_ids !== undefined) {
        const before = new Set<string>((p.assignee_ids as string[] | null) || []);
        const after = new Set<string>(body.assignee_ids || []);
        const added = [...after].filter((x) => !before.has(x));
        const removed = [...before].filter((x) => !after.has(x));
        if (added.length || removed.length) {
          const nameById = new Map<string, string>();
          const { data: users } = await supabaseAdmin
            .from('users').select('id, display_name, email').in('id', [...added, ...removed]);
          for (const u of (users || []) as any[]) nameById.set(u.id, u.display_name || u.email);
          for (const uid of added) events.push({ event_type: 'assignee_added', new_value: { id: uid, name: nameById.get(uid) ?? null } });
          for (const uid of removed) events.push({ event_type: 'assignee_removed', old_value: { id: uid, name: nameById.get(uid) ?? null } });
        }
      }

      // Recurrence rule set / changed / removed. The rule object is small, so
      // snapshot both sides; the feed reads "set the task to repeat" vs "removed
      // recurrence" from whether new_value is null.
      if (body.recurrence !== undefined) {
        const oldR = (p.recurrence ?? null) as unknown;
        const newR = (body.recurrence ?? null) as unknown;
        if (JSON.stringify(oldR) !== JSON.stringify(newR)) {
          events.push({ event_type: 'field_change', field: 'recurrence', old_value: oldR, new_value: newR });
        }
      }

      // Metadata bag changed → record that details moved. Values omitted: the bag
      // is free-form and can be large; the feed just says "updated details".
      if (body.metadata !== undefined
        && JSON.stringify(p.metadata ?? null) !== JSON.stringify(body.metadata ?? null)) {
        events.push({ event_type: 'field_change', field: 'metadata', old_value: null, new_value: null });
      }

      await logTaskActivity(id, req.userId!, events);
    } catch (activityErr) {
      console.error('Activity diff logging failed:', activityErr);
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

// Resolve space → folder → list display info for a set of lists. Used to render
// the secondary-list breadcrumbs on the task detail panel.
async function buildListPaths(
  listIds: string[],
): Promise<Map<string, Omit<TaskListPath, 'is_primary'>>> {
  const ids = Array.from(new Set(listIds.filter(Boolean)));
  const out = new Map<string, Omit<TaskListPath, 'is_primary'>>();
  if (!ids.length) return out;
  const { data: lists } = await supabaseAdmin
    .from('lists')
    .select('id, name, space_id, folder_id')
    .in('id', ids);
  const spaceIds = Array.from(new Set((lists || []).map((l: any) => l.space_id).filter(Boolean)));
  const folderIds = Array.from(new Set((lists || []).map((l: any) => l.folder_id).filter(Boolean)));
  const [{ data: spaces }, { data: folders }] = await Promise.all([
    spaceIds.length
      ? supabaseAdmin.from('spaces').select('id, name, color').in('id', spaceIds)
      : Promise.resolve({ data: [] as any[] }),
    folderIds.length
      ? supabaseAdmin.from('folders').select('id, name').in('id', folderIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const spaceById = new Map((spaces || []).map((s: any) => [s.id, s]));
  const folderById = new Map((folders || []).map((f: any) => [f.id, f]));
  for (const l of lists || []) {
    const s = (l as any).space_id ? spaceById.get((l as any).space_id) : null;
    const f = (l as any).folder_id ? folderById.get((l as any).folder_id) : null;
    out.set((l as any).id, {
      list_id: (l as any).id,
      list_name: (l as any).name,
      folder_id: f ? (f as any).id : null,
      folder_name: f ? (f as any).name : null,
      space_id: s ? (s as any).id : null,
      space_name: s ? (s as any).name : null,
      space_color: s ? (s as any).color ?? null : null,
    });
  }
  return out;
}

// GET /pm/tasks/:id/lists — every list this task belongs to, as resolved paths.
// First entry is the primary list (tasks.list_id); the rest are added links.
router.get('/tasks/:id/lists', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const primaryListId = await getTaskListId(id);
    if (!primaryListId) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    const userLevel = await checkResourceAccess(req.userId!, 'list', primaryListId);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this task' });
      return;
    }

    const { data: links } = await supabaseAdmin
      .from('task_list_links')
      .select('list_id, created_at')
      .eq('task_id', id)
      .order('created_at', { ascending: true });
    const linkIds = (links || []).map((l: any) => l.list_id).filter((lid: string) => lid !== primaryListId);

    const paths = await buildListPaths([primaryListId, ...linkIds]);
    const primary = paths.get(primaryListId);
    const result: TaskListPath[] = [];
    if (primary) result.push({ ...primary, is_primary: true });
    for (const lid of linkIds) {
      const p = paths.get(lid);
      if (p) result.push({ ...p, is_primary: false });
    }
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Get task lists error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/tasks/:id/lists — add the task to one or more additional lists.
// Body: { list_ids: string[] }. Requires member access on the task's primary
// list AND on every target list. Skips the primary list and existing links.
router.post('/tasks/:id/lists', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const parsed = z
      .object({ list_ids: z.array(z.string().uuid()).min(1) })
      .parse(req.body);

    const primaryListId = await getTaskListId(id);
    if (!primaryListId) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    const userLevel = await checkResourceAccess(req.userId!, 'list', primaryListId);
    if (!userLevel || !meetsAccessLevel(userLevel, 'member')) {
      res.status(403).json({ success: false, error: 'Member access required to add this task to lists' });
      return;
    }

    const adminUser = await isWorkspaceAdmin(req.userId!);
    const targets = Array.from(new Set(parsed.list_ids)).filter((lid) => lid !== primaryListId);

    // Drop lists the task is already linked into.
    const { data: existing } = await supabaseAdmin
      .from('task_list_links')
      .select('list_id')
      .eq('task_id', id);
    const existingIds = new Set((existing || []).map((r: any) => r.list_id));
    const toAdd = targets.filter((lid) => !existingIds.has(lid));

    const inserted: string[] = [];
    for (const lid of toAdd) {
      const { data: destList } = await supabaseAdmin
        .from('lists')
        .select('id, deleted_at')
        .eq('id', lid)
        .single();
      if (!destList || (destList as any).deleted_at) {
        res.status(400).json({ success: false, error: 'A destination list does not exist' });
        return;
      }
      const destLevel = await checkResourceAccess(req.userId!, 'list', lid);
      if (!destLevel || !meetsAccessLevel(destLevel, 'member')) {
        res.status(403).json({ success: false, error: 'Member access required on a destination list' });
        return;
      }
      if (!adminUser && await isResourceLocked('list', lid)) {
        res.status(403).json({ success: false, error: 'A destination list is locked' });
        return;
      }
      const { error: insErr } = await supabaseAdmin
        .from('task_list_links')
        .insert({ task_id: id, list_id: lid, created_by: req.userId! });
      // Ignore unique-violation races; surface anything else.
      if (insErr && (insErr as any).code !== '23505') {
        res.status(500).json({ success: false, error: insErr.message });
        return;
      }
      inserted.push(lid);
    }

    // Activity: one "added to list" event per newly-linked list, name snapshotted.
    if (inserted.length) {
      const nameById = new Map<string, string>();
      const { data: lists } = await supabaseAdmin.from('lists').select('id, name').in('id', inserted);
      for (const l of (lists || []) as any[]) nameById.set(l.id, l.name);
      await logTaskActivity(id, req.userId!, inserted.map((lid) => ({
        event_type: 'list_link_added',
        new_value: { id: lid, name: nameById.get(lid) ?? null },
      })));
    }

    res.json({ success: true, data: { added: inserted } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add task to lists error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/tasks/:id/lists/:listId — remove one added-list link. The primary
// list cannot be removed this way (use "Move to another list" instead).
router.delete('/tasks/:id/lists/:listId', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const listId = req.params.listId as string;

    const primaryListId = await getTaskListId(id);
    if (!primaryListId) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    if (listId === primaryListId) {
      res.status(400).json({ success: false, error: 'Cannot remove the task from its primary list' });
      return;
    }
    const userLevel = await checkResourceAccess(req.userId!, 'list', primaryListId);
    if (!userLevel || !meetsAccessLevel(userLevel, 'member')) {
      res.status(403).json({ success: false, error: 'Member access required to change this task' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('task_list_links')
      .delete()
      .eq('task_id', id)
      .eq('list_id', listId);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const { data: removedList } = await supabaseAdmin
      .from('lists').select('id, name').eq('id', listId).maybeSingle();
    await logTaskActivity(id, req.userId!, [{
      event_type: 'list_link_removed',
      old_value: { id: listId, name: (removedList as any)?.name ?? null },
    }]);

    res.json({ success: true });
  } catch (err) {
    console.error('Remove task from list error:', err);
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
      // Activity: manual "Logged" edit. Timer writes go through PUT /pm/tasks/:id
      // and are deliberately not logged (per-tick noise); this endpoint is the
      // role-gated manual override, so it IS worth recording.
      await logTaskActivity(id, req.userId!, [{
        event_type: 'field_change', field: 'time_tracked',
        old_value: oldTotal, new_value: time_tracked,
      }]);

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

        // Also update daily_time_summaries for the dashboard
        const IST_OFFSET = 5.5 * 60 * 60 * 1000;
        const startedIst = new Date(new Date(now).getTime() + IST_OFFSET);
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
              total_work_seconds: existingSummary.total_work_seconds + delta,
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
              total_work_seconds: delta,
              total_break_seconds: 0,
              total_no_work_seconds: 0,
              session_count: 1,
              first_start: now,
              last_stop: now,
            });
        }
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

    // Snapshot parent + title BEFORE the row is gone. A top-level task's own feed
    // cannot record its deletion (task_activity cascades on task delete), but a
    // subtask deletion can surface in the surviving PARENT's feed — the mirror of
    // the subtask_added event written on create.
    const { data: doomed } = await supabaseAdmin
      .from('tasks').select('parent_task_id, title').eq('id', id).maybeSingle();

    const { error } = await supabaseAdmin.from('tasks').delete().eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    if ((doomed as any)?.parent_task_id) {
      await logTaskActivity((doomed as any).parent_task_id, req.userId!, [{
        event_type: 'subtask_removed',
        old_value: { id, title: (doomed as any).title ?? null },
      }]);
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

// GET /pm/tasks/:id/activity — the unified change history for a task (viewer
// access). Merges three sources, newest-first:
//   1. task_activity rows (field changes, assignees, labels, move, attachments…)
//   2. task_comments (each surfaced as an event_type='comment')
//   3. task_estimate_changes (folded in as field_change/time_estimate so legacy
//      estimate history pre-dating task_activity still appears)
// Actor display names are resolved here so the client renders without extra
// lookups.
router.get('/tasks/:id/activity', async (req: Request, res: Response) => {
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

    const [activityRes, commentRes, estimateRes, taskRes] = await Promise.all([
      supabaseAdmin
        .from('task_activity')
        .select('id, user_id, event_type, field, old_value, new_value, created_at')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('task_comments')
        .select('id, user_id, created_at')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('task_estimate_changes')
        .select('id, user_id, old_estimate, new_estimate, created_at')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('tasks')
        .select('created_by, created_at')
        .eq('id', taskId)
        .maybeSingle(),
    ]);

    type FeedItem = {
      id: string;
      event_type: string;
      field: string | null;
      old_value: unknown;
      new_value: unknown;
      created_at: string;
      user_id: string | null;
    };
    const items: FeedItem[] = [];

    for (const a of (activityRes.data || []) as any[]) {
      items.push({
        id: a.id, event_type: a.event_type, field: a.field ?? null,
        old_value: a.old_value, new_value: a.new_value,
        created_at: a.created_at, user_id: a.user_id ?? null,
      });
    }
    for (const c of (commentRes.data || []) as any[]) {
      items.push({
        id: c.id, event_type: 'comment', field: null,
        old_value: null, new_value: null,
        created_at: c.created_at, user_id: c.user_id ?? null,
      });
    }
    for (const e of (estimateRes.data || []) as any[]) {
      items.push({
        id: e.id, event_type: 'field_change', field: 'time_estimate',
        old_value: e.old_estimate ?? null, new_value: e.new_estimate ?? null,
        created_at: e.created_at, user_id: e.user_id ?? null,
      });
    }

    // Resolve actor display names in one query.
    const userIds = Array.from(new Set(items.map((i) => i.user_id).filter(Boolean) as string[]));
    const userById = new Map<string, { id: string; display_name: string | null; email: string | null; avatar_url: string | null }>();
    if (userIds.length) {
      const { data: users } = await supabaseAdmin
        .from('users').select('id, display_name, email, avatar_url').in('id', userIds);
      for (const u of (users || []) as any[]) userById.set(u.id, u);
    }

    const feed = items
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
      .map((i) => ({ ...i, user: i.user_id ? userById.get(i.user_id) ?? null : null }));

    res.json({ success: true, data: feed });
  } catch (err) {
    console.error('Get activity error:', err);
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
    // Resolve the parent task before the comment row is gone, so the deletion can
    // be attributed to the right task's feed.
    const { data: comment } = await supabaseAdmin
      .from('task_comments').select('task_id').eq('id', id).maybeSingle();
    const { error } = await supabaseAdmin.from('task_comments').delete().eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    if ((comment as any)?.task_id) {
      await logTaskActivity((comment as any).task_id, req.userId!, [{ event_type: 'comment_deleted' }]);
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
    await logTaskActivity(id, req.userId!, [{ event_type: focused ? 'focus_set' : 'focus_cleared' }]);
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
    await logTaskActivity(id, req.userId!, [{
      event_type: until ? 'snooze_set' : 'snooze_cleared',
      new_value: until ?? null,
    }]);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Patch snooze error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/tasks/:id/review — mark a task reviewed for the caller, dropping it from
// their New Tasks card. Idempotent (re-ticking is a no-op).
router.post('/tasks/:id/review', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { error } = await supabaseAdmin
      .from('task_reviews')
      .upsert(
        { task_id: id, user_id: req.userId!, reviewed_at: new Date().toISOString() },
        { onConflict: 'task_id,user_id' },
      );
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    await logTaskActivity(id, req.userId!, [{ event_type: 'reviewed' }]);
    res.json({ success: true });
  } catch (err) {
    console.error('Review task error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/tasks/:id/review — un-review (restore the task to the caller's card).
router.delete('/tasks/:id/review', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { error } = await supabaseAdmin
      .from('task_reviews')
      .delete()
      .eq('task_id', id)
      .eq('user_id', req.userId!);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    await logTaskActivity(id, req.userId!, [{ event_type: 'unreviewed' }]);
    res.json({ success: true });
  } catch (err) {
    console.error('Unreview task error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
