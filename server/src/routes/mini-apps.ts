import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireWorkspace } from '../middleware/workspace';
import { supabaseAdmin } from '../supabase';
import { BLOCKED_MINI_APPS } from '../utils/accounts';

const router = Router();

router.use(requireAuth);

// GET /mini-apps/my — mini apps enabled for the ACTIVE workspace (account).
// Entitlements live in workspace_mini_apps and are managed by the Hub's super
// admin over the bridge (POST /bridge/v1/admin/accounts/:id/mini-apps).
router.get('/my', requireWorkspace, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('workspace_mini_apps')
      .select('slug, enabled, mini_apps!inner(id, slug, name, description, icon, is_enabled)')
      .eq('workspace_id', req.workspaceId!)
      .eq('enabled', true);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const apps = (data || [])
      .map((row: any) => row.mini_apps)
      .filter((a: any) => a && a.is_enabled && !BLOCKED_MINI_APPS.has(a.slug))
      .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));

    res.json({ success: true, data: apps });
  } catch (err) {
    console.error('Get my mini apps error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
