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

// The whiteboard blob is owned by the whiteboard view — we store it opaquely
// and only sanity-check the top-level shape so a malformed body can't poison the
// column. nodes/edges contents are passthrough (z.any()).
const putSchema = z.object({
  data: z.object({
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
    viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
  }),
});

const EMPTY = { nodes: [], edges: [] };

// GET /pm/lists/:id/whiteboard — viewer+ access on the list
router.get('/lists/:id/whiteboard', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'list', id);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this list' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('list_whiteboards')
      .select('data')
      .eq('list_id', id)
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

// PUT /pm/lists/:id/whiteboard — member+ access on the list (upsert the blob)
router.put('/lists/:id/whiteboard', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'list', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'member')) {
      res.status(403).json({ success: false, error: 'Member access required to edit the whiteboard' });
      return;
    }

    const adminUser = await isWorkspaceAdmin(req.userId!);
    if (!adminUser && await isResourceLocked('list', id)) {
      res.status(403).json({ success: false, error: 'This list is locked' });
      return;
    }

    const body = putSchema.parse(req.body);

    const { error } = await supabaseAdmin
      .from('list_whiteboards')
      .upsert(
        { list_id: id, data: body.data, updated_by: req.userId!, updated_at: new Date().toISOString() },
        { onConflict: 'list_id' },
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
