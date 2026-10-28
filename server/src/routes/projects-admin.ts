import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

// Platform-admin management of workspace projects: list every project with its
// assigned areas/spaces/lists, and operate on both the projects and their
// containers (archive, trash, move, reassign to another project). Mirrors the
// pm routes' semantics (status 'inactive' = archived, deleted_at = trash) but
// bypasses per-resource access checks — requireAdmin is the gate.

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

const uuid = z.string().uuid();
const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'Choose a valid color');
const containerType = z.enum(['space', 'folder', 'list']);
const now = () => new Date().toISOString();

const TABLES = { space: 'spaces', folder: 'folders', list: 'lists' } as const;
type ContainerType = keyof typeof TABLES;

async function getContainer(type: ContainerType, id: string) {
  const { data } = await supabaseAdmin.from(TABLES[type]).select('*').eq('id', id).maybeSingle();
  return data || null;
}

// ------------------------------------------------------------
// GET /admin/projects — every project across workspaces, with workspace
// name and live container counts. Optional search / workspace / status
// filters. Also returns the workspaces themselves for the filter dropdown.
// ------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const workspaceFilter = req.query.workspace_id ? uuid.parse(req.query.workspace_id) : null;
    const statusFilter = req.query.status === 'active' || req.query.status === 'inactive' ? req.query.status
      : req.query.status === 'deleted' ? 'deleted' : null;

    let query = supabaseAdmin.from('projects').select('*').order('created_at', { ascending: false });
    if (workspaceFilter) query = query.eq('workspace_id', workspaceFilter);
    if (statusFilter === 'deleted') query = query.not('deleted_at', 'is', null);
    else {
      query = query.is('deleted_at', null);
      if (statusFilter) query = query.eq('status', statusFilter);
    }

    const { data: projects, error } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const workspaceIds = [...new Set((projects || []).map((p: any) => p.workspace_id))];
    const { data: workspaces } = await supabaseAdmin
      .from('workspaces')
      .select('id, name')
      .in('id', workspaceIds.length ? workspaceIds : ['00000000-0000-0000-0000-000000000000']);
    const wsName = new Map<string, string>((workspaces || []).map((w: any) => [w.id, w.name]));

    // Live container counts per project (nearest-wins means a container points
    // at exactly one project, so three grouped queries cover everything).
    const countRows = await Promise.all(
      (['spaces', 'folders', 'lists'] as const).map((table) =>
        supabaseAdmin.from(table).select('project_id').not('project_id', 'is', null).is('deleted_at', null),
      ),
    );
    const counts = new Map<string, { spaces: number; folders: number; lists: number }>();
    const bump = (pid: string) => {
      if (!counts.has(pid)) counts.set(pid, { spaces: 0, folders: 0, lists: 0 });
      return counts.get(pid)!;
    };
    (countRows[0].data || []).forEach((r: any) => { bump(r.project_id).spaces += 1; });
    (countRows[1].data || []).forEach((r: any) => { bump(r.project_id).folders += 1; });
    (countRows[2].data || []).forEach((r: any) => { bump(r.project_id).lists += 1; });

    const { data: allWorkspaces } = await supabaseAdmin.from('workspaces').select('id, name').order('name');

    const result = (projects || [])
      .filter((p: any) => !search || p.name.toLowerCase().includes(search) || (wsName.get(p.workspace_id) || '').toLowerCase().includes(search))
      .map((p: any) => ({
        ...p,
        workspace_name: wsName.get(p.workspace_id) || 'Unknown workspace',
        container_counts: counts.get(p.id) || { spaces: 0, folders: 0, lists: 0 },
      }));

    res.json({ success: true, data: result, workspaces: allWorkspaces || [] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('List projects error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /admin/projects/workspaces/:workspaceId/spaces — destination choices for
// the move dialog (areas of one workspace).
// ------------------------------------------------------------
router.get('/workspaces/:workspaceId/spaces', async (req: Request, res: Response) => {
  try {
    const workspaceId = uuid.parse(req.params.workspaceId);
    const { data, error } = await supabaseAdmin
      .from('spaces')
      .select('id, name')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .order('name');
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('List workspace spaces error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /admin/projects/:id/containers — the areas (spaces), spaces (folders),
// and lists assigned to a project, with their location + status.
// ------------------------------------------------------------
router.get('/:id/containers', async (req: Request, res: Response) => {
  try {
    const projectId = uuid.parse(req.params.id);
    const [spacesRes, foldersRes, listsRes] = await Promise.all([
      supabaseAdmin.from('spaces').select('id, name, kind, status, deleted_at, workspace_id').eq('project_id', projectId).order('name'),
      supabaseAdmin.from('folders').select('id, name, folder_type, status, deleted_at, space_id').eq('project_id', projectId).order('name'),
      supabaseAdmin.from('lists').select('id, name, status, deleted_at, space_id, folder_id').eq('project_id', projectId).order('name'),
    ]);
    for (const r of [spacesRes, foldersRes, listsRes]) {
      if (r.error) {
        res.status(500).json({ success: false, error: r.error.message });
        return;
      }
    }

    const spaceIds = [...new Set([
      ...(foldersRes.data || []).map((f: any) => f.space_id),
      ...(listsRes.data || []).map((l: any) => l.space_id),
    ].filter(Boolean))];
    const { data: parentSpaces } = spaceIds.length
      ? await supabaseAdmin.from('spaces').select('id, name').in('id', spaceIds)
      : { data: [] as any[] };
    const spaceName = new Map<string, string>((parentSpaces || []).map((s: any) => [s.id, s.name]));

    res.json({
      success: true,
      data: {
        spaces: (spacesRes.data || []).map((s: any) => ({ ...s, parent_name: null })),
        folders: (foldersRes.data || []).map((f: any) => ({ ...f, parent_name: spaceName.get(f.space_id) || '' })),
        lists: (listsRes.data || []).map((l: any) => ({
          ...l,
          parent_name: [spaceName.get(l.space_id) || '', l.folder_id ? '…' : ''].join(' ').trim(),
        })),
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('List project containers error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /admin/projects — create a project in a workspace
// ------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = z.object({
      workspace_id: uuid,
      name: z.string().trim().min(1).max(160),
      color: color.optional(),
      description: z.string().max(2000).optional(),
    }).parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert({ ...body, color: body.color || '#7c5cff', description: body.description || '', created_by: req.userId })
      .select()
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create project error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// PATCH /admin/projects/:id — rename / recolor / archive / unarchive
// ------------------------------------------------------------
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = uuid.parse(req.params.id);
    const body = z.object({
      name: z.string().trim().min(1).max(160).optional(),
      color: color.optional(),
      description: z.string().max(2000).optional(),
      status: z.enum(['active', 'inactive']).optional(),
    }).parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('projects')
      .update({ ...body, updated_at: now() })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update project error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// DELETE /admin/projects/:id — trash (soft delete). Containers keep their
// project_id and resolve to "No project" until the project is restored.
// POST /admin/projects/:id/restore — bring it back.
// DELETE /admin/projects/:id/permanent — hard delete (FK SET NULL detaches
// every container; goals in the project are cascaded).
// ------------------------------------------------------------
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin.from('projects').update({ deleted_at: now(), updated_at: now() }).eq('id', uuid.parse(req.params.id));
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Delete project error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/:id/restore', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('projects')
      .update({ deleted_at: null, updated_at: now() })
      .eq('id', uuid.parse(req.params.id))
      .select()
      .maybeSingle();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Project not found' });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Restore project error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/:id/permanent', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin.from('projects').delete().eq('id', uuid.parse(req.params.id));
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Permanently delete project error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// PUT /admin/containers/:type/:id — reassign a container to another project
// (or detach with null). Validates the project lives in the same workspace.
// ------------------------------------------------------------
router.put('/containers/:type/:id', async (req: Request, res: Response) => {
  try {
    const type = containerType.parse(req.params.type);
    const id = uuid.parse(req.params.id);
    const body = z.object({ project_id: uuid.nullable() }).parse(req.body);

    const container = await getContainer(type, id);
    if (!container) {
      res.status(404).json({ success: false, error: 'Container not found' });
      return;
    }

    if (body.project_id) {
      const workspaceId = type === 'space' ? container.workspace_id
        : (await supabaseAdmin.from('spaces').select('workspace_id').eq('id', container.space_id).maybeSingle()).data?.workspace_id ?? null;
      const { data: project } = await supabaseAdmin
        .from('projects')
        .select('id')
        .eq('id', body.project_id)
        .eq('workspace_id', workspaceId || '')
        .is('deleted_at', null)
        .maybeSingle();
      if (!project) {
        res.status(400).json({ success: false, error: 'Project not found in this container\'s workspace' });
        return;
      }
    }

    const { data, error } = await supabaseAdmin
      .from(TABLES[type])
      .update({ project_id: body.project_id, updated_at: now() })
      .eq('id', id)
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
    console.error('Reassign container error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// PUT /admin/containers/:type/:id/status — archive (inactive) / unarchive
// ------------------------------------------------------------
router.put('/containers/:type/:id/status', async (req: Request, res: Response) => {
  try {
    const type = containerType.parse(req.params.type);
    const id = uuid.parse(req.params.id);
    const body = z.object({ status: z.enum(['active', 'inactive']) }).parse(req.body);
    const { data, error } = await supabaseAdmin
      .from(TABLES[type])
      .update({ status: body.status, updated_at: now() })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Container not found' });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update container status error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// DELETE /admin/containers/:type/:id — trash with the same cascade the pm
// endpoints use (folder takes its lists, space takes folders + lists).
// ------------------------------------------------------------
router.delete('/containers/:type/:id', async (req: Request, res: Response) => {
  try {
    const type = containerType.parse(req.params.type);
    const id = uuid.parse(req.params.id);
    const container = await getContainer(type, id);
    if (!container) {
      res.status(404).json({ success: false, error: 'Container not found' });
      return;
    }
    const ts = now();
    if (type === 'space') {
      await Promise.all([
        supabaseAdmin.from('spaces').update({ deleted_at: ts, updated_at: ts }).eq('id', id),
        supabaseAdmin.from('folders').update({ deleted_at: ts, updated_at: ts }).eq('space_id', id).is('deleted_at', null),
        supabaseAdmin.from('lists').update({ deleted_at: ts, updated_at: ts }).eq('space_id', id).is('deleted_at', null),
      ]);
    } else if (type === 'folder') {
      await Promise.all([
        supabaseAdmin.from('folders').update({ deleted_at: ts, updated_at: ts }).eq('id', id),
        supabaseAdmin.from('lists').update({ deleted_at: ts, updated_at: ts }).eq('folder_id', id).is('deleted_at', null),
      ]);
    } else {
      await supabaseAdmin.from('lists').update({ deleted_at: ts, updated_at: ts }).eq('id', id);
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Delete container error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// PUT /admin/containers/:type/:id/move — move a folder to another space or a
// list to another space/folder. Mirrors PUT /pm/folders|lists/:id: the folder
// cascades its child lists so list.space_id == folder.space_id holds.
// ------------------------------------------------------------
router.put('/containers/:type/:id/move', async (req: Request, res: Response) => {
  try {
    const type = containerType.parse(req.params.type);
    const id = uuid.parse(req.params.id);
    const body = z.object({
      space_id: uuid,
      folder_id: uuid.nullable().optional(),
    }).parse(req.body);

    const { data: destSpace } = await supabaseAdmin
      .from('spaces')
      .select('id, deleted_at')
      .eq('id', body.space_id)
      .maybeSingle();
    if (!destSpace || destSpace.deleted_at) {
      res.status(400).json({ success: false, error: 'Destination space does not exist' });
      return;
    }

    if (type === 'folder') {
      const current = await getContainer('folder', id);
      if (!current) {
        res.status(404).json({ success: false, error: 'Folder not found' });
        return;
      }
      const { data, error } = await supabaseAdmin
        .from('folders')
        .update({ space_id: body.space_id, updated_at: now() })
        .eq('id', id)
        .select()
        .single();
      if (error || !data) {
        res.status(error ? 500 : 404).json({ success: false, error: error?.message || 'Folder not found' });
        return;
      }
      const { error: cascadeErr } = await supabaseAdmin
        .from('lists')
        .update({ space_id: body.space_id })
        .eq('folder_id', id)
        .is('deleted_at', null);
      if (cascadeErr) {
        // Roll back to the pre-move space so the invariant keeps holding.
        await supabaseAdmin.from('folders').update({ space_id: current.space_id }).eq('id', id);
        res.status(500).json({ success: false, error: 'Failed to move child lists; folder move rolled back' });
        return;
      }
      res.json({ success: true, data });
      return;
    }

    if (type === 'list') {
      if (body.folder_id) {
        const { data: destFolder } = await supabaseAdmin
          .from('folders')
          .select('id, space_id, deleted_at')
          .eq('id', body.folder_id)
          .maybeSingle();
        if (!destFolder || destFolder.deleted_at) {
          res.status(400).json({ success: false, error: 'Destination folder does not exist' });
          return;
        }
        if (destFolder.space_id !== body.space_id) {
          res.status(400).json({ success: false, error: 'Destination folder is not in the destination space' });
          return;
        }
      }
      const { data, error } = await supabaseAdmin
        .from('lists')
        .update({ space_id: body.space_id, folder_id: body.folder_id ?? null, updated_at: now() })
        .eq('id', id)
        .select()
        .single();
      if (error || !data) {
        res.status(error ? 500 : 404).json({ success: false, error: error?.message || 'List not found' });
        return;
      }
      res.json({ success: true, data });
      return;
    }

    res.status(400).json({ success: false, error: 'Spaces cannot be moved' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Move container error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
