import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { requirePermission, checkResourceAccess, meetsAccessLevel, isWorkspaceAdmin, isResourceLocked } from '../../middleware/permissions';
import { PARTNER_USER_TYPES } from '@squadhub/shared';

const router = Router();
router.use(requireAuth);
router.use(requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

const createSchema = z.object({
  space_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  profile_id: z.string().uuid().optional(),
  client_space_template_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
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

    // Non-admins only see active folders. Client-tagged folders appear in
    // the Clients section only, so always exclude them here.
    const admin = await isWorkspaceAdmin(req.userId!);
    let query = supabaseAdmin
      .from('folders')
      .select('*, lists(*)')
      .eq('space_id', spaceId)
      .is('deleted_at', null)
      .is('client_id', null)
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

// GET /pm/folders/by-client/:clientId — folders owned by a client the user has access to
router.get('/folders/by-client/:clientId', async (req: Request, res: Response) => {
  try {
    const clientId = req.params.clientId as string;

    // User must have any level of client access
    const { data: access } = await supabaseAdmin
      .from('client_user_access')
      .select('id')
      .eq('client_id', clientId)
      .eq('user_id', req.userId!)
      .maybeSingle();
    if (!access) {
      res.status(403).json({ success: false, error: 'No access to this client' });
      return;
    }

    const { data: folderRows, error } = await supabaseAdmin
      .from('folders')
      .select('id, name, space_id, position, client_id, client_space_template_id, client_space_template_version, deleted_at')
      .eq('client_id', clientId)
      .order('position');

    if (error) {
      console.error('[pm/folders] by-client select error:', error);
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const active = (folderRows || []).filter((f: any) => !f.deleted_at);

    const templateIds = Array.from(
      new Set(active.map((f: any) => f.client_space_template_id).filter(Boolean) as string[]),
    );
    const templatesMap: Record<string, { id: string; slug: string; name: string; icon: string }> = {};
    if (templateIds.length > 0) {
      const { data: tpls } = await supabaseAdmin
        .from('client_space_templates')
        .select('id, slug, name, icon')
        .in('id', templateIds);
      (tpls || []).forEach((t: any) => { templatesMap[t.id] = t; });
    }

    // Filter to folders the user has access to
    const accessibleFolders = [] as any[];
    for (const f of active) {
      const level = await checkResourceAccess(req.userId!, 'folder', f.id);
      if (level) {
        accessibleFolders.push({
          ...f,
          client_space_template: f.client_space_template_id
            ? templatesMap[f.client_space_template_id] || null
            : null,
          my_access_level: level,
        });
      }
    }

    res.json({ success: true, data: accessibleFolders });
  } catch (err) {
    console.error('Get client folders error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/folders/:folderId/squad-pool — users from this folder's client_user_access
// list, filtered to those NOT already members of the folder. Used by Squad Managers
// to invite teammates to their assigned space.
router.get('/folders/:folderId/squad-pool', async (req: Request, res: Response) => {
  try {
    const folderId = req.params.folderId as string;

    const userLevel = await checkResourceAccess(req.userId!, 'folder', folderId);
    if (!userLevel || userLevel !== 'manager') {
      res.status(403).json({ success: false, error: 'Manager access required' });
      return;
    }

    const { data: folder } = await supabaseAdmin
      .from('folders')
      .select('client_id')
      .eq('id', folderId)
      .single();

    if (!folder?.client_id) {
      res.json({ success: true, data: [] });
      return;
    }

    const { data: access } = await supabaseAdmin
      .from('client_user_access')
      .select('user_id, role_id')
      .eq('client_id', folder.client_id);

    const accessUserIds = Array.from(new Set((access || []).map((a: any) => a.user_id)));
    if (accessUserIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    // Folder-level members already added
    const { data: existing } = await supabaseAdmin
      .from('resource_memberships')
      .select('user_id')
      .eq('resource_type', 'folder')
      .eq('resource_id', folderId);
    const existingIds = new Set((existing || []).map((e: any) => e.user_id));

    const candidateIds = accessUserIds.filter((id) => !existingIds.has(id));
    if (candidateIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url, user_type')
      .in('id', candidateIds);

    const roleIds = Array.from(new Set((access || []).map((a: any) => a.role_id).filter(Boolean)));
    const rolesMap: Record<string, any> = {};
    if (roleIds.length > 0) {
      const { data: roles } = await supabaseAdmin
        .from('roles')
        .select('id, name, color')
        .in('id', roleIds);
      (roles || []).forEach((r: any) => { rolesMap[r.id] = r; });
    }
    const roleByUser = new Map<string, any>();
    for (const a of access || []) {
      roleByUser.set(a.user_id, a.role_id ? rolesMap[a.role_id] || null : null);
    }

    const enriched = (users || []).map((u: any) => ({
      ...u,
      client_role: roleByUser.get(u.id) || null,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Get squad pool error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/folders/:id — requires viewer access on folder
router.get('/folders/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'folder', id);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this folder' });
      return;
    }

    const { data: folder, error } = await supabaseAdmin
      .from('folders')
      .select('*, lists(*), custom_profiles:profile_id(id, slug, name, category, target_type, template, version)')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !folder) {
      res.status(404).json({ success: false, error: 'Folder not found' });
      return;
    }

    // Filter out soft-deleted lists
    const lists = (folder.lists || []).filter((l: any) => !l.deleted_at);

    res.json({
      success: true,
      data: {
        ...folder,
        lists: lists.sort((a: any, b: any) => (a.position || 0) - (b.position || 0)),
        profile: folder.custom_profiles,
        custom_profiles: undefined,
        my_access_level: userLevel,
      },
    });
  } catch (err) {
    console.error('Get folder error:', err);
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

    // If a client-space template is provided, fetch it (alternate template source)
    let clientSpaceTemplate: any = null;
    if (body.client_space_template_id) {
      const { data: tpl } = await supabaseAdmin
        .from('client_space_templates')
        .select('*')
        .eq('id', body.client_space_template_id)
        .eq('is_enabled', true)
        .single();

      if (!tpl) {
        res.status(400).json({ success: false, error: 'Invalid or disabled client-space template' });
        return;
      }
      clientSpaceTemplate = tpl;
    }

    // If a client is provided, require workspace admin (sharing is admin-driven).
    if (body.client_id) {
      const wsAdmin = await isWorkspaceAdmin(req.userId!);
      if (!wsAdmin) {
        res.status(403).json({ success: false, error: 'Workspace admin access required to add client spaces' });
        return;
      }
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

    if (clientSpaceTemplate) {
      insertPayload.client_space_template_id = clientSpaceTemplate.id;
      insertPayload.client_space_template_version = clientSpaceTemplate.version;
    }

    if (body.client_id) {
      insertPayload.client_id = body.client_id;
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

    // Or auto-create child lists from client-space template
    if (clientSpaceTemplate && clientSpaceTemplate.template?.lists) {
      const templateLists = clientSpaceTemplate.template.lists as Array<{ name: string; position: number; default_view?: string }>;
      for (const tl of templateLists) {
        const { error: listErr } = await supabaseAdmin.from('lists').insert({
          space_id: body.space_id,
          folder_id: data.id,
          name: tl.name,
          position: tl.position || 0,
          is_private: true,
          created_by: req.userId!,
        });
        if (listErr) {
          console.error('[pm/folders] child list insert failed:', listErr);
        }
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

    const updates: Record<string, unknown> = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.space_id !== undefined) updates.space_id = req.body.space_id;

    // If moving to a new space, validate destination access + lock, then
    // cascade the space_id change to this folder's child lists so the
    // invariant "list.space_id == folder.space_id" holds.
    let newSpaceId: string | null = null;
    let oldSpaceId: string | null = null;
    if (updates.space_id) {
      const { data: currentFolder } = await supabaseAdmin
        .from('folders')
        .select('space_id')
        .eq('id', id)
        .single();
      if (!currentFolder) {
        res.status(404).json({ success: false, error: 'Folder not found' });
        return;
      }
      oldSpaceId = currentFolder.space_id;
      if (updates.space_id !== oldSpaceId) {
        newSpaceId = updates.space_id as string;
        const { data: destSpace } = await supabaseAdmin
          .from('spaces')
          .select('id, deleted_at')
          .eq('id', newSpaceId)
          .single();
        if (!destSpace || destSpace.deleted_at) {
          res.status(400).json({ success: false, error: 'Destination space does not exist' });
          return;
        }
        const destAccess = await checkResourceAccess(req.userId!, 'space', newSpaceId);
        if (!destAccess || !meetsAccessLevel(destAccess, 'member')) {
          res.status(403).json({ success: false, error: 'Member access required on destination space' });
          return;
        }
        if (!adminUser && await isResourceLocked('space', newSpaceId)) {
          res.status(403).json({ success: false, error: 'Destination space is locked' });
          return;
        }
      }
    }

    const { data, error } = await supabaseAdmin
      .from('folders')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Cascade: move child lists with the folder so their space_id matches.
    if (newSpaceId && oldSpaceId && newSpaceId !== oldSpaceId) {
      const { error: cascadeErr } = await supabaseAdmin
        .from('lists')
        .update({ space_id: newSpaceId })
        .eq('folder_id', id)
        .is('deleted_at', null);
      if (cascadeErr) {
        // Roll back the folder move to keep the invariant.
        await supabaseAdmin.from('folders').update({ space_id: oldSpaceId }).eq('id', id);
        console.error('[pm/folders] cascade list move failed, rolled back:', cascadeErr);
        res.status(500).json({ success: false, error: 'Failed to move child lists; folder move rolled back' });
        return;
      }
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
