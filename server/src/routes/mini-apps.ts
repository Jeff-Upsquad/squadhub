import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);

// GET /mini-apps/my — get mini apps the current user can access
// Access = (role-based via workspace_members.role_id) OR (direct user grant)
// Only returns enabled mini apps
router.get('/my', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;

    // Get user's role_id from workspace_members
    const { data: memberRows } = await supabaseAdmin
      .from('workspace_members')
      .select('role_id')
      .eq('user_id', userId)
      .limit(1);

    const roleId = memberRows?.[0]?.role_id || null;

    // Get all enabled mini apps
    const { data: allApps, error } = await supabaseAdmin
      .from('mini_apps')
      .select('id, slug, name, description, icon, is_enabled')
      .eq('is_enabled', true)
      .order('name');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    if (!allApps || allApps.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const appIds = allApps.map((a) => a.id);

    // Get role-based access for user's role
    let roleAccessAppIds = new Set<string>();
    if (roleId) {
      const { data: roleAccess } = await supabaseAdmin
        .from('mini_app_role_access')
        .select('mini_app_id')
        .eq('role_id', roleId)
        .in('mini_app_id', appIds);

      (roleAccess || []).forEach((ra: any) => roleAccessAppIds.add(ra.mini_app_id));
    }

    // Get direct user access
    const { data: userAccess } = await supabaseAdmin
      .from('mini_app_user_access')
      .select('mini_app_id')
      .eq('user_id', userId)
      .in('mini_app_id', appIds);

    const userAccessAppIds = new Set((userAccess || []).map((ua: any) => ua.mini_app_id));

    // Filter: user has access if role-based OR direct
    const accessible = allApps.filter(
      (app) => roleAccessAppIds.has(app.id) || userAccessAppIds.has(app.id)
    );

    res.json({ success: true, data: accessible });
  } catch (err) {
    console.error('Get my mini apps error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
