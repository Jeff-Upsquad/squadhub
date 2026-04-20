import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { checkResourceAccess, meetsAccessLevel, requirePermission, isWorkspaceAdmin, isResourceLocked } from '../../middleware/permissions';

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
  metadata: z.record(z.string(), z.any()).optional(),
});

// Helper to get list_id from a task
async function getTaskListId(taskId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('tasks').select('list_id').eq('id', taskId).single();
  return data?.list_id || null;
}

// GET /pm/task-types — list all task types with their custom fields (authenticated users)
router.get('/task-types', async (_req: Request, res: Response) => {
  try {
    const { data: types, error: typesErr } = await supabaseAdmin
      .from('task_types')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });

    if (typesErr) {
      res.status(500).json({ success: false, error: typesErr.message });
      return;
    }

    const { data: fields, error: fieldsErr } = await supabaseAdmin
      .from('task_type_fields')
      .select('*')
      .order('position', { ascending: true });

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

    const result = (types || []).map((t: any) => ({ ...t, fields: byType.get(t.id) || [] }));
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

    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('Get tasks error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/tasks/my — returns the logged-in user's assigned tasks
// bucketed by due-date in the requested timezone.
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

    const tasks = data || [];

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

    for (const t of tasks) {
      if (!t.due_date) { buckets.later.push(t); continue; }
      const dueStr = fmt.format(new Date(t.due_date));
      if (dueStr < todayStr) buckets.overdue.push(t);
      else if (dueStr === todayStr) buckets.today.push(t);
      else if (dueStr === tomorrowStr) buckets.tomorrow.push(t);
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

    res.json({
      success: true,
      data: {
        ...task,
        subtasks: subtasks || [],
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

    res.status(201).json({ success: true, data: task });
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

    res.json({ success: true, data });
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

// POST /pm/tasks/:id/assignees — requires member access
router.post('/tasks/:id/assignees', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const { user_id } = req.body;

    const listId = await getTaskListId(taskId);
    if (!listId) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    const userLevel = await checkResourceAccess(req.userId!, 'list', listId);
    if (!userLevel || !meetsAccessLevel(userLevel, 'member')) {
      res.status(403).json({ success: false, error: 'Member access required to assign users' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('task_assignees')
      .insert({ task_id: taskId, user_id });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Assign user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/tasks/:taskId/assignees/:userId — requires member access
router.delete('/tasks/:taskId/assignees/:userId', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.taskId as string;
    const userId = req.params.userId as string;

    const listId = await getTaskListId(taskId);
    if (!listId) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    const userLevel = await checkResourceAccess(req.userId!, 'list', listId);
    if (!userLevel || !meetsAccessLevel(userLevel, 'member')) {
      res.status(403).json({ success: false, error: 'Member access required to unassign users' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('task_assignees')
      .delete()
      .eq('task_id', taskId)
      .eq('user_id', userId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Unassign user error:', err);
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
