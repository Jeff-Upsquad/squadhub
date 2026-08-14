import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';
import type { LmsAccessLevel } from '@squadhub/shared';
import { getItemAccess, meetsAccess, getItemApproverUserIds } from '../services/lmsAccess';
import { cloneItemForReview, notifyLms } from '../services/lmsAuthoring';

// ============================================================
// Collaborative (non-admin) LMS authoring + comments, gated by per-item
// access (lms_item_shares). Mounted at /lms/collab.
//
// - Editing endpoints require ADMIN access ON THE ITEM ID. A per-item admin
//   has that on a live item; a contributor has it on their OWN draft clone via
//   ownership — so contributors can only mutate their clone, never live content.
// - `edit-draft` is the one contributor-gated endpoint: it mints/returns the
//   draft clone of a live item.
// - Comments require COMMENTER access (staff-only review channel).
// ============================================================

const router = Router();
router.use(requireAuth);

const BLOCK_TYPES = ['text', 'image', 'video_upload', 'video_embed', 'audio', 'pdf', 'quiz'] as const;

// req.params values are typed `string | string[]` in this project.
const param = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v ?? '');

// --- access helpers ---------------------------------------------------------

async function itemIdForLesson(lessonId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('lms_lessons').select('item_id').eq('id', lessonId).maybeSingle();
  return (data as any)?.item_id ?? null;
}

async function itemIdForBlock(blockId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('lms_content_blocks').select('lesson_id').eq('id', blockId).maybeSingle();
  const lessonId = (data as any)?.lesson_id;
  return lessonId ? itemIdForLesson(lessonId) : null;
}

// A page's "hidden from" list, with user/role details joined for display.
async function loadLessonOverrides(lessonId: string): Promise<any[]> {
  const { data: rows } = await supabaseAdmin
    .from('lms_lesson_access_overrides')
    .select('principal_type, principal_id, mode')
    .eq('lesson_id', lessonId);
  const list = rows || [];
  const userIds = list.filter((r: any) => r.principal_type === 'user').map((r: any) => r.principal_id);
  const roleIds = list.filter((r: any) => r.principal_type === 'role').map((r: any) => r.principal_id);
  const [{ data: users }, { data: roles }] = await Promise.all([
    userIds.length ? supabaseAdmin.from('users').select('id, display_name, email, avatar_url').in('id', userIds) : Promise.resolve({ data: [] as any[] }),
    roleIds.length ? supabaseAdmin.from('roles').select('id, name, color').in('id', roleIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const uById = new Map((users || []).map((u: any) => [u.id, u]));
  const rById = new Map((roles || []).map((r: any) => [r.id, r]));
  return list.map((r: any) => ({
    principal_type: r.principal_type,
    principal_id: r.principal_id,
    mode: r.mode,
    user: r.principal_type === 'user' ? uById.get(r.principal_id) ?? null : null,
    role: r.principal_type === 'role' ? rById.get(r.principal_id) ?? null : null,
  }));
}

/** Resolve access and enforce a minimum. Returns the level, or sends 403/404. */
async function gate(
  itemId: string | null,
  userId: string,
  min: LmsAccessLevel,
  res: Response,
): Promise<LmsAccessLevel | null> {
  if (!itemId) {
    res.status(404).json({ success: false, error: 'Not found' });
    return null;
  }
  const level = await getItemAccess(itemId, userId);
  if (!meetsAccess(level, min)) {
    res.status(403).json({ success: false, error: 'Insufficient access' });
    return null;
  }
  return level;
}

// --- GET my access ----------------------------------------------------------

router.get('/items/:id/access', async (req: Request, res: Response) => {
  const level = await getItemAccess(param(req.params.id), req.userId!);
  res.json({ success: true, data: { access_level: level } });
});

// --- Full editable item (for the web editor) --------------------------------
// Same shape as admin GET item. Requires admin-on-item (contributor on clone).
router.get('/items/:id/full', async (req: Request, res: Response) => {
  try {
    const itemId = param(req.params.id);
    if (!(await gate(itemId, req.userId!, 'admin', res))) return;

    const { data: item } = await supabaseAdmin
      .from('lms_items')
      .select(`*, category:lms_categories(id, name, color, slug)`)
      .eq('id', itemId)
      .single();
    if (!item) { res.status(404).json({ success: false, error: 'Not found' }); return; }

    const { data: lessons } = await supabaseAdmin
      .from('lms_lessons').select('*').eq('item_id', itemId).order('position', { ascending: true });

    const lessonIds = (lessons || []).map((l: any) => l.id);
    const { data: blocks } = lessonIds.length
      ? await supabaseAdmin.from('lms_content_blocks').select('*').in('lesson_id', lessonIds).order('position', { ascending: true })
      : { data: [] as any[] };

    const quizBlockIds = (blocks || []).filter((b: any) => b.type === 'quiz').map((b: any) => b.id);
    const { data: quizQuestions } = quizBlockIds.length
      ? await supabaseAdmin.from('lms_quiz_questions').select('*').in('block_id', quizBlockIds).order('position', { ascending: true })
      : { data: [] as any[] };

    const qByBlock = new Map<string, any[]>();
    for (const q of quizQuestions || []) {
      const list = qByBlock.get((q as any).block_id) || []; list.push(q); qByBlock.set((q as any).block_id, list);
    }
    const bByLesson = new Map<string, any[]>();
    for (const b of blocks || []) {
      const list = bByLesson.get((b as any).lesson_id) || [];
      list.push((b as any).type === 'quiz' ? { ...(b as any), quiz_questions: qByBlock.get((b as any).id) || [] } : b);
      bByLesson.set((b as any).lesson_id, list);
    }
    // Per-page access overrides (who this page is hidden from), joined for display.
    const { data: overrides } = lessonIds.length
      ? await supabaseAdmin.from('lms_lesson_access_overrides').select('lesson_id, principal_type, principal_id, mode').in('lesson_id', lessonIds)
      : { data: [] as any[] };
    const ovByLesson = new Map<string, any[]>();
    for (const o of overrides || []) {
      const list = ovByLesson.get((o as any).lesson_id) || [];
      list.push({ principal_type: (o as any).principal_type, principal_id: (o as any).principal_id, mode: (o as any).mode });
      ovByLesson.set((o as any).lesson_id, list);
    }

    const fullLessons = (lessons || []).map((l: any) => ({ ...l, blocks: bByLesson.get(l.id) || [], access_overrides: ovByLesson.get(l.id) || [] }));

    res.json({ success: true, data: { ...item, lessons: fullLessons } });
  } catch (err) {
    console.error('Collab get full item error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// --- Contributor: create/return the draft clone of a live item --------------
router.post('/items/:id/edit-draft', async (req: Request, res: Response) => {
  try {
    const itemId = param(req.params.id);
    const level = await getItemAccess(itemId, req.userId!);
    if (!meetsAccess(level, 'contributor')) {
      res.status(403).json({ success: false, error: 'Insufficient access' });
      return;
    }

    // Per-item admins edit the live item directly — no clone.
    if (level === 'admin') {
      res.json({ success: true, data: { draft_item_id: itemId, is_clone: false } });
      return;
    }

    const clone = await cloneItemForReview(itemId, req.userId!);
    res.json({ success: true, data: { draft_item_id: clone.id, is_clone: true, review_state: clone.review_state } });
  } catch (err: any) {
    console.error('Collab edit-draft error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// --- Item metadata ----------------------------------------------------------
const itemPatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  summary: z.string().max(2000).nullable().optional(),
  cover_image_url: z.string().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
});

router.patch('/items/:id', async (req: Request, res: Response) => {
  try {
    const itemId = param(req.params.id);
    if (!(await gate(itemId, req.userId!, 'admin', res))) return;
    const body = itemPatchSchema.parse(req.body);
    const patch: Record<string, any> = {};
    for (const k of ['title', 'summary', 'cover_image_url', 'category_id'] as const) {
      if ((body as any)[k] !== undefined) patch[k] = (body as any)[k];
    }
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('lms_items').update(patch).eq('id', itemId).select().single();
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// --- Lessons ----------------------------------------------------------------
const lessonSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  summary: z.string().max(2000).nullable().optional(),
  is_active: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  // Notion-style nesting (migration 170): parent page + emoji icon.
  parent_lesson_id: z.string().uuid().nullable().optional(),
  icon: z.string().max(16).nullable().optional(),
});

router.post('/items/:id/lessons', async (req: Request, res: Response) => {
  try {
    const itemId = param(req.params.id);
    if (!(await gate(itemId, req.userId!, 'admin', res))) return;
    const body = lessonSchema.parse(req.body);
    const parentId = body.parent_lesson_id ?? null;
    // Position is scoped to siblings under the same parent (NULL = top level).
    const siblingQ = supabaseAdmin
      .from('lms_lessons').select('position').eq('item_id', itemId)
      .order('position', { ascending: false }).limit(1);
    const { data: maxRow } = await (parentId
      ? siblingQ.eq('parent_lesson_id', parentId)
      : siblingQ.is('parent_lesson_id', null)).maybeSingle();
    const nextPos = ((maxRow as any)?.position ?? -1) + 1;
    const { data, error } = await supabaseAdmin
      .from('lms_lessons')
      .insert({
        item_id: itemId,
        title: body.title || (parentId ? 'Untitled' : `Page ${nextPos + 1}`),
        summary: body.summary ?? null,
        parent_lesson_id: parentId,
        icon: body.icon ?? null,
        position: nextPos,
        // New pages/chapters start as DRAFT (hidden from learners) until the
        // author publishes them.
        is_active: false,
      })
      .select().single();
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    res.status(201).json({ success: true, data: { ...data, blocks: [], access_overrides: [] } });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.patch('/lessons/:lessonId', async (req: Request, res: Response) => {
  try {
    const lessonId = param(req.params.lessonId);
    const itemId = await itemIdForLesson(lessonId);
    if (!(await gate(itemId, req.userId!, 'admin', res))) return;
    const body = lessonSchema.parse(req.body);
    // Guard against a page becoming its own ancestor (would orphan the subtree).
    if (body.parent_lesson_id) {
      if (body.parent_lesson_id === lessonId) { res.status(400).json({ success: false, error: 'A page cannot be its own parent' }); return; }
      let cur: string | null = body.parent_lesson_id;
      const guard = new Set<string>();
      while (cur && !guard.has(cur)) {
        if (cur === lessonId) { res.status(400).json({ success: false, error: 'Cannot move a page into its own descendant' }); return; }
        guard.add(cur);
        const row: any = (await supabaseAdmin.from('lms_lessons').select('parent_lesson_id').eq('id', cur).maybeSingle()).data;
        cur = row?.parent_lesson_id ?? null;
      }
    }
    const patch: Record<string, any> = {};
    for (const k of ['title', 'summary', 'is_active', 'position', 'parent_lesson_id', 'icon'] as const) {
      if ((body as any)[k] !== undefined) patch[k] = (body as any)[k];
    }
    const { data, error } = await supabaseAdmin.from('lms_lessons').update(patch).eq('id', lessonId).select().single();
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/lessons/:lessonId', async (req: Request, res: Response) => {
  const lessonId = param(req.params.lessonId);
  const itemId = await itemIdForLesson(lessonId);
  if (!(await gate(itemId, req.userId!, 'admin', res))) return;
  const { error } = await supabaseAdmin.from('lms_lessons').delete().eq('id', lessonId);
  if (error) { res.status(500).json({ success: false, error: error.message }); return; }
  res.json({ success: true });
});

const reorderSchema = z.object({ items: z.array(z.object({ id: z.string().uuid(), position: z.number().int().min(0) })) });

router.put('/items/:id/lessons/reorder', async (req: Request, res: Response) => {
  try {
    const itemId = param(req.params.id);
    if (!(await gate(itemId, req.userId!, 'admin', res))) return;
    const { items } = reorderSchema.parse(req.body);
    for (const it of items) {
      await supabaseAdmin.from('lms_lessons').update({ position: it.position }).eq('id', it.id).eq('item_id', itemId);
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// --- Per-page access overrides (hide a page from specific roles/users) -------
const accessPutSchema = z.object({
  overrides: z.array(z.object({
    principal_type: z.enum(['user', 'role']),
    principal_id: z.string().uuid(),
  })),
});

router.get('/lessons/:lessonId/access', async (req: Request, res: Response) => {
  const lessonId = param(req.params.lessonId);
  const itemId = await itemIdForLesson(lessonId);
  if (!(await gate(itemId, req.userId!, 'admin', res))) return;
  const rows = await loadLessonOverrides(lessonId);
  res.json({ success: true, data: rows });
});

router.put('/lessons/:lessonId/access', async (req: Request, res: Response) => {
  try {
    const lessonId = param(req.params.lessonId);
    const itemId = await itemIdForLesson(lessonId);
    if (!(await gate(itemId, req.userId!, 'admin', res))) return;
    const { overrides } = accessPutSchema.parse(req.body);
    await supabaseAdmin.from('lms_lesson_access_overrides').delete().eq('lesson_id', lessonId);
    if (overrides.length) {
      const seen = new Set<string>();
      const rows = overrides
        .filter((o) => { const k = `${o.principal_type}:${o.principal_id}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .map((o) => ({ lesson_id: lessonId, principal_type: o.principal_type, principal_id: o.principal_id, mode: 'exclude' }));
      const { error } = await supabaseAdmin.from('lms_lesson_access_overrides').insert(rows);
      if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    }
    res.json({ success: true, data: await loadLessonOverrides(lessonId) });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// --- Blocks -----------------------------------------------------------------
const blockCreateSchema = z.object({ type: z.enum(BLOCK_TYPES) });
const blockUpdateSchema = z.object({
  type: z.enum(BLOCK_TYPES).optional(),
  text_content: z.any().optional(),
  file_url: z.string().nullable().optional(),
  file_name: z.string().nullable().optional(),
  file_size: z.number().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  embed_url: z.string().nullable().optional(),
  embed_provider: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  position: z.number().int().min(0).optional(),
});

router.post('/lessons/:lessonId/blocks', async (req: Request, res: Response) => {
  try {
    const lessonId = param(req.params.lessonId);
    const itemId = await itemIdForLesson(lessonId);
    if (!(await gate(itemId, req.userId!, 'admin', res))) return;
    const { type } = blockCreateSchema.parse(req.body);
    const { data: maxRow } = await supabaseAdmin
      .from('lms_content_blocks').select('position').eq('lesson_id', lessonId)
      .order('position', { ascending: false }).limit(1).maybeSingle();
    const nextPos = ((maxRow as any)?.position ?? -1) + 1;
    const { data, error } = await supabaseAdmin
      .from('lms_content_blocks')
      .insert({ lesson_id: lessonId, type, position: nextPos, metadata: {} })
      .select().single();
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.patch('/blocks/:blockId', async (req: Request, res: Response) => {
  try {
    const blockId = param(req.params.blockId);
    const itemId = await itemIdForBlock(blockId);
    if (!(await gate(itemId, req.userId!, 'admin', res))) return;
    const body = blockUpdateSchema.parse(req.body);
    const patch: Record<string, any> = {};
    for (const k of ['type', 'text_content', 'file_url', 'file_name', 'file_size', 'mime_type', 'embed_url', 'embed_provider', 'caption', 'metadata', 'position'] as const) {
      if ((body as any)[k] !== undefined) patch[k] = (body as any)[k];
    }
    const { data, error } = await supabaseAdmin.from('lms_content_blocks').update(patch).eq('id', blockId).select().single();
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/blocks/:blockId', async (req: Request, res: Response) => {
  const blockId = param(req.params.blockId);
  const itemId = await itemIdForBlock(blockId);
  if (!(await gate(itemId, req.userId!, 'admin', res))) return;
  const { error } = await supabaseAdmin.from('lms_content_blocks').delete().eq('id', blockId);
  if (error) { res.status(500).json({ success: false, error: error.message }); return; }
  res.json({ success: true });
});

router.put('/lessons/:lessonId/blocks/reorder', async (req: Request, res: Response) => {
  try {
    const lessonId = param(req.params.lessonId);
    const itemId = await itemIdForLesson(lessonId);
    if (!(await gate(itemId, req.userId!, 'admin', res))) return;
    const { items } = reorderSchema.parse(req.body);
    for (const it of items) {
      await supabaseAdmin.from('lms_content_blocks').update({ position: it.position }).eq('id', it.id).eq('lesson_id', lessonId);
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// --- Item publish / unpublish (per-item admin) -----------------------------
// Collab publish only flips lms_items.status (+ post pages live). It does NOT
// materialize assignments / mirror tasks / send share notifications — those
// stay admin-only privileges (POST /admin/lms/items/:id/publish).
router.post('/items/:id/publish', async (req: Request, res: Response) => {
  try {
    const itemId = param(req.params.id);
    if (!(await gate(itemId, req.userId!, 'admin', res))) return;

    const { data: item } = await supabaseAdmin.from('lms_items').select('kind, published_at').eq('id', itemId).maybeSingle();
    if (!item) { res.status(404).json({ success: false, error: 'Not found' }); return; }

    const now = new Date().toISOString();
    // First publish sets published_at (matches admin route's "new content" signal).
    const { data, error } = await supabaseAdmin
      .from('lms_items')
      .update({ status: 'published', published_at: (item as any).published_at || now, updated_at: now })
      .eq('id', itemId).select().single();
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }

    // A post is a single document — publishing it publishes its page (matches admin).
    if ((data as any).kind === 'post') {
      await supabaseAdmin.from('lms_lessons').update({ is_active: true }).eq('item_id', itemId);
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('Collab publish error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Unpublish is only meaningful on a live item (clones are never 'published').
router.post('/items/:id/unpublish', async (req: Request, res: Response) => {
  try {
    const itemId = param(req.params.id);
    if (!(await gate(itemId, req.userId!, 'admin', res))) return;

    const { data: item } = await supabaseAdmin.from('lms_items').select('origin_item_id').eq('id', itemId).single();
    if (!item) { res.status(404).json({ success: false, error: 'Not found' }); return; }
    if ((item as any).origin_item_id) { res.status(400).json({ success: false, error: 'Cannot unpublish a draft' }); return; }

    const { data, error } = await supabaseAdmin
      .from('lms_items').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', itemId).select().single();
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    res.json({ success: true, data });
  } catch (err) {
    console.error('Collab unpublish error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// --- Item share list (read-only; who has access) ---------------------------
// Mirrors GET /admin/lms/items/:id/shares (lms-admin.ts:752). Editing shares
// stays an admin-app action.
router.get('/items/:id/shares', async (req: Request, res: Response) => {
  try {
    const itemId = param(req.params.id);
    if (!(await gate(itemId, req.userId!, 'viewer', res))) return;

    const { data: shares } = await supabaseAdmin
      .from('lms_item_shares').select('*').eq('item_id', itemId).order('created_at', { ascending: true });
    const userIds = (shares || []).filter((s: any) => s.principal_type === 'user').map((s: any) => s.principal_id);
    const roleIds = (shares || []).filter((s: any) => s.principal_type === 'role').map((s: any) => s.principal_id);
    const [{ data: users }, { data: roles }] = await Promise.all([
      userIds.length ? supabaseAdmin.from('users').select('id, display_name, email, avatar_url').in('id', userIds) : Promise.resolve({ data: [] as any[] }),
      roleIds.length ? supabaseAdmin.from('roles').select('id, name, color').in('id', roleIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const uById = new Map((users || []).map((u: any) => [u.id, u]));
    const rById = new Map((roles || []).map((r: any) => [r.id, r]));
    res.json({
      success: true,
      data: (shares || []).map((s: any) => ({
        ...s,
        user: s.principal_type === 'user' ? uById.get(s.principal_id) ?? null : null,
        role: s.principal_type === 'role' ? rById.get(s.principal_id) ?? null : null,
      })),
    });
  } catch (err) {
    console.error('Collab list shares error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// --- Submit for review ------------------------------------------------------
router.post('/items/:id/submit-review', async (req: Request, res: Response) => {
  try {
    const itemId = param(req.params.id);
    if (!(await gate(itemId, req.userId!, 'admin', res))) return;

    const { data: item } = await supabaseAdmin
      .from('lms_items').select('id, title, kind, origin_item_id, created_by, review_state').eq('id', itemId).single();
    if (!item) { res.status(404).json({ success: false, error: 'Not found' }); return; }

    const now = new Date().toISOString();
    const { data: updated, error } = await supabaseAdmin
      .from('lms_items')
      .update({ review_state: 'submitted', review_note: null, submitted_by: req.userId!, submitted_at: now })
      .eq('id', itemId).select().single();
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }

    // Notify the approvers of the LIVE item (origin for a clone, else itself).
    const originId = (item as any).origin_item_id || itemId;
    const { data: origin } = await supabaseAdmin.from('lms_items').select('created_by').eq('id', originId).maybeSingle();
    const approvers = await getItemApproverUserIds(originId, (origin as any)?.created_by ?? null);
    await notifyLms(
      approvers.map((uid) => ({ user_id: uid, type: 'lms_review_requested' as const, title: `Review requested: ${(item as any).title}` })),
      originId,
      req.userId!,
      { draft_item_id: itemId },
    );

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Collab submit-review error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// --- Discard my own draft (contributor cancels) -----------------------------
router.delete('/items/:id/draft', async (req: Request, res: Response) => {
  const itemId = param(req.params.id);
  if (!(await gate(itemId, req.userId!, 'admin', res))) return;
  const { data: item } = await supabaseAdmin.from('lms_items').select('origin_item_id').eq('id', itemId).single();
  if (!item || !(item as any).origin_item_id) {
    res.status(400).json({ success: false, error: 'Not a draft revision' });
    return;
  }
  await supabaseAdmin.from('lms_items').delete().eq('id', itemId);
  res.json({ success: true });
});

// ============================================================
// Comments — staff-only review channel (commenter+ can read/post).
// ============================================================
const commentSchema = z.object({
  body: z.string().min(1).max(4000),
  lesson_id: z.string().uuid().nullable().optional(),
  parent_id: z.string().uuid().nullable().optional(),
});

router.get('/items/:id/comments', async (req: Request, res: Response) => {
  const itemId = param(req.params.id);
  if (!(await gate(itemId, req.userId!, 'commenter', res))) return;
  const { data, error } = await supabaseAdmin
    .from('lms_item_comments')
    .select(`*, author:users!lms_item_comments_author_id_fkey(id, display_name, avatar_url, user_type)`)
    .eq('item_id', itemId)
    .order('created_at', { ascending: true });
  if (error) { res.status(500).json({ success: false, error: error.message }); return; }
  res.json({ success: true, data: data || [] });
});

router.post('/items/:id/comments', async (req: Request, res: Response) => {
  try {
    const itemId = param(req.params.id);
    if (!(await gate(itemId, req.userId!, 'commenter', res))) return;
    const body = commentSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('lms_item_comments')
      .insert({ item_id: itemId, lesson_id: body.lesson_id ?? null, parent_id: body.parent_id ?? null, author_id: req.userId!, body: body.body })
      .select(`*, author:users!lms_item_comments_author_id_fkey(id, display_name, avatar_url, user_type)`)
      .single();
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }

    // Ping the item's approvers (admins + owner) — the review channel audience.
    const { data: item } = await supabaseAdmin.from('lms_items').select('title, created_by').eq('id', itemId).maybeSingle();
    const approvers = await getItemApproverUserIds(itemId, (item as any)?.created_by ?? null);
    await notifyLms(
      approvers.map((uid) => ({ user_id: uid, type: 'lms_comment' as const, title: `New comment on ${(item as any)?.title ?? 'content'}` })),
      itemId,
      req.userId!,
      { comment_id: (data as any).id },
    );

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    console.error('Collab post comment error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const commentPatchSchema = z.object({
  body: z.string().min(1).max(4000).optional(),
  resolved: z.boolean().optional(),
});

router.patch('/comments/:commentId', async (req: Request, res: Response) => {
  try {
    const commentId = param(req.params.commentId);
    const { data: comment } = await supabaseAdmin
      .from('lms_item_comments').select('id, item_id, author_id').eq('id', commentId).single();
    if (!comment) { res.status(404).json({ success: false, error: 'Not found' }); return; }
    const level = await getItemAccess((comment as any).item_id, req.userId!);
    const body = commentPatchSchema.parse(req.body);

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body.body !== undefined) {
      // Only the author may edit their own comment text.
      if ((comment as any).author_id !== req.userId) { res.status(403).json({ success: false, error: 'Not your comment' }); return; }
      patch.body = body.body;
    }
    if (body.resolved !== undefined) {
      // Resolving is a moderation action — contributor+.
      if (!meetsAccess(level, 'contributor')) { res.status(403).json({ success: false, error: 'Insufficient access' }); return; }
      patch.resolved_at = body.resolved ? new Date().toISOString() : null;
      patch.resolved_by = body.resolved ? req.userId! : null;
    }
    const { data, error } = await supabaseAdmin.from('lms_item_comments').update(patch).eq('id', commentId).select().single();
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/comments/:commentId', async (req: Request, res: Response) => {
  const commentId = param(req.params.commentId);
  const { data: comment } = await supabaseAdmin
    .from('lms_item_comments').select('id, item_id, author_id').eq('id', commentId).single();
  if (!comment) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  const level = await getItemAccess((comment as any).item_id, req.userId!);
  // Author, or a contributor+ moderator, may delete.
  if ((comment as any).author_id !== req.userId && !meetsAccess(level, 'contributor')) {
    res.status(403).json({ success: false, error: 'Insufficient access' });
    return;
  }
  const { error } = await supabaseAdmin.from('lms_item_comments').delete().eq('id', commentId);
  if (error) { res.status(500).json({ success: false, error: error.message }); return; }
  res.json({ success: true });
});

// --- Principals for the per-page "hide from" picker (authed staff) -----------
router.get('/principals/roles', async (_req: Request, res: Response) => {
  const { data } = await supabaseAdmin.from('roles').select('id, name, color').order('name', { ascending: true });
  res.json({ success: true, data: data || [] });
});

router.get('/principals/users', async (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim();
  let query = supabaseAdmin
    .from('users').select('id, display_name, email, avatar_url')
    .neq('status', 'banned').neq('status', 'suspended')
    .order('display_name', { ascending: true }).limit(20);
  if (q) query = query.or(`display_name.ilike.%${q}%,email.ilike.%${q}%`);
  const { data } = await query;
  res.json({ success: true, data: data || [] });
});

export default router;
