import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { requirePermission, isWorkspaceAdmin, checkResourceAccess, meetsAccessLevel, isResourceLocked, getAccessibleDescendants, accessLevelRank } from '../../middleware/permissions';
import { PARTNER_USER_TYPES } from '@squadhub/shared';
import type { AccessLevel, User } from '@squadhub/shared';

const router = Router();

// Auth for everything this router sees. NOTE: this router is mounted at `/pm`
// (ahead of the folders/lists/shared-with-me routers), so a path-less
// requireUserType here would gate the WHOLE /pm namespace — which previously
// 403'd client users out of folders/shared-with-me before they reached those
// routers. Scope the internal/partner-only gate to the /spaces paths this file
// actually owns so other /pm routers (which allow clients) can handle their own.
router.use(requireAuth);
router.use('/spaces', requireUserType('internal', ...PARTNER_USER_TYPES));

const createSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  color: z.string().optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
});

// GET /pm/spaces?workspace_id=xxx — list spaces the user has access to
router.get('/spaces', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.query.workspace_id as string;
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'workspace_id is required' });
      return;
    }

    // Admins see all spaces
    const admin = await isWorkspaceAdmin(req.userId!);
    if (admin) {
      const { data, error } = await supabaseAdmin
        .from('spaces')
        .select('*, space_statuses(*)')
        .eq('workspace_id', workspaceId)
        .is('deleted_at', null)
        .neq('kind', 'personal') // personal spaces are private per-user; surfaced via My Tasks only
        .order('position');

      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      res.json({ success: true, data });
      return;
    }

    // Non-admins: only spaces they have membership for, or they created
    const { data: memberships } = await supabaseAdmin
      .from('resource_memberships')
      .select('resource_id, access_level')
      .eq('resource_type', 'space')
      .eq('user_id', req.userId!);

    const memberMap = new Map((memberships || []).map((m: any) => [m.resource_id, m.access_level]));

    const { data: createdSpaces } = await supabaseAdmin
      .from('spaces')
      .select('id')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .eq('status', 'active')
      .neq('kind', 'personal') // exclude the user's own personal space
      .eq('created_by', req.userId!);

    const createdIds = (createdSpaces || []).map((s: any) => s.id);
    const allIds = [...new Set([...memberMap.keys(), ...createdIds])];

    if (allIds.length === 0) {
      res.json({ success: true, data: [] });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('spaces')
      .select('*, space_statuses(*)')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .eq('status', 'active')
      .neq('kind', 'personal') // safety net: personal space may be in allIds via its manager membership row
      .in('id', allIds)
      .order('position');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Attach access level
    const enriched = (data || []).map((space: any) => ({
      ...space,
      my_access_level: createdIds.includes(space.id) ? 'manager' : memberMap.get(space.id) || 'viewer',
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('Get spaces error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/spaces/:id — full space with statuses, folders, lists
router.get('/spaces/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // Space-level access (member/manager/admin) sees the whole area. A partner
    // who was granted only specific folders / design spaces inside this area has
    // no space-level access — fall back to a descendant-scoped view so the shared
    // client folder and its spaces still load, with tabs/lists filtered to what
    // was actually shared with them.
    let userLevel = await checkResourceAccess(req.userId!, 'space', id);
    let scoped: { folderLevels: Map<string, AccessLevel>; listLevels: Map<string, AccessLevel> } | null = null;
    if (!userLevel) {
      const descendants = await getAccessibleDescendants(req.userId!, id);
      if (descendants.folderLevels.size === 0 && descendants.listLevels.size === 0) {
        res.status(403).json({ success: false, error: 'You do not have access to this space' });
        return;
      }
      scoped = descendants;
      // Report the highest descendant grant as the access level for this view.
      const levels = [...descendants.folderLevels.values(), ...descendants.listLevels.values()];
      userLevel = levels.reduce((best, lvl) => (accessLevelRank(lvl) > accessLevelRank(best) ? lvl : best), levels[0]);
    }

    const { data: space, error } = await supabaseAdmin
      .from('spaces')
      .select('*, space_statuses(*)')
      .eq('id', id)
      .single();

    if (error || !space) {
      res.status(404).json({ success: false, error: 'Space not found' });
      return;
    }

    // Fetch non-deleted folders (client-tagged folders included — client
    // areas are regular spaces since the Clients/Areas merge).
    const { data: allFolders } = await supabaseAdmin
      .from('folders')
      .select('*')
      .eq('space_id', id)
      .is('deleted_at', null)
      .order('position');

    // Descendant-scoped view only surfaces folders granted directly to the user.
    const folders = scoped
      ? (allFolders || []).filter((f: any) => scoped!.folderLevels.has(f.id))
      : (allFolders || []);

    const visibleFolderIds = new Set(folders.map((f: any) => f.id));

    // Fetch all non-deleted lists in this space, then drop lists whose folder was filtered
    const { data: allLists } = await supabaseAdmin
      .from('lists')
      .select('*')
      .eq('space_id', id)
      .is('deleted_at', null)
      .order('position');

    const visibleLists = (allLists || []).filter((l: any) => {
      // Scoped view: lists inside a visible folder, plus any list shared directly.
      if (scoped) {
        return (l.folder_id && visibleFolderIds.has(l.folder_id)) || scoped.listLevels.has(l.id);
      }
      return !l.folder_id || visibleFolderIds.has(l.folder_id);
    });

    // Attach lists to their folders
    const foldersWithLists = folders.map((f: any) => ({
      ...f,
      lists: visibleLists.filter((l: any) => l.folder_id === f.id),
    }));

    // Root lists (no folder)
    const rootLists = visibleLists.filter((l: any) => !l.folder_id);

    res.json({
      success: true,
      data: {
        ...space,
        my_access_level: userLevel,
        folders: foldersWithLists,
        lists: rootLists || [],
      },
    });
  } catch (err) {
    console.error('Get space error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /pm/spaces — requires can_create_spaces permission
router.post('/spaces', requirePermission('can_create_spaces'), async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    // Get the next position
    const { count } = await supabaseAdmin
      .from('spaces')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', body.workspace_id);

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('spaces')
      .insert({
        workspace_id: body.workspace_id,
        name: body.name,
        color: body.color || '#7c3aed',
        icon: body.icon || 'folder',
        description: body.description || null,
        is_private: true,
        created_by: req.userId!,
        position: count || 0,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Space insert error:', insertError);
      res.status(500).json({ success: false, error: insertError.message });
      return;
    }

    await supabaseAdmin.from('resource_memberships').insert({
      resource_type: 'space',
      resource_id: inserted.id,
      user_id: req.userId!,
      access_level: 'manager',
    });

    // Fetch the space with statuses separately (trigger-created rows
    // may not be visible in the same insert statement's RETURNING clause)
    const { data, error } = await supabaseAdmin
      .from('spaces')
      .select('*, space_statuses(*)')
      .eq('id', inserted.id)
      .single();

    if (error) {
      console.error('Space select error:', error);
      res.status(201).json({ success: true, data: inserted });
      return;
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create space error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /pm/spaces/:id/assignable-users — viewer+ members of the space. Powers
// the auto-assign picker in space settings.
router.get('/spaces/:id/assignable-users', async (req: Request, res: Response) => {
  try {
    const spaceId = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'space', spaceId);
    if (!userLevel) {
      res.status(403).json({ success: false, error: 'You do not have access to this space' });
      return;
    }

    const { data: memberships, error } = await supabaseAdmin
      .from('resource_memberships')
      .select('user_id, users!resource_memberships_user_id_fkey(id, display_name, email, avatar_url, user_type, is_admin, status, created_at)')
      .eq('resource_type', 'space')
      .eq('resource_id', spaceId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const seen = new Set<string>();
    const users: User[] = [];
    for (const m of (memberships || []) as any[]) {
      if (!m.users || seen.has(m.user_id)) continue;
      if (m.users.status && m.users.status !== 'active') continue;
      seen.add(m.user_id);
      users.push(m.users as User);
    }

    users.sort((a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email));

    res.json({ success: true, data: users });
  } catch (err) {
    console.error('Get space assignable users error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /pm/spaces/:id — requires manager access
router.put('/spaces/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'space', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      res.status(403).json({ success: false, error: 'Manager access required to update spaces' });
      return;
    }

    // Lock check (admins bypass via checkResourceAccess returning 'manager')
    const admin = await isWorkspaceAdmin(req.userId!);
    if (!admin && await isResourceLocked('space', id)) {
      res.status(403).json({ success: false, error: 'This space is locked' });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (req.body.name) updates.name = req.body.name;
    if (req.body.color) updates.color = req.body.color;
    if (req.body.icon) updates.icon = req.body.icon;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (typeof req.body.group_tasks === 'boolean') updates.group_tasks = req.body.group_tasks;
    if (Array.isArray(req.body.auto_assignee_ids)) updates.auto_assignee_ids = req.body.auto_assignee_ids;

    const { data, error } = await supabaseAdmin
      .from('spaces')
      .update(updates)
      .eq('id', id)
      .select('*, space_statuses(*)')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Update space error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /pm/spaces/:id — soft-delete, requires manager access
router.delete('/spaces/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const userLevel = await checkResourceAccess(req.userId!, 'space', id);
    if (!userLevel || !meetsAccessLevel(userLevel, 'manager')) {
      res.status(403).json({ success: false, error: 'Manager access required to delete spaces' });
      return;
    }

    const admin = await isWorkspaceAdmin(req.userId!);
    if (!admin && await isResourceLocked('space', id)) {
      res.status(403).json({ success: false, error: 'This space is locked' });
      return;
    }

    const now = new Date().toISOString();

    // Soft-delete the space
    const { error } = await supabaseAdmin
      .from('spaces')
      .update({ deleted_at: now })
      .eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Also soft-delete child folders and lists
    await supabaseAdmin.from('folders').update({ deleted_at: now }).eq('space_id', id).is('deleted_at', null);
    await supabaseAdmin.from('lists').update({ deleted_at: now }).eq('space_id', id).is('deleted_at', null);

    res.json({ success: true, message: 'Space moved to trash' });
  } catch (err) {
    console.error('Delete space error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
