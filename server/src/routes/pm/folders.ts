import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { requirePermission, checkResourceAccess, meetsAccessLevel, isWorkspaceAdmin, isResourceLocked } from '../../middleware/permissions';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', 'partner'));

const createSchema = z.object({
  space_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  profile_id: z.string().uuid().optional(),
});

// GET /pm/folders?space_id=xxx
router.get('/folders', async (req: Request, res: Response) => {
  try {
    const spaceId = req.query.space_id as string;
    if (!spaceId) {
      res.status(400).json({ success: false, error: 'space_id is required' });
      return;
    }

    // Check user has at least viewer access to the parent space
    const userLevel = await checkResourceAccess(req.userId!, 'space', spaceId);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this space' });
      return;
    }

    // Non-admins only see active folders
    const admin = await isWorkspaceAdmin(req.userId!);
    let query = supabaseAdmin
      .from('folders')
      .select('*, lists(*)')
      .eq('space_id', spaceId)
      .is('deleted_at', null)
      .order('position');

    if (!admin) query = query.eq('status', 'active');

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Get folders error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/folders — requires can_create_folders + member access on space
router.post('/folders', requirePermission('can_create_folders'), async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    // Check member+ access on parent space
    const spaceAccess = await checkResourceAccess(req.userId!, 'space', body.space_id);
    if (!spaceAccess || !meetsAccessLevel(spaceAccess, 'member')) {
      res.status(403).json({ success: false, error: 'Member access on the space is required to create folders' });
      return;
    }

    // Lock check on parent space
    const adminUser = await isWorkspaceAdmin(req.userId!);
    if (!adminUser && await isResourceLocked('space', body.space_id)) {
      res.status(403).json({ success: false, error: 'This space is locked' });
      return;
    }

    // If profile_id is provided, fetch the profile template
    let profile: any = null;
    if (body.profile_id) {
      const { data: profileData } = await supabaseAdmin
        .from('custom_profiles')
        .select('*')
        .eq('id', body.profile_id)
        .eq('target_type', 'folder')
        .eq('is_enabled', true)
        .single();

      if (!profileData) {
        res.status(400).json({ success: false, error: 'Invalid or disabled profile' });
        return;
      }
      profile = profileData;
    }

    const { count } = await supabaseAdmin
      .from('folders')
      .select('*', { count: 'exact', head: true })
      .eq('space_id', body.space_id);

    const insertPayload: Record<string, unknown> = {
      space_id: body.space_id,
      name: body.name,
      is_private: true,
      created_by: req.userId!,
      position: count || 0,
    };

    if (profile) {
      insertPayload.profile_id = profile.id;
      insertPayload.profile_version = profile.version;
    }

    const { data, error } = await supabaseAdmin
      .from('folders')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Auto-create child lists from profile template
    if (profile && profile.template?.lists) {
      const templateLists = profile.template.lists as Array<{ name: string; position: number; default_view?: string }>;
      for (const tl of templateLists) {
        await supabaseAdmin.from('lists').insert({
          space_id: body.space_id,
          folder_id: data.id,
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

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create folder error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /pm/folders/:id — requires manager access on folder
router.put('/folders/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'folder', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      res.status(403).json({ success: false, error: 'Manager access required to update folders' });
      return;
    }

    const adminUser = await isWorkspaceAdmin(req.userId!);
    if (!adminUser && await isResourceLocked('folder', id)) {
      res.status(403).json({ success: false, error: 'This folder is locked' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('folders')
      .update({ name: req.body.name })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Update folder error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/folders/:id — soft-delete, requires manager access
router.delete('/folders/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'folder', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      res.status(403).json({ success: false, error: 'Manager access required to delete folders' });
      return;
    }

    const adminUser = await isWorkspaceAdmin(req.userId!);
    if (!adminUser && await isResourceLocked('folder', id)) {
      res.status(403).json({ success: false, error: 'This folder is locked' });
      return;
    }

    const now = new Date().toISOString();

    // Soft-delete the folder
    const { error } = await supabaseAdmin
      .from('folders')
      .update({ deleted_at: now })
      .eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Also soft-delete child lists
    await supabaseAdmin.from('lists').update({ deleted_at: now }).eq('folder_id', id).is('deleted_at', null);

    res.json({ success: true, message: 'Folder moved to trash' });
  } catch (err) {
    console.error('Delete folder error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
