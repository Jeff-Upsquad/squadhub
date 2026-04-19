import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { checkResourceAccess, meetsAccessLevel } from '../../middleware/permissions';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', 'partner', 'client', 'client_staff'));

async function getTaskListId(taskId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('tasks').select('list_id').eq('id', taskId).single();
  return data?.list_id || null;
}

async function getChecklistTaskId(checklistId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('task_checklists').select('task_id').eq('id', checklistId).single();
  return data?.task_id || null;
}

async function getItemChecklistId(itemId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('task_checklist_items').select('checklist_id').eq('id', itemId).single();
  return data?.checklist_id || null;
}

async function requireTaskAccess(userId: string, taskId: string, level: 'viewer' | 'member'): Promise<string | null> {
  const listId = await getTaskListId(taskId);
  if (!listId) return null;
  const userLevel = await checkResourceAccess(userId, 'list', listId);
  if (!userLevel) return null;
  if (level === 'member' && !meetsAccessLevel(userLevel, 'member')) return null;
  return listId;
}

// GET /pm/tasks/:taskId/checklists — with nested items
router.get('/tasks/:taskId/checklists', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.taskId;
    const listId = await requireTaskAccess(req.userId!, taskId, 'viewer');
    if (!listId) {
      res.status(403).json({ success: false, error: 'No access to this task' });
      return;
    }

    const { data: checklists, error } = await supabaseAdmin
      .from('task_checklists')
      .select('*')
      .eq('task_id', taskId)
      .order('position', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const ids = (checklists || []).map((c: any) => c.id);
    const { data: items, error: itemsErr } = ids.length
      ? await supabaseAdmin
          .from('task_checklist_items')
          .select('*')
          .in('checklist_id', ids)
          .order('position', { ascending: true })
      : { data: [] as any[], error: null };

    if (itemsErr) {
      res.status(500).json({ success: false, error: itemsErr.message });
      return;
    }

    const byChecklist = new Map<string, any[]>();
    for (const item of items || []) {
      const list = byChecklist.get(item.checklist_id) || [];
      list.push(item);
      byChecklist.set(item.checklist_id, list);
    }

    const result = (checklists || []).map((c: any) => ({ ...c, items: byChecklist.get(c.id) || [] }));
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Get checklists error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/tasks/:taskId/checklists — create checklist
const createChecklistSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

router.post('/tasks/:taskId/checklists', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.taskId;
    const body = createChecklistSchema.parse(req.body);

    const listId = await requireTaskAccess(req.userId!, taskId, 'member');
    if (!listId) {
      res.status(403).json({ success: false, error: 'Member access required' });
      return;
    }

    const { data: maxRow } = await supabaseAdmin
      .from('task_checklists')
      .select('position')
      .eq('task_id', taskId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = ((maxRow as any)?.position ?? -1) + 1;

    const { data, error } = await supabaseAdmin
      .from('task_checklists')
      .insert({
        task_id: taskId,
        title: body.title || 'Checklist',
        position: nextPos,
        created_by: req.userId!,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({ success: true, data: { ...data, items: [] } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create checklist error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /pm/checklists/:id
const updateChecklistSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  position: z.number().int().min(0).optional(),
});

router.put('/checklists/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const body = updateChecklistSchema.parse(req.body);

    const taskId = await getChecklistTaskId(id);
    if (!taskId) {
      res.status(404).json({ success: false, error: 'Checklist not found' });
      return;
    }

    const listId = await requireTaskAccess(req.userId!, taskId, 'member');
    if (!listId) {
      res.status(403).json({ success: false, error: 'Member access required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('task_checklists')
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
    console.error('Update checklist error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/checklists/:id
router.delete('/checklists/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const taskId = await getChecklistTaskId(id);
    if (!taskId) {
      res.status(404).json({ success: false, error: 'Checklist not found' });
      return;
    }

    const listId = await requireTaskAccess(req.userId!, taskId, 'member');
    if (!listId) {
      res.status(403).json({ success: false, error: 'Member access required' });
      return;
    }

    const { error } = await supabaseAdmin.from('task_checklists').delete().eq('id', id);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete checklist error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/checklists/:id/items — add an item
const createItemSchema = z.object({
  content: z.string().min(1).max(1000),
  assigned_to: z.string().uuid().nullable().optional(),
  due_date: z.string().nullable().optional(),
});

router.post('/checklists/:id/items', async (req: Request, res: Response) => {
  try {
    const checklistId = req.params.id;
    const body = createItemSchema.parse(req.body);

    const taskId = await getChecklistTaskId(checklistId);
    if (!taskId) {
      res.status(404).json({ success: false, error: 'Checklist not found' });
      return;
    }

    const listId = await requireTaskAccess(req.userId!, taskId, 'member');
    if (!listId) {
      res.status(403).json({ success: false, error: 'Member access required' });
      return;
    }

    const { data: maxRow } = await supabaseAdmin
      .from('task_checklist_items')
      .select('position')
      .eq('checklist_id', checklistId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = ((maxRow as any)?.position ?? -1) + 1;

    const { data, error } = await supabaseAdmin
      .from('task_checklist_items')
      .insert({
        checklist_id: checklistId,
        content: body.content,
        assigned_to: body.assigned_to ?? null,
        due_date: body.due_date ?? null,
        position: nextPos,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create checklist item error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /pm/checklist-items/:id
const updateItemSchema = z.object({
  content: z.string().min(1).max(1000).optional(),
  is_done: z.boolean().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  due_date: z.string().nullable().optional(),
  position: z.number().int().min(0).optional(),
});

router.put('/checklist-items/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const body = updateItemSchema.parse(req.body);

    const checklistId = await getItemChecklistId(id);
    if (!checklistId) {
      res.status(404).json({ success: false, error: 'Item not found' });
      return;
    }
    const taskId = await getChecklistTaskId(checklistId);
    if (!taskId) {
      res.status(404).json({ success: false, error: 'Checklist not found' });
      return;
    }

    const listId = await requireTaskAccess(req.userId!, taskId, 'member');
    if (!listId) {
      res.status(403).json({ success: false, error: 'Member access required' });
      return;
    }

    const patch: Record<string, any> = { ...body };
    if (body.is_done !== undefined) {
      if (body.is_done) {
        patch.completed_at = new Date().toISOString();
        patch.completed_by = req.userId!;
      } else {
        patch.completed_at = null;
        patch.completed_by = null;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('task_checklist_items')
      .update(patch)
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
    console.error('Update checklist item error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/checklist-items/:id
router.delete('/checklist-items/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const checklistId = await getItemChecklistId(id);
    if (!checklistId) {
      res.status(404).json({ success: false, error: 'Item not found' });
      return;
    }
    const taskId = await getChecklistTaskId(checklistId);
    if (!taskId) {
      res.status(404).json({ success: false, error: 'Checklist not found' });
      return;
    }

    const listId = await requireTaskAccess(req.userId!, taskId, 'member');
    if (!listId) {
      res.status(403).json({ success: false, error: 'Member access required' });
      return;
    }

    const { error } = await supabaseAdmin.from('task_checklist_items').delete().eq('id', id);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete checklist item error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
