import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

// Helper: enrich profile with role/user access and instance counts
async function enrichProfile(profile: any) {
  // Get role access with role details
  const { data: roleAccess } = await supabaseAdmin
    .from('custom_profile_role_access')
    .select('id, profile_id, role_id, created_at')
    .eq('profile_id', profile.id);

  const roleIds = (roleAccess || []).map((ra: any) => ra.role_id);
  let rolesMap: Record<string, any> = {};
  if (roleIds.length > 0) {
    const { data: roles } = await supabaseAdmin
      .from('roles')
      .select('id, name, color')
      .in('id', roleIds);
    (roles || []).forEach((r: any) => { rolesMap[r.id] = r; });
  }

  // Get user access with user details
  const { data: userAccess } = await supabaseAdmin
    .from('custom_profile_user_access')
    .select('id, profile_id, user_id, created_at')
    .eq('profile_id', profile.id);

  const userIds = (userAccess || []).map((ua: any) => ua.user_id);
  let usersMap: Record<string, any> = {};
  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email')
      .in('id', userIds);
    (users || []).forEach((u: any) => { usersMap[u.id] = u; });
  }

  // Get instance counts
  const table = profile.target_type === 'folder' ? 'folders' : 'lists';
  const { count: instanceCount } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('profile_id', profile.id)
    .is('deleted_at', null);

  const { count: outdatedCount } = await supabaseAdmin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('profile_id', profile.id)
    .is('deleted_at', null)
    .lt('profile_version', profile.version);

  return {
    ...profile,
    role_access: (roleAccess || []).map((ra: any) => ({
      ...ra,
      role: rolesMap[ra.role_id] || null,
    })),
    user_access: (userAccess || []).map((ua: any) => ({
      ...ua,
      user: usersMap[ua.user_id] || null,
    })),
    instance_count: instanceCount || 0,
    outdated_instance_count: outdatedCount || 0,
  };
}

// ============================================================
// Custom Profile CRUD
// ============================================================

// GET /admin/custom-profiles — list all profiles
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('custom_profiles')
      .select('*')
      .order('name');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const enriched = await Promise.all((data || []).map(enrichProfile));
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('List custom profiles error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /admin/custom-profiles/:id — get single profile
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('custom_profiles')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) {
      res.status(404).json({ success: false, error: 'Custom profile not found' });
      return;
    }

    const enriched = await enrichProfile(data);
    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Get custom profile error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/custom-profiles — create profile
const createSchema = z.object({
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
  category: z.string().max(50).optional(),
  target_type: z.enum(['folder', 'list']),
  template: z.record(z.unknown()).optional(),
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('custom_profiles')
      .insert({
        slug: body.slug,
        name: body.name,
        description: body.description || '',
        icon: body.icon || 'folder',
        category: body.category || 'general',
        target_type: body.target_type,
        template: body.template || {},
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'A profile with this slug already exists' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create custom profile error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/custom-profiles/:id — update profile
const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
  category: z.string().max(50).optional(),
  is_enabled: z.boolean().optional(),
  template: z.record(z.unknown()).optional(),
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const body = updateSchema.parse(req.body);

    // If template is being updated, increment version
    const updates: Record<string, unknown> = { ...body, updated_at: new Date().toISOString() };
    if (body.template) {
      // Fetch current version to increment
      const { data: current } = await supabaseAdmin
        .from('custom_profiles')
        .select('version')
        .eq('id', req.params.id)
        .single();

      if (current) {
        updates.version = current.version + 1;
      }
    }

    const { data, error } = await supabaseAdmin
      .from('custom_profiles')
      .update(updates)
      .eq('id', req.params.id)
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
    console.error('Update custom profile error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/custom-profiles/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('custom_profiles')
      .delete()
      .eq('id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Custom profile deleted' });
  } catch (err) {
    console.error('Delete custom profile error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Propagation
// ============================================================

// POST /admin/custom-profiles/:id/propagate
router.post('/:id/propagate', async (req: Request, res: Response) => {
  try {
    // Fetch the profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('custom_profiles')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (profileError || !profile) {
      res.status(404).json({ success: false, error: 'Custom profile not found' });
      return;
    }

    const template = profile.template as any;
    let updatedCount = 0;

    if (profile.target_type === 'folder') {
      // Find outdated folders
      const { data: folders } = await supabaseAdmin
        .from('folders')
        .select('id, space_id')
        .eq('profile_id', profile.id)
        .is('deleted_at', null)
        .lt('profile_version', profile.version);

      if (folders && folders.length > 0) {
        for (const folder of folders) {
          // Get existing lists in this folder
          const { data: existingLists } = await supabaseAdmin
            .from('lists')
            .select('name')
            .eq('folder_id', folder.id)
            .is('deleted_at', null);

          const existingNames = new Set((existingLists || []).map((l: any) => l.name));

          // Add missing lists from template
          const templateLists = template.lists || [];
          for (const tl of templateLists) {
            if (!existingNames.has(tl.name)) {
              await supabaseAdmin.from('lists').insert({
                space_id: folder.space_id,
                folder_id: folder.id,
                name: tl.name,
                position: tl.position || 0,
                default_view: tl.default_view || 'list',
                is_private: true,
                created_by: req.userId!,
                profile_id: profile.id,
                profile_version: profile.version,
              });
            }
          }

          // Update folder profile_version
          await supabaseAdmin
            .from('folders')
            .update({ profile_version: profile.version })
            .eq('id', folder.id);

          updatedCount++;
        }
      }
    } else {
      // List profiles: update template-driven fields
      const { data: lists } = await supabaseAdmin
        .from('lists')
        .select('id')
        .eq('profile_id', profile.id)
        .is('deleted_at', null)
        .lt('profile_version', profile.version);

      if (lists && lists.length > 0) {
        const listIds = lists.map((l: any) => l.id);
        const updates: Record<string, unknown> = { profile_version: profile.version };
        if (template.default_view) {
          updates.default_view = template.default_view;
        }

        await supabaseAdmin
          .from('lists')
          .update(updates)
          .in('id', listIds);

        updatedCount = lists.length;
      }
    }

    res.json({ success: true, data: { updated_count: updatedCount } });
  } catch (err) {
    console.error('Propagate custom profile error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Role Access Management
// ============================================================

const addRoleSchema = z.object({ role_id: z.string().uuid() });

router.post('/:id/roles', async (req: Request, res: Response) => {
  try {
    const body = addRoleSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('custom_profile_role_access')
      .insert({ profile_id: req.params.id, role_id: body.role_id })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'Role already has access' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const { data: role } = await supabaseAdmin
      .from('roles')
      .select('id, name, color')
      .eq('id', body.role_id)
      .single();

    res.json({ success: true, data: { ...data, role } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add role access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/:id/roles/:roleId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('custom_profile_role_access')
      .delete()
      .eq('profile_id', req.params.id)
      .eq('role_id', req.params.roleId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Role access removed' });
  } catch (err) {
    console.error('Remove role access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// User Access Management
// ============================================================

const addUserSchema = z.object({ user_id: z.string().uuid() });

router.post('/:id/users', async (req: Request, res: Response) => {
  try {
    const body = addUserSchema.parse(req.body);

    const { data, error } = await supabaseAdmin
      .from('custom_profile_user_access')
      .insert({ profile_id: req.params.id, user_id: body.user_id })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ success: false, error: 'User already has access' });
        return;
      }
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email')
      .eq('id', body.user_id)
      .single();

    res.json({ success: true, data: { ...data, user } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Add user access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/:id/users/:userId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('custom_profile_user_access')
      .delete()
      .eq('profile_id', req.params.id)
      .eq('user_id', req.params.userId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'User access removed' });
  } catch (err) {
    console.error('Remove user access error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
