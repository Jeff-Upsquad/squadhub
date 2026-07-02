import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { checkResourceAccess, meetsAccessLevel, isWorkspaceAdmin, isResourceLocked } from '../../middleware/permissions';
import { PARTNER_USER_TYPES } from '@squadhub/shared';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

const configSchema = z
  .object({
    filters: z.record(z.any()).optional(),
    groupBy: z.string().optional(),
    sortBy: z.string().optional(),
  })
  .default({});

const createSchema = z.object({
  view_type: z.enum(['list', 'board', 'whiteboard']),
  name: z.string().trim().min(1).max(120),
  is_private: z.boolean().optional().default(false),
  config: configSchema.optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    is_private: z.boolean().optional(),
    is_default: z.boolean().optional(),
    position: z.number().int().min(0).optional(),
    config: configSchema.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' });

// Resolve a view row + confirm the caller can see it (viewer+ on the parent
// list, and — for private views — that the caller owns it). Returns the row or
// null; on failure `res` has already been answered.
async function loadView(req: Request, res: Response, requireLevel: 'viewer' | 'member') {
  const viewId = req.params.viewId as string;

  const { data: view, error } = await supabaseAdmin
    .from('list_views')
    .select('*')
    .eq('id', viewId)
    .maybeSingle();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return null;
  }
  if (!view) {
    res.status(404).json({ success: false, error: 'View not found' });
    return null;
  }

  const level = await checkResourceAccess(req.userId!, 'list', view.list_id);
  if (!level || !meetsAccessLevel(level, requireLevel)) {
    res.status(403).json({ success: false, error: 'You do not have access to this view' });
    return null;
  }

  // Private views are only visible/editable by their owner.
  if (view.is_private && view.owner_id !== req.userId!) {
    res.status(403).json({ success: false, error: 'This view is private' });
    return null;
  }

  return view as {
    id: string;
    list_id: string;
    view_type: 'list' | 'board' | 'whiteboard';
    is_default: boolean;
    is_private: boolean;
    owner_id: string | null;
  };
}

// GET /pm/lists/:id/views — shared views + caller's own private views.
router.get('/lists/:id/views', async (req: Request, res: Response) => {
  try {
    const listId = req.params.id as string;

    const level = await checkResourceAccess(req.userId!, 'list', listId);
    if (!level) {
      res.status(403).json({ success: false, error: 'You do not have access to this list' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('list_views')
      .select('*')
      .eq('list_id', listId)
      .or(`is_private.eq.false,owner_id.eq.${req.userId!}`)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data: data ?? [] });
  } catch (err) {
    console.error('List views error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/lists/:id/views — create a view (member+ on the list).
router.post('/lists/:id/views', async (req: Request, res: Response) => {
  try {
    const listId = req.params.id as string;

    const level = await checkResourceAccess(req.userId!, 'list', listId);
    if (!level || !meetsAccessLevel(level, 'member')) {
      res.status(403).json({ success: false, error: 'Member access required to create a view' });
      return;
    }

    const adminUser = await isWorkspaceAdmin(req.userId!);
    if (!adminUser && (await isResourceLocked('list', listId))) {
      res.status(403).json({ success: false, error: 'This list is locked' });
      return;
    }

    const body = createSchema.parse(req.body);

    const { data: last } = await supabaseAdmin
      .from('list_views')
      .select('position')
      .eq('list_id', listId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const position = (last?.position ?? -1) + 1;

    const { data, error } = await supabaseAdmin
      .from('list_views')
      .insert({
        list_id: listId,
        view_type: body.view_type,
        name: body.name,
        is_private: body.is_private,
        owner_id: req.userId!,
        created_by: req.userId!,
        config: body.config ?? {},
        position,
        is_default: false,
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
    console.error('Create view error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /pm/views/:viewId — update name/config/privacy/default/position.
router.put('/views/:viewId', async (req: Request, res: Response) => {
  try {
    const view = await loadView(req, res, 'member');
    if (!view) return;

    const adminUser = await isWorkspaceAdmin(req.userId!);
    if (!adminUser && (await isResourceLocked('list', view.list_id))) {
      res.status(403).json({ success: false, error: 'This list is locked' });
      return;
    }

    const body = updateSchema.parse(req.body);

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.is_private !== undefined) updates.is_private = body.is_private;
    if (body.position !== undefined) updates.position = body.position;
    if (body.config !== undefined) updates.config = body.config;

    // Promoting to default clears the flag on sibling views first.
    if (body.is_default === true) {
      await supabaseAdmin
        .from('list_views')
        .update({ is_default: false })
        .eq('list_id', view.list_id);
      updates.is_default = true;
    }

    const { data, error } = await supabaseAdmin
      .from('list_views')
      .update(updates)
      .eq('id', view.id)
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
    console.error('Update view error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/views/:viewId — never delete the list's last view; promote a new
// default if the deleted one was default. The whiteboards row (if any) cascades.
router.delete('/views/:viewId', async (req: Request, res: Response) => {
  try {
    const view = await loadView(req, res, 'member');
    if (!view) return;

    const adminUser = await isWorkspaceAdmin(req.userId!);
    if (!adminUser && (await isResourceLocked('list', view.list_id))) {
      res.status(403).json({ success: false, error: 'This list is locked' });
      return;
    }

    const { count } = await supabaseAdmin
      .from('list_views')
      .select('*', { count: 'exact', head: true })
      .eq('list_id', view.list_id);

    if ((count ?? 0) <= 1) {
      res.status(400).json({ success: false, error: 'A list must keep at least one view' });
      return;
    }

    const { error } = await supabaseAdmin.from('list_views').delete().eq('id', view.id);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // If we removed the default, promote the first remaining view.
    if (view.is_default) {
      const { data: next } = await supabaseAdmin
        .from('list_views')
        .select('id')
        .eq('list_id', view.list_id)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (next?.id) {
        await supabaseAdmin.from('list_views').update({ is_default: true }).eq('id', next.id);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete view error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
