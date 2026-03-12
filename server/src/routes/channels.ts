import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';

const router = Router();

const createChannelSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, 'Channel name must be lowercase letters, numbers, and hyphens only'),
  description: z.string().max(250).optional(),
  is_private: z.boolean().optional().default(false),
});

// GET /channels?workspace_id=xxx — list channels in a workspace
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string;
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id query param required' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('channels')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Get channels error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /channels — create a new channel
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = createChannelSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('channels')
      .insert({
        workspace_id: body.workspace_id,
        name: body.name,
        description: body.description || null,
        is_private: body.is_private,
        created_by: req.userId,
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
    console.error('Create channel error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /channels/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('channels')
      .delete()
      .eq('id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Channel deleted' });
  } catch (err) {
    console.error('Delete channel error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
