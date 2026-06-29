import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { TaskTag, LabelPickerData, LabelPickerGroup } from '@squadhub/shared';
import { PARTNER_USER_TYPES } from '@squadhub/shared';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { checkResourceAccess, meetsAccessLevel } from '../../middleware/permissions';
import { logTaskActivity } from '../../utils/taskActivity';
import {
  getWorkspaceIdForTask,
  visibleGroupIds,
  canCreateLabels,
  isPlatformAdmin,
  getDefaultGroupId,
} from '../../utils/labels';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

const LABEL_COLUMNS = 'id, workspace_id, group_id, name, color';

// Resolve the list_id for a task (for access checks).
async function taskListId(taskId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('tasks')
    .select('list_id')
    .eq('id', taskId)
    .maybeSingle();
  return (data as any)?.list_id ?? null;
}

// GET /pm/labels?task_id=xxx — visible groups + their labels + can_create.
// task_id anchors the workspace (and gates on the viewer's access to the task).
router.get('/labels', async (req: Request, res: Response) => {
  try {
    const taskId = req.query.task_id as string;
    if (!taskId) {
      res.status(400).json({ success: false, error: 'task_id is required' });
      return;
    }
    const listId = await taskListId(taskId);
    if (!listId) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    const level = await checkResourceAccess(req.userId!, 'list', listId);
    if (!level) {
      res.status(403).json({ success: false, error: 'You do not have access to this task' });
      return;
    }
    const workspaceId = await getWorkspaceIdForTask(taskId);
    if (!workspaceId) {
      res.status(500).json({ success: false, error: 'Cannot resolve workspace for task' });
      return;
    }

    const isAdmin = await isPlatformAdmin(req.userId!);
    const visIds = await visibleGroupIds(req.userId!, workspaceId, { isAdmin });

    if (visIds.length === 0) {
      const empty: LabelPickerData = { groups: [], can_create: false };
      res.json({ success: true, data: empty });
      return;
    }

    const [{ data: groups }, { data: labels }] = await Promise.all([
      supabaseAdmin
        .from('label_groups')
        .select('id, name, is_default, position')
        .eq('workspace_id', workspaceId)
        .in('id', visIds)
        .order('is_default', { ascending: false })
        .order('position', { ascending: true })
        .order('name', { ascending: true }),
      supabaseAdmin
        .from('task_tags')
        .select(LABEL_COLUMNS)
        .in('group_id', visIds)
        .order('name', { ascending: true }),
    ]);

    const labelsByGroup = new Map<string, TaskTag[]>();
    for (const l of labels || []) {
      const arr = labelsByGroup.get((l as any).group_id) || [];
      arr.push(l as TaskTag);
      labelsByGroup.set((l as any).group_id, arr);
    }

    const pickerGroups: LabelPickerGroup[] = (groups || []).map((g: any) => ({
      group: { id: g.id, name: g.name, is_default: g.is_default },
      labels: labelsByGroup.get(g.id) || [],
    }));

    const can_create = await canCreateLabels(req.userId!, workspaceId, { isAdmin });
    const data: LabelPickerData = { groups: pickerGroups, can_create };
    res.json({ success: true, data });
  } catch (err) {
    console.error('Get labels error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/labels — inline-create a label (gated by can_create).
// Non-admins always create into the default "General" group; admins may target
// any group in the task's workspace.
const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  task_id: z.string().uuid(),
  group_id: z.string().uuid().optional(),
  color: z.string().max(20).optional(),
});

router.post('/labels', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    const listId = await taskListId(body.task_id);
    if (!listId) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    const level = await checkResourceAccess(req.userId!, 'list', listId);
    if (!level) {
      res.status(403).json({ success: false, error: 'You do not have access to this task' });
      return;
    }
    const workspaceId = await getWorkspaceIdForTask(body.task_id);
    if (!workspaceId) {
      res.status(500).json({ success: false, error: 'Cannot resolve workspace for task' });
      return;
    }

    const isAdmin = await isPlatformAdmin(req.userId!);
    if (!(await canCreateLabels(req.userId!, workspaceId, { isAdmin }))) {
      res.status(403).json({ success: false, error: 'You do not have permission to create labels' });
      return;
    }

    const generalId = await getDefaultGroupId(workspaceId);
    let groupId = generalId;
    if (isAdmin && body.group_id) {
      const { data: g } = await supabaseAdmin
        .from('label_groups')
        .select('id')
        .eq('id', body.group_id)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      if (!g) {
        res.status(400).json({ success: false, error: 'Group not found in workspace' });
        return;
      }
      groupId = body.group_id;
    }
    if (!groupId) {
      res.status(500).json({ success: false, error: 'No default group for workspace' });
      return;
    }

    const insert: Record<string, unknown> = {
      workspace_id: workspaceId,
      group_id: groupId,
      name: body.name,
    };
    if (body.color) insert.color = body.color;

    const { data: label, error } = await supabaseAdmin
      .from('task_tags')
      .insert(insert)
      .select(LABEL_COLUMNS)
      .single();

    if (error) {
      // Duplicate (case-insensitive uniq per workspace) → return the existing
      // label so inline-create is idempotent.
      if (error.code === '23505') {
        const { data: existing } = await supabaseAdmin
          .from('task_tags')
          .select(LABEL_COLUMNS)
          .eq('workspace_id', workspaceId)
          .ilike('name', body.name)
          .maybeSingle();
        if (existing) {
          res.json({ success: true, data: existing });
          return;
        }
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data: label });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create label error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/tasks/:id/labels — attach a label to a task (member access).
const attachSchema = z.object({ tag_id: z.string().uuid() });

router.post('/tasks/:id/labels', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const body = attachSchema.parse(req.body);

    const listId = await taskListId(taskId);
    if (!listId) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    const level = await checkResourceAccess(req.userId!, 'list', listId);
    if (!level || !meetsAccessLevel(level, 'member')) {
      res.status(403).json({ success: false, error: 'You do not have access to this task' });
      return;
    }

    // Ensure the label exists and belongs to the task's workspace.
    const workspaceId = await getWorkspaceIdForTask(taskId);
    const { data: label } = await supabaseAdmin
      .from('task_tags')
      .select(LABEL_COLUMNS)
      .eq('id', body.tag_id)
      .maybeSingle();
    if (!label || (label as any).workspace_id !== workspaceId) {
      res.status(400).json({ success: false, error: 'Label not found in this workspace' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('task_tag_assignments')
      .insert({ task_id: taskId, tag_id: body.tag_id });
    if (error && error.code !== '23505') {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Activity: only log a real attach (code 23505 = already attached, no-op).
    if (!error) {
      await logTaskActivity(taskId, req.userId!, [{
        event_type: 'label_added',
        new_value: { id: body.tag_id, name: (label as any).name },
      }]);
    }

    res.json({ success: true, data: label });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Attach label error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/tasks/:id/labels/:tagId — detach a label (member access).
router.delete('/tasks/:id/labels/:tagId', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const listId = await taskListId(taskId);
    if (!listId) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    const level = await checkResourceAccess(req.userId!, 'list', listId);
    if (!level || !meetsAccessLevel(level, 'member')) {
      res.status(403).json({ success: false, error: 'You do not have access to this task' });
      return;
    }

    // Snapshot the label name before detaching so the activity feed can show it.
    const { data: removedLabel } = await supabaseAdmin
      .from('task_tags').select('id, name').eq('id', req.params.tagId).maybeSingle();

    const { error } = await supabaseAdmin
      .from('task_tag_assignments')
      .delete()
      .eq('task_id', taskId)
      .eq('tag_id', req.params.tagId);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    await logTaskActivity(taskId, req.userId!, [{
      event_type: 'label_removed',
      old_value: { id: req.params.tagId, name: (removedLabel as any)?.name ?? null },
    }]);

    res.json({ success: true, message: 'Label removed' });
  } catch (err) {
    console.error('Detach label error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/label-requests — request a label admins haven't created yet.
const requestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  task_id: z.string().uuid(),
  suggested_group_id: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
});

router.post('/label-requests', async (req: Request, res: Response) => {
  try {
    const body = requestSchema.parse(req.body);

    const listId = await taskListId(body.task_id);
    if (!listId) {
      res.status(404).json({ success: false, error: 'Task not found' });
      return;
    }
    const level = await checkResourceAccess(req.userId!, 'list', listId);
    if (!level) {
      res.status(403).json({ success: false, error: 'You do not have access to this task' });
      return;
    }
    const workspaceId = await getWorkspaceIdForTask(body.task_id);
    if (!workspaceId) {
      res.status(500).json({ success: false, error: 'Cannot resolve workspace for task' });
      return;
    }

    const { data: request, error } = await supabaseAdmin
      .from('label_requests')
      .insert({
        workspace_id: workspaceId,
        requested_by: req.userId!,
        name: body.name,
        suggested_group_id: body.suggested_group_id ?? null,
        note: body.note ?? null,
      })
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: request });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create label request error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
