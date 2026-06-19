// ============================================================
// SquadNotes — Notion-style nested notes / docs.
//
// Pages nest via parent_id; each tree has a denormalized root_id
// (trigger-maintained). Sharing lives on the ROOT page
// (squad_note_shares: user / role / department grantees, read|edit) and
// is inherited by descendants. Access is validated here with the service
// role via getNoteAccess(); RLS is enabled with no policies.
//
// Gated behind the 'squad-notes' mini app (admins always pass).
// ============================================================
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { requireAuth } from '../middleware/auth';
import { requireMiniAppOrAdmin } from '../middleware/miniApp';
import { isWorkspaceAdmin } from '../middleware/permissions';
import { getUserRoleIds } from '../utils/roles';
import { FILE_SIZE_LIMITS, generateNoteUploadUrl } from '../r2';
import { unfurl } from '../services/unfurl';

const router = Router();

router.use(requireAuth);
router.use(requireMiniAppOrAdmin('squad-notes'));

type NoteAccess = 'none' | 'read' | 'edit';

// Light fields used for the sidebar tree (no content/cover).
const TREE_FIELDS = 'id, parent_id, root_id, title, icon, position, owner_id, visibility, updated_at';

// ---- helpers ---------------------------------------------------------------

async function getUserWorkspaceId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .maybeSingle();
  return (data?.workspace_id as string) || null;
}

async function getUserIdentities(userId: string): Promise<{ roleIds: string[]; deptIds: string[] }> {
  const roleIds = await getUserRoleIds(userId);
  const { data: depts } = await supabaseAdmin
    .from('department_members')
    .select('department_id')
    .eq('user_id', userId);
  const deptIds = (depts || []).map((d: any) => d.department_id as string);
  return { roleIds, deptIds };
}

async function loadNote(id: string): Promise<any | null> {
  const { data } = await supabaseAdmin.from('squad_notes').select('*').eq('id', id).maybeSingle();
  return data;
}

// Resolve the root note for sharing/access purposes.
async function loadRoot(note: any): Promise<any> {
  const rootId = note.root_id || note.id;
  if (rootId === note.id) return note;
  const { data } = await supabaseAdmin.from('squad_notes').select('*').eq('id', rootId).maybeSingle();
  return data || note;
}

// Owner / admin → edit; otherwise the max share level on the ROOT that matches
// the user's identities (user / role / department).
async function getNoteAccess(userId: string, note: any): Promise<NoteAccess> {
  if (!note) return 'none';
  if (note.owner_id === userId) return 'edit';
  if (await isWorkspaceAdmin(userId)) return 'edit';

  const root = await loadRoot(note);
  if (root.owner_id === userId) return 'edit';

  const { data: shares } = await supabaseAdmin
    .from('squad_note_shares')
    .select('grantee_type, grantee_id, access_level')
    .eq('note_id', root.id);
  if (!shares || shares.length === 0) return 'none';

  const { roleIds, deptIds } = await getUserIdentities(userId);
  let best: NoteAccess = 'none';
  for (const s of shares as any[]) {
    const match =
      (s.grantee_type === 'user' && s.grantee_id === userId) ||
      (s.grantee_type === 'role' && roleIds.includes(s.grantee_id)) ||
      (s.grantee_type === 'department' && deptIds.includes(s.grantee_id));
    if (!match) continue;
    if (s.access_level === 'edit') return 'edit';
    best = 'read';
  }
  return best;
}

// Collect a note id + every descendant id (BFS).
async function collectSubtreeIds(rootId: string): Promise<string[]> {
  const all = new Set<string>([rootId]);
  let frontier = [rootId];
  while (frontier.length) {
    const { data } = await supabaseAdmin
      .from('squad_notes')
      .select('id')
      .in('parent_id', frontier);
    const next = (data || []).map((r: any) => r.id as string).filter((id) => !all.has(id));
    next.forEach((id) => all.add(id));
    frontier = next;
  }
  return Array.from(all);
}

// ---- literal routes (must precede /:id) ------------------------------------

// GET /notes/trash — deletion-roots owned by the user (admins: all in workspace).
router.get('/trash', async (req: Request, res: Response) => {
  try {
    const ws = await getUserWorkspaceId(req.userId!);
    if (!ws) {
      res.json({ success: true, data: [] });
      return;
    }
    const admin = await isWorkspaceAdmin(req.userId!);
    let q = supabaseAdmin
      .from('squad_notes')
      .select('id, parent_id, title, icon, deleted_at, owner_id')
      .eq('workspace_id', ws)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });
    if (!admin) q = q.eq('owner_id', req.userId!);
    const { data, error } = await q;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    // Keep only deletion roots (parent not also deleted) so the trash isn't
    // cluttered with every descendant of a deleted page.
    const deletedIds = new Set((data || []).map((n: any) => n.id));
    const roots = (data || []).filter((n: any) => !n.parent_id || !deletedIds.has(n.parent_id));
    res.json({ success: true, data: roots });
  } catch (err) {
    console.error('GET /notes/trash error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /notes/unfurl?url= — bookmark metadata, or a SquadClips embed.
router.get('/unfurl', async (req: Request, res: Response) => {
  try {
    const rawUrl = req.query.url as string;
    if (!rawUrl) {
      res.status(400).json({ success: false, error: 'url is required' });
      return;
    }

    // SquadClips share/embed links → chrome-free embed URL (host allow-listed).
    let u: URL | null = null;
    try { u = new URL(rawUrl); } catch { u = null; }
    if (u) {
      const clipsHost = (() => {
        try { return new URL(process.env.NEXT_PUBLIC_CLIPS_URL || 'https://clips.squadhub.in').hostname; }
        catch { return 'clips.squadhub.in'; }
      })();
      const isClips =
        u.hostname === clipsHost ||
        u.hostname === 'clips.squadhub.in' ||
        ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port === '3200');
      const m = isClips ? u.pathname.match(/^\/(?:share|embed)\/([A-Za-z0-9_-]+)\/?$/) : null;
      if (m) {
        res.json({ success: true, data: { kind: 'clip-embed', url: rawUrl, embed_url: `${u.origin}/embed/${m[1]}` } });
        return;
      }
    }

    const meta = await unfurl(rawUrl);
    if (!meta) {
      res.json({ success: true, data: { kind: 'bookmark', url: rawUrl } });
      return;
    }
    const favicon = u ? `${u.origin}/favicon.ico` : undefined;
    res.json({ success: true, data: { kind: 'bookmark', favicon, ...meta } });
  } catch (err) {
    console.error('GET /notes/unfurl error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /notes/grantee-options — roles + departments for the share picker.
router.get('/grantee-options', async (_req: Request, res: Response) => {
  try {
    const [{ data: roles }, { data: departments }] = await Promise.all([
      supabaseAdmin.from('roles').select('id, name').order('name'),
      supabaseAdmin.from('departments').select('id, name').order('name'),
    ]);
    res.json({ success: true, data: { roles: roles || [], departments: departments || [] } });
  } catch (err) {
    console.error('GET /notes/grantee-options error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- tree + CRUD -----------------------------------------------------------

// GET /notes — the visible page tree (owned + shared-root subtrees).
router.get('/', async (req: Request, res: Response) => {
  try {
    const ws = await getUserWorkspaceId(req.userId!);
    if (!ws) {
      res.json({ success: true, data: [] });
      return;
    }

    if (await isWorkspaceAdmin(req.userId!)) {
      const { data, error } = await supabaseAdmin
        .from('squad_notes')
        .select(TREE_FIELDS)
        .eq('workspace_id', ws)
        .is('deleted_at', null)
        .order('position', { ascending: true });
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      res.json({ success: true, data: data || [] });
      return;
    }

    const byId = new Map<string, any>();

    // Owned.
    const { data: owned } = await supabaseAdmin
      .from('squad_notes')
      .select(TREE_FIELDS)
      .eq('workspace_id', ws)
      .eq('owner_id', req.userId!)
      .is('deleted_at', null);
    for (const n of owned || []) byId.set(n.id, n);

    // Shared roots that match my identities.
    const { roleIds, deptIds } = await getUserIdentities(req.userId!);
    const allIds = [req.userId!, ...roleIds, ...deptIds];
    const { data: shareRows } = await supabaseAdmin
      .from('squad_note_shares')
      .select('note_id, grantee_type, grantee_id')
      .in('grantee_id', allIds);
    const rootIds = Array.from(
      new Set(
        (shareRows || [])
          .filter((s: any) =>
            (s.grantee_type === 'user' && s.grantee_id === req.userId) ||
            (s.grantee_type === 'role' && roleIds.includes(s.grantee_id)) ||
            (s.grantee_type === 'department' && deptIds.includes(s.grantee_id)),
          )
          .map((s: any) => s.note_id as string),
      ),
    );
    if (rootIds.length) {
      const { data: shared } = await supabaseAdmin
        .from('squad_notes')
        .select(TREE_FIELDS)
        .in('root_id', rootIds)
        .is('deleted_at', null);
      for (const n of shared || []) byId.set(n.id, n);
    }

    const list = Array.from(byId.values()).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    res.json({ success: true, data: list });
  } catch (err) {
    console.error('GET /notes error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /notes/:id — one full note.
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const note = await loadNote(req.params.id as string);
    if (!note || note.deleted_at) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }
    const access = await getNoteAccess(req.userId!, note);
    if (access === 'none') {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }
    res.json({ success: true, data: { ...note, access } });
  } catch (err) {
    console.error('GET /notes/:id error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const createSchema = z.object({
  parent_id: z.string().uuid().nullable().optional(),
  title: z.string().max(500).optional(),
  icon: z.string().max(40).nullable().optional(),
});

// POST /notes — create a (sub-)page.
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    let workspaceId: string | null;
    let parentVisibility = 'private';
    if (body.parent_id) {
      const parent = await loadNote(body.parent_id);
      if (!parent || parent.deleted_at) {
        res.status(404).json({ success: false, error: 'Parent not found' });
        return;
      }
      if ((await getNoteAccess(req.userId!, parent)) !== 'edit') {
        res.status(403).json({ success: false, error: 'No edit access to parent' });
        return;
      }
      workspaceId = parent.workspace_id;
      const root = await loadRoot(parent);
      parentVisibility = root.visibility;
    } else {
      workspaceId = await getUserWorkspaceId(req.userId!);
    }
    if (!workspaceId) {
      res.status(400).json({ success: false, error: 'No workspace' });
      return;
    }

    // Append after existing siblings.
    let posQ = supabaseAdmin
      .from('squad_notes')
      .select('position')
      .is('deleted_at', null)
      .order('position', { ascending: false })
      .limit(1);
    posQ = body.parent_id ? posQ.eq('parent_id', body.parent_id) : posQ.is('parent_id', null).eq('owner_id', req.userId!);
    const { data: last } = await posQ.maybeSingle();
    const position = ((last?.position as number) ?? -1) + 1;

    const { data, error } = await supabaseAdmin
      .from('squad_notes')
      .insert({
        workspace_id: workspaceId,
        parent_id: body.parent_id ?? null,
        title: body.title ?? 'Untitled',
        icon: body.icon ?? null,
        position,
        owner_id: req.userId!,
        visibility: parentVisibility,
        created_by: req.userId!,
        last_edited_by: req.userId!,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.status(201).json({ success: true, data });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('POST /notes error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const updateSchema = z.object({
  title: z.string().max(500).optional(),
  content: z.any().optional(),
  icon: z.string().max(40).nullable().optional(),
  cover_url: z.string().max(2000).nullable().optional(),
  text_size: z.enum(['small', 'normal', 'large']).optional(),
  full_width: z.boolean().optional(),
  position: z.number().int().optional(),
});

// PATCH /notes/:id — update title/content/props (autosave target).
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const body = updateSchema.parse(req.body);
    const note = await loadNote(req.params.id as string);
    if (!note || note.deleted_at) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }
    if ((await getNoteAccess(req.userId!, note)) !== 'edit') {
      res.status(403).json({ success: false, error: 'No edit access' });
      return;
    }

    const patch: Record<string, any> = { last_edited_by: req.userId! };
    for (const k of ['title', 'content', 'icon', 'cover_url', 'text_size', 'full_width', 'position'] as const) {
      if (body[k] !== undefined) patch[k] = body[k];
    }

    const { data, error } = await supabaseAdmin
      .from('squad_notes')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('PATCH /notes/:id error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const moveSchema = z.object({
  parent_id: z.string().uuid().nullable(),
  position: z.number().int().optional(),
});

// POST /notes/:id/move — reparent + reposition (with cycle guard + root reseat).
router.post('/:id/move', async (req: Request, res: Response) => {
  try {
    const body = moveSchema.parse(req.body);
    const note = await loadNote(req.params.id as string);
    if (!note || note.deleted_at) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }
    if ((await getNoteAccess(req.userId!, note)) !== 'edit') {
      res.status(403).json({ success: false, error: 'No edit access' });
      return;
    }

    const subtree = await collectSubtreeIds(note.id);
    let newRoot = note.id;
    if (body.parent_id) {
      if (subtree.includes(body.parent_id)) {
        res.status(400).json({ success: false, error: 'Cannot move a page into its own subtree' });
        return;
      }
      const parent = await loadNote(body.parent_id);
      if (!parent || parent.deleted_at) {
        res.status(404).json({ success: false, error: 'Destination not found' });
        return;
      }
      if ((await getNoteAccess(req.userId!, parent)) !== 'edit') {
        res.status(403).json({ success: false, error: 'No edit access to destination' });
        return;
      }
      newRoot = parent.root_id || parent.id;
    }

    const { error: moveErr } = await supabaseAdmin
      .from('squad_notes')
      .update({ parent_id: body.parent_id, position: body.position ?? note.position })
      .eq('id', note.id);
    if (moveErr) {
      res.status(500).json({ success: false, error: moveErr.message });
      return;
    }
    // Reseat root_id across the moved subtree (trigger only fixes the moved row).
    await supabaseAdmin.from('squad_notes').update({ root_id: newRoot }).in('id', subtree);

    res.json({ success: true });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('POST /notes/:id/move error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /notes/:id — soft-delete the subtree.
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const note = await loadNote(req.params.id as string);
    if (!note) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }
    if ((await getNoteAccess(req.userId!, note)) !== 'edit') {
      res.status(403).json({ success: false, error: 'No edit access' });
      return;
    }
    const ids = await collectSubtreeIds(note.id);
    const { error } = await supabaseAdmin
      .from('squad_notes')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', ids);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /notes/:id error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /notes/:id/restore — restore the subtree (detach if parent still trashed).
router.post('/:id/restore', async (req: Request, res: Response) => {
  try {
    const note = await loadNote(req.params.id as string);
    if (!note) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }
    if ((await getNoteAccess(req.userId!, note)) !== 'edit') {
      res.status(403).json({ success: false, error: 'No edit access' });
      return;
    }

    // If the parent is gone or still trashed, detach to top level.
    let detach = !note.parent_id ? false : false;
    if (note.parent_id) {
      const parent = await loadNote(note.parent_id);
      detach = !parent || !!parent.deleted_at;
    }

    const ids = await collectSubtreeIds(note.id);
    await supabaseAdmin.from('squad_notes').update({ deleted_at: null }).in('id', ids);

    if (detach) {
      // Clearing parent_id fires the trigger that resets this node's root_id to
      // itself; reseat the rest of the subtree to match.
      await supabaseAdmin.from('squad_notes').update({ parent_id: null }).eq('id', note.id);
      await supabaseAdmin.from('squad_notes').update({ root_id: note.id }).in('id', ids);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('POST /notes/:id/restore error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- sharing ---------------------------------------------------------------

// GET /notes/:id/shares — current shares on the note's root (owner/admin only).
router.get('/:id/shares', async (req: Request, res: Response) => {
  try {
    const note = await loadNote(req.params.id as string);
    if (!note) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }
    const root = await loadRoot(note);
    const isOwner = root.owner_id === req.userId;
    if (!isOwner && !(await isWorkspaceAdmin(req.userId!))) {
      res.status(403).json({ success: false, error: 'Only the owner can manage sharing' });
      return;
    }

    const { data: shares } = await supabaseAdmin
      .from('squad_note_shares')
      .select('id, grantee_type, grantee_id, access_level')
      .eq('note_id', root.id);

    // Enrich grantee labels.
    const enriched = await Promise.all(
      (shares || []).map(async (s: any) => {
        let label = 'Unknown';
        let avatar_url: string | null = null;
        if (s.grantee_type === 'user') {
          const { data } = await supabaseAdmin.from('users').select('display_name, avatar_url').eq('id', s.grantee_id).maybeSingle();
          label = (data as any)?.display_name || 'User';
          avatar_url = (data as any)?.avatar_url ?? null;
        } else if (s.grantee_type === 'role') {
          const { data } = await supabaseAdmin.from('roles').select('name').eq('id', s.grantee_id).maybeSingle();
          label = (data as any)?.name || 'Role';
        } else if (s.grantee_type === 'department') {
          const { data } = await supabaseAdmin.from('departments').select('name').eq('id', s.grantee_id).maybeSingle();
          label = (data as any)?.name || 'Team';
        }
        return { ...s, label, avatar_url };
      }),
    );

    res.json({ success: true, data: { root_id: root.id, visibility: root.visibility, shares: enriched } });
  } catch (err) {
    console.error('GET /notes/:id/shares error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const sharesSchema = z.object({
  shares: z.array(
    z.object({
      grantee_type: z.enum(['user', 'role', 'department']),
      grantee_id: z.string().uuid(),
      access_level: z.enum(['read', 'edit']),
    }),
  ),
});

// PUT /notes/:id/shares — replace shares on the root; flip visibility.
router.put('/:id/shares', async (req: Request, res: Response) => {
  try {
    const body = sharesSchema.parse(req.body);
    const note = await loadNote(req.params.id as string);
    if (!note) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }
    const root = await loadRoot(note);
    const isOwner = root.owner_id === req.userId;
    if (!isOwner && !(await isWorkspaceAdmin(req.userId!))) {
      res.status(403).json({ success: false, error: 'Only the owner can manage sharing' });
      return;
    }

    // Replace the full set.
    await supabaseAdmin.from('squad_note_shares').delete().eq('note_id', root.id);
    if (body.shares.length) {
      const rows = body.shares.map((s) => ({
        note_id: root.id,
        grantee_type: s.grantee_type,
        grantee_id: s.grantee_id,
        access_level: s.access_level,
        granted_by: req.userId!,
      }));
      const { error } = await supabaseAdmin.from('squad_note_shares').insert(rows);
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
    }

    // Visibility follows whether any share exists; apply to the whole tree.
    const visibility = body.shares.length ? 'shared' : 'private';
    await supabaseAdmin.from('squad_notes').update({ visibility }).eq('root_id', root.id);

    res.json({ success: true, data: { visibility } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('PUT /notes/:id/shares error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- uploads ---------------------------------------------------------------

const presignSchema = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1).max(255),
  file_size: z.number().int().positive(),
  file_category: z.enum(['image', 'audio', 'video', 'file']),
});

// POST /notes/:id/upload-presign — pre-signed R2 PUT for note media/files.
router.post('/:id/upload-presign', async (req: Request, res: Response) => {
  try {
    const body = presignSchema.parse(req.body);
    const note = await loadNote(req.params.id as string);
    if (!note || note.deleted_at) {
      res.status(404).json({ success: false, error: 'Note not found' });
      return;
    }
    if ((await getNoteAccess(req.userId!, note)) !== 'edit') {
      res.status(403).json({ success: false, error: 'No edit access' });
      return;
    }

    const limit = FILE_SIZE_LIMITS[body.file_category];
    if (limit && body.file_size > limit) {
      res.status(400).json({
        success: false,
        error: `${body.file_category} exceeds max size of ${Math.floor(limit / 1024 / 1024)} MB`,
      });
      return;
    }

    const { uploadUrl, objectKey, publicUrl } = await generateNoteUploadUrl(
      note.id,
      body.filename,
      body.content_type,
    );

    res.json({
      success: true,
      data: { upload_url: uploadUrl, public_url: publicUrl, key: objectKey, expires_in: 3600 },
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('POST /notes/:id/upload-presign error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
