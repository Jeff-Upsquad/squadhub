import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requirePermission, isWorkspaceAdmin, checkResourceAccess, meetsAccessLevel } from '../middleware/permissions';
import { supabaseAdmin } from '../supabase';

const router = Router();

const createChannelSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, 'Channel name must be lowercase letters, numbers, and hyphens only'),
  description: z.string().max(250).optional(),
  is_private: z.boolean().optional().default(true),
});

// GET /channels?workspace_id=xxx — list channels the user has access to
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string;
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id query param required' });
      return;
    }

    // Admins see all channels
    const admin = await isWorkspaceAdmin(req.userId!);
    if (admin) {
      const { data, error } = await supabaseAdmin
        .from('channels')
        .select('*')
        .eq('workspace_id', workspaceId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      res.json({ success: true, data });
      return;
    }

    // Non-admins: only channels they have membership for, or they created
    const { data: memberships } = await supabaseAdmin
      .from('resource_memberships')
      .select('resource_id')
      .eq('resource_type', 'channel')
      .eq('user_id', req.userId!);

    const memberChannelIds = (memberships || []).map((m: any) => m.resource_id);

    // Also include channels the user created
    const { data: createdChannels } = await supabaseAdmin
      .from('channels')
      .select('id')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .eq('created_by', req.userId!);

    const createdIds = (createdChannels || []).map((c: any) => c.id);
    const allIds = [...new Set([...memberChannelIds, ...createdIds])];

    if (allIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('channels')
      .select('*')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .in('id', allIds)
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

// POST /channels — create a new channel (requires can_create_channels permission)
router.post('/', requireAuth, requirePermission('can_create_channels'), async (req: Request, res: Response) => {
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

// PUT /channels/:id — update channel settings (requires manager access)
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userLevel = await checkResourceAccess(req.userId!, 'channel', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      res.status(403).json({ success: false, error: 'Manager access required to update channels' });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('channels')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Update channel error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /channels/:id — soft-delete, requires manager access
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const userLevel = await checkResourceAccess(req.userId!, 'channel', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      res.status(403).json({ success: false, error: 'Manager access required to delete channels' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('channels')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Channel moved to trash' });
  } catch (err) {
    console.error('Delete channel error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
