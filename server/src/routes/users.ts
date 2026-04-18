import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';

const router = Router();

const updateProfileSchema = z.object({
  display_name: z.string().min(1).max(50).optional(),
  avatar_url: z.string().url().nullable().optional(),
});

// GET /users/me — get current user's profile
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', req.userId!)
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /users/me — update current user's profile
router.put('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = updateProfileSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(body)
      .eq('id', req.userId!)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update user error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /users/me/client-links — get current user's client assignments
router.get('/me/client-links', requireAuth, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('partner_client_assignments')
      .select('*, clients(id, business_name, contact_person, status)')
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const enriched = (data || []).map((a: any) => ({
      ...a,
      client: a.clients,
      clients: undefined,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Get client links error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /users/me/clients — clients the user has been granted access to (client_user_access)
router.get('/me/clients', requireAuth, async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('client_user_access')
      .select('id, client_id, access_level, created_at, clients:client_id(id, business_name, contact_person, status)')
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const enriched = (data || [])
      .filter((a: any) => a.clients) // filter out deleted clients
      .map((a: any) => ({
        id: a.id,
        client_id: a.client_id,
        access_level: a.access_level,
        created_at: a.created_at,
        client: a.clients,
      }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Get my clients error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /users/me/design-folders — folders from the Design Workflow profile the user can access
router.get('/me/design-folders', requireAuth, async (req: Request, res: Response) => {
  try {
    // Find the design-workflow profile id
    const { data: profile } = await supabaseAdmin
      .from('custom_profiles')
      .select('id')
      .eq('slug', 'design-workflow')
      .single();

    if (!profile) {
      res.json({ success: true, data: [] });
      return;
    }

    // Fetch all folders linked to this profile
    const { data: folders, error } = await supabaseAdmin
      .from('folders')
      .select('id, name, space_id, created_at, spaces:space_id(id, name, workspace_id)')
      .eq('profile_id', profile.id)
      .is('deleted_at', null);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Filter to folders the user has access to
    const { checkResourceAccess } = await import('../middleware/permissions');
    const accessible = [];
    for (const f of folders || []) {
      const level = await checkResourceAccess(req.userId!, 'folder', f.id);
      if (level) {
        accessible.push({
          id: f.id,
          name: f.name,
          space_id: f.space_id,
          space: (f as any).spaces,
          created_at: f.created_at,
          my_access_level: level,
        });
      }
    }

    res.json({ success: true, data: accessible });
  } catch (err) {
    console.error('Get design folders error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
