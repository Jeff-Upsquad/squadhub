import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { isWorkspaceAdmin } from '../middleware/permissions';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);

// GET /client-spaces/available
// Returns all enabled templates. Only workspace admins can instantiate them
// (sharing is admin-driven — managers then share the resulting folders with team users).
router.get('/available', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;

    const isAdmin = await isWorkspaceAdmin(userId);
    if (!isAdmin) {
      res.status(403).json({ success: false, error: 'Workspace admin access required' });
      return;
    }

    const { data: all, error } = await supabaseAdmin
      .from('client_space_templates')
      .select('id, slug, name, description, icon, category, template, version, is_enabled')
      .eq('is_enabled', true)
      .order('name');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data: all || [] });
  } catch (err) {
    console.error('List available client-space templates error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
