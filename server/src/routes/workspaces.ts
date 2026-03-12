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

// POST /workspaces — create a new workspace
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = createWorkspaceSchema.parse(req.body);
    const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    // Create workspace
    const { data: workspace, error: wsError } = await supabaseAdmin
      .from('workspaces')
      .insert({ name: body.name, slug, owner_id: req.userId })
      .select()
      .single();

    if (wsError) {
      res.status(500).json({ success: false, error: wsError.message });
      return;
    }

    // Add creator as super_admin member
    await supabaseAdmin.from('workspace_members').insert({
      workspace_id: workspace.id,
      user_id: req.userId,
      role: 'super_admin',
    });

    // Create a default #general channel
    await supabaseAdmin.from('channels').insert({
      workspace_id: workspace.id,
      name: 'general',
      description: 'General discussion',
      is_private: false,
      created_by: req.userId,
    });

    res.status(201).json({ success: true, data: { ...workspace, my_role: 'super_admin' } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create workspace error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
