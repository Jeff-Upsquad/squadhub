import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);

// GET /pm/custom-profiles/available?target_type=folder|list
// Returns enabled profiles the current user can access (via role or direct user grant)
router.get('/available', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const targetType = req.query.target_type as string;

    if (targetType && targetType !== 'folder' && targetType !== 'list') {
      res.status(400).json({ success: false, error: 'target_type must be "folder" or "list"' });
      return;
    }

    // Get user's role_id from workspace_members
    const { data: memberRows } = await supabaseAdmin
      .from('workspace_members')
      .select('role_id')
      .eq('user_id', userId)
      .limit(1);

    const roleId = memberRows?.[0]?.role_id || null;

    // Get all enabled profiles
    let query = supabaseAdmin
      .from('custom_profiles')
      .select('id, slug, name, description, icon, category, target_type, template, version, is_enabled')
      .eq('is_enabled', true)
      .order('name');

    if (targetType) {
      query = query.eq('target_type', targetType);
    }

    const { data: allProfiles, error } = await query;

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    if (!allProfiles || allProfiles.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const profileIds = allProfiles.map((p) => p.id);

    // Get role-based access
    let roleAccessProfileIds = new Set<string>();
    if (roleId) {
      const { data: roleAccess } = await supabaseAdmin
        .from('custom_profile_role_access')
        .select('profile_id')
        .eq('role_id', roleId)
        .in('profile_id', profileIds);

      (roleAccess || []).forEach((ra: any) => roleAccessProfileIds.add(ra.profile_id));
    }

    // Get direct user access
    const { data: userAccess } = await supabaseAdmin
      .from('custom_profile_user_access')
      .select('profile_id')
      .eq('user_id', userId)
      .in('profile_id', profileIds);

    const userAccessProfileIds = new Set((userAccess || []).map((ua: any) => ua.profile_id));

    // Filter: user has access if role-based OR direct
    const accessible = allProfiles.filter(
      (p) => roleAccessProfileIds.has(p.id) || userAccessProfileIds.has(p.id)
    );

    res.json({ success: true, data: accessible });
  } catch (err) {
    console.error('Get available custom profiles error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
