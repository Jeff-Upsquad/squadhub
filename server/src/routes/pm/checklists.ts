import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { checkResourceAccess, meetsAccessLevel } from '../../middleware/permissions';
import { logTaskActivity } from '../../utils/taskActivity';
import { PARTNER_USER_TYPES } from '@squadhub/shared';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

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
    const taskId = req.params.taskId as string;
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
    const taskId = req.params.taskId as string;
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

    // Activity: checklist creation surfaces in the task's Activity feed.
    await logTaskActivity(taskId, req.userId!, [{
      event_type: 'checklist_added',
      new_value: { id: (data as any).id, title: (data as any).title ?? null },
    }]);

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
    const id = req.params.id as string;
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

    // Snapshot the prior title so a rename can be logged with both sides.
    const { data: prior } = await supabaseAdmin
      .from('task_checklists').select('title').eq('id', id).maybeSingle();

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

    // Activity: title renames only — pure position moves are drag-reorder noise.
    if (body.title !== undefined && body.title !== (prior as any)?.title) {
      await logTaskActivity(taskId, req.userId!, [{
        event_type: 'checklist_renamed',
        old_value: { id, title: (prior as any)?.title ?? null },
        new_value: { id, title: (data as any).title ?? null },
      }]);
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
    const id = req.params.id as string;
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

    // Snapshot the title before the row is gone so the feed can name it.
    const { data: doomed } = await supabaseAdmin
      .from('task_checklists').select('title').eq('id', id).maybeSingle();

    const { error } = await supabaseAdmin.from('task_checklists').delete().eq('id', id);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    await logTaskActivity(taskId, req.userId!, [{
      event_type: 'checklist_removed',
      old_value: { id, title: (doomed as any)?.title ?? null },
    }]);
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
    const checklistId = req.params.id as string;
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

    // Activity: item creation surfaces in the task's Activity feed.
    const { data: parentChecklist } = await supabaseAdmin
      .from('task_checklists').select('title').eq('id', checklistId).maybeSingle();
    await logTaskActivity(taskId, req.userId!, [{
      event_type: 'checklist_item_added',
      new_value: {
        id: (data as any).id,
        content: (data as any).content ?? null,
        checklist: (parentChecklist as any)?.title ?? null,
      },
    }]);

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
    const id = req.params.id as string;
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

    // Snapshot the prior row so each kind of change gets its own feed event.
    const { data: priorItem } = await supabaseAdmin
      .from('task_checklist_items')
      .select('content, is_done, assigned_to, due_date')
      .eq('id', id)
      .maybeSingle();

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

    // Activity: one event per kind of change (a single write can both rename
    // and check an item). Pure position moves are drag-reorder noise — skipped.
    const p: any = priorItem || {};
    const itemEvents: { event_type: string; old_value?: unknown; new_value?: unknown }[] = [];
    const snap = { id, content: (data as any).content ?? null };
    if (body.is_done !== undefined && !!body.is_done !== !!p.is_done) {
      itemEvents.push(body.is_done
        ? { event_type: 'checklist_item_completed', new_value: snap }
        : { event_type: 'checklist_item_reopened', new_value: snap });
    }
    if (body.content !== undefined && body.content !== p.content) {
      itemEvents.push({
        event_type: 'checklist_item_renamed',
        old_value: { id, content: p.content ?? null },
        new_value: snap,
      });
    }
    if ((body.assigned_to !== undefined && (body.assigned_to ?? null) !== (p.assigned_to ?? null))
      || (body.due_date !== undefined && (body.due_date ?? null) !== (p.due_date ?? null))) {
      itemEvents.push({ event_type: 'checklist_item_updated', new_value: snap });
    }
    if (itemEvents.length) await logTaskActivity(taskId, req.userId!, itemEvents);

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
    const id = req.params.id as string;
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

    // Snapshot the content before the row is gone so the feed can name it.
    const { data: doomed } = await supabaseAdmin
      .from('task_checklist_items').select('content').eq('id', id).maybeSingle();

    const { error } = await supabaseAdmin.from('task_checklist_items').delete().eq('id', id);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    await logTaskActivity(taskId, req.userId!, [{
      event_type: 'checklist_item_removed',
      old_value: { id, content: (doomed as any)?.content ?? null },
    }]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete checklist item error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
