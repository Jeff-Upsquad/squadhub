import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  list_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  status_id: z.string().uuid(),
  priority: z.enum(['urgent', 'high', 'normal', 'low', 'none']).optional(),
  due_date: z.string().optional(),
  parent_task_id: z.string().uuid().optional(),
  assignee_ids: z.array(z.string().uuid()).optional(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().nullable().optional(),
  status_id: z.string().uuid().optional(),
  priority: z.enum(['urgent', 'high', 'normal', 'low', 'none']).optional(),
  due_date: z.string().nullable().optional(),
  position: z.number().optional(),
});

// GET /pm/tasks?list_id=xxx&status_id=&priority=&assignee=&sort=
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const listId = req.query.list_id as string;
    if (!listId) {
      res.status(400).json({ success: false, error: 'list_id is required' });
      return;
    }

    let query = supabaseAdmin
      .from('tasks')
      .select('*, task_assignees(user_id, users(id, display_name, email, avatar_url))')
      .eq('list_id', listId)
      .is('parent_task_id', null); // Only top-level tasks

    // Filters
    if (req.query.status_id) query = query.eq('status_id', req.query.status_id as string);
    if (req.query.priority) query = query.eq('priority', req.query.priority as string);

    // Sort
    const sort = (req.query.sort as string) || 'position';
    if (sort === 'due_date') {
      query = query.order('due_date', { ascending: true, nullsFirst: false });
    } else if (sort === 'priority') {
      query = query.order('priority').order('position');
    } else if (sort === 'created_at') {
      query = query.order('created_at', { ascending: false });
    } else {
      query = query.order('position');
    }

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Transform assignees into flat user array
    const tasks = (data || []).map((task: any) => ({
      ...task,
      assignees: task.task_assignees?.map((ta: any) => ta.users).filter(Boolean) || [],
      task_assignees: undefined,
    }));

    res.json({ success: true, data: tasks });
  } catch (err) {
    console.error('Get tasks error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/tasks/:id — full task with subtasks, assignees, comments count
router.get('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const { data: task, error } = await supabaseAdmin
      .from('tasks')
      .select('*, task_assignees(user_id, users(id, display_name, email, avatar_url))')
      .eq('id', id)
      .single();

    if (error || !task) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }

    // Get subtasks
    const { data: subtasks } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .eq('parent_task_id', id)
      .order('position');

    // Get comment count
    const { count: commentCount } = await supabaseAdmin
      .from('task_comments')
      .select('*', { count: 'exact', head: true })
      .eq('task_id', id);

    // Get creator
    const { data: creator } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url')
      .eq('id', task.created_by)
      .single();

    res.json({
      success: true,
      data: {
        ...task,
        assignees: (task as any).task_assignees?.map((ta: any) => ta.users).filter(Boolean) || [],
        task_assignees: undefined,
        subtasks: subtasks || [],
        comment_count: commentCount || 0,
        creator,
      },
    });
  } catch (err) {
    console.error('Get task error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/tasks
router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    // Get next position
    const { count } = await supabaseAdmin
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .eq('list_id', body.list_id)
      .is('parent_task_id', body.parent_task_id || null);

    const { data: task, error } = await supabaseAdmin
      .from('tasks')
      .insert({
        list_id: body.list_id,
        parent_task_id: body.parent_task_id || null,
        title: body.title,
        description: body.description || null,
        status_id: body.status_id,
        priority: body.priority || 'none',
        due_date: body.due_date || null,
        created_by: req.userId!,
        position: count || 0,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Add assignees if provided
    if (body.assignee_ids && body.assignee_ids.length > 0) {
      await supabaseAdmin.from('task_assignees').insert(
        body.assignee_ids.map((uid) => ({ task_id: task.id, user_id: uid }))
      );
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

// PUT /pm/tasks/:id
router.put('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const body = updateSchema.parse(req.body);

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

// DELETE /pm/tasks/:id
router.delete('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
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

// POST /pm/tasks/:id/assignees
router.post('/tasks/:id/assignees', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const { user_id } = req.body;

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

// DELETE /pm/tasks/:taskId/assignees/:userId
router.delete('/tasks/:taskId/assignees/:userId', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.taskId as string;
    const userId = req.params.userId as string;

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

// GET /pm/tasks/:id/comments
router.get('/tasks/:id/comments', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;

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

// POST /pm/tasks/:id/comments
router.post('/tasks/:id/comments', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const { content } = req.body;

    if (!content?.trim()) {
      res.status(400).json({ success: false, error: 'Content is required' });
      return;
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

// DELETE /pm/task-comments/:id
router.delete('/task-comments/:id', async (req: Request, res: Response) => {
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
