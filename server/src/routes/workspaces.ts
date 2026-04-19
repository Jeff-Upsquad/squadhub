import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';

const router = Router();

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(50),
});

// GET /workspaces — list workspaces the user belongs to
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('workspace_members')
      .select('workspace_id, role, workspaces(*)')
      .eq('user_id', req.userId!);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const workspaces = data.map((m: any) => ({
      ...m.workspaces,
      my_role: m.role,
    }));

    res.json({ success: true, data: workspaces });
  } catch (err) {
    console.error('Get workspaces error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /workspaces — disabled (all users auto-join the single SquadHub workspace)
router.post('/', requireAuth, async (_req: Request, res: Response) => {
  res.status(403).json({
    success: false,
    error: 'Workspace creation is disabled. All users are automatically added to SquadHub.',
  });
});

// PUT /workspaces/:id — update workspace settings
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const updates: Record<string, unknown> = {};
    if (req.body.name) {
      updates.name = req.body.name;
      updates.slug = req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }

    const { data, error } = await supabaseAdmin
      .from('workspaces')
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
    console.error('Update workspace error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /workspaces/:id/members — list workspace members
router.get('/:id/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const wsId = req.params.id;
    const { data, error } = await supabaseAdmin
      .from('workspace_members')
      .select('*, users(id, email, display_name, avatar_url, created_at)')
      .eq('workspace_id', wsId)
      .order('id');

    if (error) {
      console.error('[workspaces] members select error:', error);
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const members = (data || []).map((m: any) => ({
      ...m,
      user: m.users,
      users: undefined,
    }));

    res.json({ success: true, data: members });
  } catch (err) {
    console.error('Get members error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /workspaces/:id/members — invite member by email
router.post('/:id/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const wsId = req.params.id;
    const { email, role } = req.body;

    if (!email) {
      res.status(400).json({ success: false, error: 'Email is required' });
      return;
    }

    // Find user by email
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found. They need to sign up first.' });
      return;
    }

    // Check if already a member
    const { data: existing } = await supabaseAdmin
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', wsId)
      .eq('user_id', user.id)
      .single();

    if (existing) {
      res.status(409).json({ success: false, error: 'User is already a member' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('workspace_members')
      .insert({
        workspace_id: wsId,
        user_id: user.id,
        role: role || 'member',
      })
      .select('*, users(id, email, display_name, avatar_url, created_at)')
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
    console.error('Add member error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /workspaces/:id/members/:userId — update member role
router.put('/:id/members/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const wsId = req.params.id;
    const userId = req.params.userId;
    const { role } = req.body;

    if (!role || !['super_admin', 'admin', 'member', 'guest'].includes(role)) {
      res.status(400).json({ success: false, error: 'Invalid role' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('workspace_members')
      .update({ role })
      .eq('workspace_id', wsId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Update member error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /workspaces/:id/members/:userId — remove member
router.delete('/:id/members/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const wsId = req.params.id;
    const userId = req.params.userId;

    const { error } = await supabaseAdmin
      .from('workspace_members')
      .delete()
      .eq('workspace_id', wsId)
      .eq('user_id', userId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Member removed' });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
