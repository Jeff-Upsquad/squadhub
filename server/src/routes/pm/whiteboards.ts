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

// The whiteboard blob is owned by the whiteboard view — we store it opaquely and
// only sanity-check the top-level shape so a malformed body can't poison the
// column. nodes/edges contents are passthrough (z.any()).
const putSchema = z.object({
  data: z.object({
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
    viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
  }),
});

const EMPTY = { nodes: [], edges: [] };

// Resolve the whiteboard view row and confirm the caller can reach it. Access is
// checked against the parent list (same model as list_whiteboards). Returns the
// view (with its list_id) or null; on failure `res` has already been answered.
async function loadWhiteboardView(req: Request, res: Response, requireLevel: 'viewer' | 'member') {
  const viewId = req.params.viewId as string;

  const { data: view, error } = await supabaseAdmin
    .from('list_views')
    .select('id, list_id, view_type, is_private, owner_id')
    .eq('id', viewId)
    .maybeSingle();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return null;
  }
  if (!view || view.view_type !== 'whiteboard') {
    res.status(404).json({ success: false, error: 'Whiteboard view not found' });
    return null;
  }

  const level = await checkResourceAccess(req.userId!, 'list', view.list_id);
  if (!level || !meetsAccessLevel(level, requireLevel)) {
    res.status(403).json({ success: false, error: 'You do not have access to this whiteboard' });
    return null;
  }
  if (view.is_private && view.owner_id !== req.userId!) {
    res.status(403).json({ success: false, error: 'This view is private' });
    return null;
  }

  return view as { id: string; list_id: string };
}

// GET /pm/views/:viewId/whiteboard — viewer+ access on the parent list
router.get('/views/:viewId/whiteboard', async (req: Request, res: Response) => {
  try {
    const view = await loadWhiteboardView(req, res, 'viewer');
    if (!view) return;

    const { data, error } = await supabaseAdmin
      .from('whiteboards')
      .select('data')
      .eq('view_id', view.id)
      .maybeSingle();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data: data?.data ?? EMPTY });
  } catch (err) {
    console.error('Get whiteboard error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /pm/views/:viewId/whiteboard — member+ access on the parent list (upsert)
router.put('/views/:viewId/whiteboard', async (req: Request, res: Response) => {
  try {
    const view = await loadWhiteboardView(req, res, 'member');
    if (!view) return;

    const adminUser = await isWorkspaceAdmin(req.userId!);
    if (!adminUser && (await isResourceLocked('list', view.list_id))) {
      res.status(403).json({ success: false, error: 'This list is locked' });
      return;
    }

    const body = putSchema.parse(req.body);

    const { error } = await supabaseAdmin
      .from('whiteboards')
      .upsert(
        { view_id: view.id, data: body.data, updated_by: req.userId!, updated_at: new Date().toISOString() },
        { onConflict: 'view_id' },
      );

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update whiteboard error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
