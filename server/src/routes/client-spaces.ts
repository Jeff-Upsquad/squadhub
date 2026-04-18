import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);

// GET /client-spaces/available
// Returns enabled templates the current user can instantiate (role-based OR direct user grant).
router.get('/available', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;

    // Fetch user's role(s) in any workspace
    const { data: memberRows } = await supabaseAdmin
      .from('workspace_members')
      .select('role_id')
      .eq('user_id', userId);
    const roleIds = Array.from(
      new Set((memberRows || []).map((m: any) => m.role_id).filter(Boolean)),
    );

    const { data: all, error } = await supabaseAdmin
      .from('client_space_templates')
      .select('id, slug, name, description, icon, category, template, version, is_enabled')
      .eq('is_enabled', true)
      .order('name');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!all || all.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const ids = all.map((t) => t.id);

    let roleGrants = new Set<string>();
    if (roleIds.length > 0) {
      const { data: rga } = await supabaseAdmin
        .from('client_space_template_role_access')
        .select('template_id')
        .in('role_id', roleIds)
        .in('template_id', ids);
      (rga || []).forEach((r: any) => roleGrants.add(r.template_id));
    }

    const { data: uga } = await supabaseAdmin
      .from('client_space_template_user_access')
      .select('template_id')
      .eq('user_id', userId)
      .in('template_id', ids);
    const userGrants = new Set((uga || []).map((u: any) => u.template_id));

    const accessible = all.filter((t) => roleGrants.has(t.id) || userGrants.has(t.id));
    res.json({ success: true, data: accessible });
  } catch (err) {
    console.error('List available client-space templates error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
