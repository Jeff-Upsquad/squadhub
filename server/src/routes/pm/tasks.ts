import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { User } from '@squadhub/shared';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { checkResourceAccess, meetsAccessLevel, requirePermission, isWorkspaceAdmin, isResourceLocked } from '../../middleware/permissions';
import { getUserRoleIds } from '../../utils/roles';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', 'partner', 'client', 'client_staff'));

const createSchema = z.object({
  list_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  status: z.string().optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low', 'none']).optional(),
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
  priority: z.enum(['urgent', 'high', 'normal', 'low', 'none']).optional(),
  due_date: z.string().nullable().optional(),
  work_date: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  task_type_id: z.string().uuid().nullable().optional(),
  time_estimate: z.number().int().min(0).nullable().optional(),
  time_tracked: z.number().int().min(0).optional(),
  assignee_ids: z.array(z.string().uuid()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
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

// Attach `list: { id, name }` and `space: { id, name }` to each task so the
// frontend can show the task's parent list/space without a second round-trip.
async function hydrateLists<T extends { list_id: string }>(
  tasks: T[],
): Promise<(T & { list: { id: string; name: string } | null; space: { id: string; name: string } | null })[]> {
  const listIds = Array.from(new Set(tasks.map(t => t.list_id).filter(Boolean)));
  if (listIds.length === 0) {
    return tasks.map(t => ({ ...t, list: null, space: null }));
  }
  const { data: lists } = await supabaseAdmin
    .from('lists')
    .select('id, name, space_id')
    .in('id', listIds);
  const spaceIds = Array.from(new Set((lists || []).map((l: any) => l.space_id).filter(Boolean)));
  const { data: spaces } = spaceIds.length
    ? await supabaseAdmin.from('spaces').select('id, name').in('id', spaceIds)
    : { data: [] as any[] };
  const listById = new Map<string, { id: string; name: string; space_id: string | null }>(
    (lists || []).map((l: any) => [l.id, l]),
  );
  const spaceById = new Map<string, { id: string; name: string }>(
    (spaces || []).map((s: any) => [s.id, s]),
  );
  return tasks.map(t => {
    const l = listById.get(t.list_id);
    const s = l?.space_id ? spaceById.get(l.space_id) : null;
    return {
      ...t,
      list: l ? { id: l.id, name: l.name } : null,
      space: s ? { id: s.id, name: s.name } : null,
    };
  });
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
      .contains('assignee_ids', [req.userId!])
      .is('parent_task_id', null);

    if (!includeDone) {
      query = query.not('status', 'in', '(done,closed)');
    }

    const { data, error } = await query.order('due_date', { ascending: true, nullsFirst: false });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const withAssignees = await hydrateAssignees(data || []);
    const tasks = await hydrateLists(withAssignees);

    // Compute day boundaries in user's timezone
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const now = new Date();
    const todayStr = fmt.format(now);
    const dayMs = 24 * 60 * 60 * 1000;
    const tomorrowStr = fmt.format(new Date(now.getTime() + dayMs));
    const upcomingCutoffStr = fmt.format(new Date(now.getTime() + 7 * dayMs));

    const buckets: Record<'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'later', any[]> = {
      overdue: [], today: [], tomorrow: [], upcoming: [], later: [],
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
      const dateStrs = [dueStr, workStr, startStr].filter(Boolean) as string[];

      const hasToday = dateStrs.includes(todayStr);
      const hasTomorrow = dateStrs.includes(tomorrowStr);

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

    res.json({ success: true, data: buckets });
  } catch (err) {
    console.error('Get my tasks error:', err);
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

    // Resolve task_type_id: use supplied value or fall back to the default type
    let resolvedTypeId: string | null = body.task_type_id ?? null;
    if (!resolvedTypeId) {
      const { data: defaultType } = await supabaseAdmin
        .from('task_types')
        .select('id')
        .eq('is_default', true)
        .maybeSingle();
      resolvedTypeId = (defaultType as any)?.id ?? null;
    }

    const insertData: Record<string, any> = {
      list_id: body.list_id,
      title: body.title,
      description: body.description || null,
      status: body.status || 'todo',
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

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update(body)
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
router.post('/tasks/:id/comments', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const { content } = req.body;

    if (!content?.trim()) {
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

export default router;
