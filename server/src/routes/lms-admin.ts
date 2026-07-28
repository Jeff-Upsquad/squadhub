import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { mirrorCourseItem } from '../services/taskMirror';
import { applyRevision, discardClone, notifyLms } from '../services/lmsAuthoring';

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// Repo root (server/src/routes -> ../../..). Used to locate the SOP generator.
const REPO_ROOT = path.resolve(__dirname, '../../..');
const SOP_SPECS_DIR = path.join(REPO_ROOT, 'tools', 'sop_specs');
const SOP_SCRIPT = path.join(REPO_ROOT, 'tools', 'generate_sop.mjs');

const BLOCK_TYPES = ['text', 'image', 'video_upload', 'video_embed', 'audio', 'pdf', 'quiz'] as const;
const USER_TYPES = ['internal', 'client', 'client_staff', 'partner', 'partner_employee'] as const;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    || `item-${Date.now()}`;
}

async function ensureUniqueSlug(base: string, ignoreId?: string): Promise<string> {
  let candidate = base;
  let suffix = 1;
  while (true) {
    const query = supabaseAdmin.from('lms_items').select('id').eq('slug', candidate).limit(1);
    const { data } = await query;
    const conflict = (data || []).find((r: any) => r.id !== ignoreId);
    if (!conflict) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

// ============================================================
// Categories
// ============================================================

router.get('/categories', async (_req: Request, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('lms_categories')
    .select('*')
    .order('position', { ascending: true });
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true, data: data || [] });
});

const categoryCreateSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(80).optional(),
  color: z.string().max(16).optional(),
});

router.post('/categories', async (req: Request, res: Response) => {
  try {
    const body = categoryCreateSchema.parse(req.body);
    const slug = body.slug || slugify(body.name);

    const { data: maxRow } = await supabaseAdmin
      .from('lms_categories')
      .select('position')
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = ((maxRow as any)?.position ?? -1) + 1;

    const { data, error } = await supabaseAdmin
      .from('lms_categories')
      .insert({ name: body.name, slug, color: body.color || '#6b7280', position: nextPos })
      .select()
      .single();

    if (error) {
      const status = error.code === '23505' ? 409 : 500;
      res.status(status).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.patch('/categories/:id', async (req: Request, res: Response) => {
  try {
    const body = categoryCreateSchema.partial().parse(req.body);
    const patch: Record<string, any> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.slug !== undefined) patch.slug = body.slug;
    if (body.color !== undefined) patch.color = body.color;

    const { data, error } = await supabaseAdmin
      .from('lms_categories')
      .update(patch)
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
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/categories/:id', async (req: Request, res: Response) => {
  const { error } = await supabaseAdmin.from('lms_categories').delete().eq('id', req.params.id);
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true });
});

// ============================================================
// Items (posts + courses)
// ============================================================

// GET /admin/lms/items — list with summary data
router.get('/items', async (req: Request, res: Response) => {
  try {
    const kindFilter = req.query.kind as string | undefined;
    const statusFilter = req.query.status as string | undefined;
    const categoryFilter = req.query.category_id as string | undefined;
    const trackFilter = req.query.track as string | undefined;

    let query = supabaseAdmin
      .from('lms_items')
      .select(`
        *,
        category:lms_categories(id, name, color, slug)
      `)
      // Draft clones (contributor revisions) live only in the Review Queue.
      .is('origin_item_id', null)
      .order('updated_at', { ascending: false });

    if (kindFilter) query = query.eq('kind', kindFilter);
    if (statusFilter) query = query.eq('status', statusFilter);
    if (categoryFilter) query = query.eq('category_id', categoryFilter);
    if (trackFilter) query = query.eq('track', trackFilter);

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const itemIds = (data || []).map((i: any) => i.id);
    // Counts: assignments per item
    const { data: assignmentCounts } = itemIds.length
      ? await supabaseAdmin
          .from('lms_assignments')
          .select('item_id')
          .in('item_id', itemIds)
      : { data: [] };

    const counts = new Map<string, number>();
    for (const a of assignmentCounts || []) {
      counts.set((a as any).item_id, (counts.get((a as any).item_id) || 0) + 1);
    }

    // Audience types per item
    const { data: audienceRows } = itemIds.length
      ? await supabaseAdmin
          .from('lms_item_audience_types')
          .select('item_id, user_type')
          .in('item_id', itemIds)
      : { data: [] };

    const audienceByItem = new Map<string, string[]>();
    for (const row of audienceRows || []) {
      const list = audienceByItem.get((row as any).item_id) || [];
      list.push((row as any).user_type);
      audienceByItem.set((row as any).item_id, list);
    }

    const result = (data || []).map((i: any) => ({
      ...i,
      assignment_count: counts.get(i.id) || 0,
      audience_types: audienceByItem.get(i.id) || [],
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('List items error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const itemCreateSchema = z.object({
  kind: z.enum(['post', 'course']),
  track: z.enum(['learning', 'sop']).optional(),
  title: z.string().min(1).max(200),
  slug: z.string().optional(),
  summary: z.string().max(2000).nullable().optional(),
  cover_image_url: z.string().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
});

router.post('/items', async (req: Request, res: Response) => {
  try {
    const body = itemCreateSchema.parse(req.body);
    const baseSlug = body.slug ? slugify(body.slug) : slugify(body.title);
    const slug = await ensureUniqueSlug(baseSlug);

    const { data, error } = await supabaseAdmin
      .from('lms_items')
      .insert({
        kind: body.kind,
        track: body.track ?? 'learning',
        title: body.title,
        slug,
        summary: body.summary ?? null,
        cover_image_url: body.cover_image_url ?? null,
        category_id: body.category_id ?? null,
        status: 'draft',
        created_by: req.userId!,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Item insert triggers lms_auto_create_post_lesson for kind='post'.
    // For courses, nothing else is needed — admin will add lessons via the API.

    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create item error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// SOP auto-generator — runs tools/generate_sop.mjs (Playwright) for a chosen
// spec and returns the new DRAFT item id. The "intelligence" (which screen,
// which buttons, the copy) lives in tools/sop_specs/*.json; admins just pick
// one and trigger it, then review/publish the draft.
//
// NOTE: requires Playwright + Chromium and a reachable web app at
// SOP_GEN_BASE_URL on the host running this server.
// ------------------------------------------------------------

// GET /admin/lms/sop-specs — list available generator specs for the picker.
router.get('/sop-specs', async (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(SOP_SPECS_DIR)) { res.json({ success: true, data: [] }); return; }
    const specs = fs.readdirSync(SOP_SPECS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((file) => {
        let title = file;
        try { title = JSON.parse(fs.readFileSync(path.join(SOP_SPECS_DIR, file), 'utf8')).title || file; } catch { /* keep filename */ }
        return { file, title };
      });
    res.json({ success: true, data: specs });
  } catch (err) {
    console.error('List SOP specs error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const generateSchema = z.object({ spec: z.string().regex(/^[a-zA-Z0-9._-]+\.json$/, 'Invalid spec filename') });

// POST /admin/lms/generate-sop — generate a draft SOP from a spec. Runs the
// headless pipeline synchronously (~30–60s) and returns the new item id.
router.post('/generate-sop', async (req: Request, res: Response) => {
  try {
    const { spec } = generateSchema.parse(req.body);
    const specPath = path.join(SOP_SPECS_DIR, spec);
    // Defense in depth: the resolved path must stay inside the specs dir.
    if (!specPath.startsWith(SOP_SPECS_DIR + path.sep) || !fs.existsSync(specPath)) {
      res.status(404).json({ success: false, error: 'Spec not found' });
      return;
    }

    const baseUrl = process.env.SOP_GEN_BASE_URL || 'http://localhost:3000';
    const email = process.env.SOP_GEN_USER_EMAIL || 'testlocal@test.com';

    const result = await runGenerator(specPath, baseUrl, email);
    if (!result.itemId) {
      res.status(500).json({ success: false, error: 'Generation failed', detail: result.log.slice(-1200) });
      return;
    }
    res.json({ success: true, data: { itemId: result.itemId } });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    console.error('Generate SOP error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

function runGenerator(specPath: string, baseUrl: string, email: string): Promise<{ itemId: string | null; log: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [SOP_SCRIPT, '--spec', specPath, '--base', baseUrl, '--email', email], { cwd: REPO_ROOT });
    let out = '';
    const onData = (d: Buffer) => { out += d.toString(); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 240_000); // 4 min hard cap

    child.on('close', () => {
      clearTimeout(timer);
      const m = out.match(/SOP_ITEM_ID=([0-9a-f-]{36})/);
      resolve({ itemId: m ? m[1] : null, log: out });
    });
    child.on('error', (e) => { clearTimeout(timer); resolve({ itemId: null, log: `${out}\nspawn error: ${e.message}` }); });
  });
}

// GET /admin/lms/items/:id — full item with lessons, blocks, audience
router.get('/items/:id', async (req: Request, res: Response) => {
  try {
    const itemId = req.params.id;

    const { data: item, error } = await supabaseAdmin
      .from('lms_items')
      .select(`
        *,
        category:lms_categories(id, name, color, slug)
      `)
      .eq('id', itemId)
      .single();

    if (error || !item) {
      res.status(404).json({ success: false, error: 'Not found' });
      return;
    }

    const { data: lessons } = await supabaseAdmin
      .from('lms_lessons')
      .select('*')
      .eq('item_id', itemId)
      .order('position', { ascending: true });

    const lessonIds = (lessons || []).map((l: any) => l.id);
    const { data: blocks } = lessonIds.length
      ? await supabaseAdmin
          .from('lms_content_blocks')
          .select('*')
          .in('lesson_id', lessonIds)
          .order('position', { ascending: true })
      : { data: [] };

    const quizBlockIds = (blocks || []).filter((b: any) => b.type === 'quiz').map((b: any) => b.id);
    const { data: quizQuestions } = quizBlockIds.length
      ? await supabaseAdmin
          .from('lms_quiz_questions')
          .select('*')
          .in('block_id', quizBlockIds)
          .order('position', { ascending: true })
      : { data: [] };

    const questionsByBlock = new Map<string, any[]>();
    for (const q of quizQuestions || []) {
      const list = questionsByBlock.get((q as any).block_id) || [];
      list.push(q);
      questionsByBlock.set((q as any).block_id, list);
    }

    const blocksByLesson = new Map<string, any[]>();
    for (const b of blocks || []) {
      const list = blocksByLesson.get((b as any).lesson_id) || [];
      const block = (b as any).type === 'quiz'
        ? { ...(b as any), quiz_questions: questionsByBlock.get((b as any).id) || [] }
        : b;
      list.push(block);
      blocksByLesson.set((b as any).lesson_id, list);
    }

    // Lesson-level audience overrides (empty arrays = visible to everyone enrolled)
    const [{ data: lessonATypes }, { data: lessonAUsers }] = lessonIds.length
      ? await Promise.all([
          supabaseAdmin.from('lms_lesson_audience_types').select('lesson_id, user_type').in('lesson_id', lessonIds),
          supabaseAdmin.from('lms_lesson_audience_users').select('lesson_id, user_id').in('lesson_id', lessonIds),
        ])
      : [{ data: [] as any[] }, { data: [] as any[] }];

    const lessonTypesByLesson = new Map<string, string[]>();
    for (const r of lessonATypes || []) {
      const list = lessonTypesByLesson.get((r as any).lesson_id) || [];
      list.push((r as any).user_type);
      lessonTypesByLesson.set((r as any).lesson_id, list);
    }
    const lessonUsersByLesson = new Map<string, string[]>();
    for (const r of lessonAUsers || []) {
      const list = lessonUsersByLesson.get((r as any).lesson_id) || [];
      list.push((r as any).user_id);
      lessonUsersByLesson.set((r as any).lesson_id, list);
    }

    const fullLessons = (lessons || []).map((l: any) => ({
      ...l,
      blocks: blocksByLesson.get(l.id) || [],
      audience_types: lessonTypesByLesson.get(l.id) || [],
      audience_user_ids: lessonUsersByLesson.get(l.id) || [],
    }));

    const [{ data: aTypes }, { data: aUsers }] = await Promise.all([
      supabaseAdmin.from('lms_item_audience_types').select('user_type').eq('item_id', itemId),
      supabaseAdmin.from('lms_item_audience_users').select('user_id').eq('item_id', itemId),
    ]);

    res.json({
      success: true,
      data: {
        ...item,
        lessons: fullLessons,
        audience_types: (aTypes || []).map((r: any) => r.user_type),
        audience_user_ids: (aUsers || []).map((r: any) => r.user_id),
      },
    });
  } catch (err) {
    console.error('Get item error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const itemUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  slug: z.string().optional(),
  summary: z.string().max(2000).nullable().optional(),
  cover_image_url: z.string().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
});

router.patch('/items/:id', async (req: Request, res: Response) => {
  try {
    const body = itemUpdateSchema.parse(req.body);
    const patch: Record<string, any> = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.slug !== undefined) patch.slug = await ensureUniqueSlug(slugify(body.slug), req.params.id as string);
    if (body.summary !== undefined) patch.summary = body.summary;
    if (body.cover_image_url !== undefined) patch.cover_image_url = body.cover_image_url;
    if (body.category_id !== undefined) patch.category_id = body.category_id;

    const { data, error } = await supabaseAdmin
      .from('lms_items')
      .update(patch)
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
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/items/:id', async (req: Request, res: Response) => {
  const { error } = await supabaseAdmin.from('lms_items').delete().eq('id', req.params.id);
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true });
});

// ------------------------------------------------------------
// Audience + Publish/Unpublish
// ------------------------------------------------------------

const audienceSchema = z.object({
  user_types: z.array(z.enum(USER_TYPES)).default([]),
  user_ids: z.array(z.string().uuid()).default([]),
});

// PUT /admin/lms/items/:id/audience — replaces audience
router.put('/items/:id/audience', async (req: Request, res: Response) => {
  try {
    const body = audienceSchema.parse(req.body);
    const itemId = req.params.id;

    // Replace audience rows
    const { error: delTypesErr } = await supabaseAdmin
      .from('lms_item_audience_types')
      .delete()
      .eq('item_id', itemId);
    if (delTypesErr) {
      res.status(500).json({ success: false, error: delTypesErr.message });
      return;
    }

    const { error: delUsersErr } = await supabaseAdmin
      .from('lms_item_audience_users')
      .delete()
      .eq('item_id', itemId);
    if (delUsersErr) {
      res.status(500).json({ success: false, error: delUsersErr.message });
      return;
    }

    if (body.user_types.length) {
      const rows = body.user_types.map((t) => ({ item_id: itemId, user_type: t }));
      const { error: insTypesErr } = await supabaseAdmin.from('lms_item_audience_types').insert(rows);
      if (insTypesErr) {
        res.status(500).json({ success: false, error: insTypesErr.message });
        return;
      }
    }

    if (body.user_ids.length) {
      const rows = body.user_ids.map((uid) => ({ item_id: itemId, user_id: uid }));
      const { error: insUsersErr } = await supabaseAdmin.from('lms_item_audience_users').insert(rows);
      if (insUsersErr) {
        res.status(500).json({ success: false, error: insUsersErr.message });
        return;
      }
    }

    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Set audience error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/lms/items/:id/publish — flip to published + materialize assignments
router.post('/items/:id/publish', async (req: Request, res: Response) => {
  try {
    const itemId = req.params.id as string;

    // 1. Flip status
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('lms_items')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', itemId)
      .select()
      .single();

    if (updateErr || !updated) {
      res.status(500).json({ success: false, error: updateErr?.message || 'Item not found' });
      return;
    }

    // 2. Expand audience into user_ids
    const userIds = await resolveAudienceUserIds(itemId);

    // 3. Upsert assignments (triggers send lms_assigned notifications)
    if (userIds.length) {
      const rows = userIds.map((uid) => ({ item_id: itemId, user_id: uid }));
      const { error: insErr } = await supabaseAdmin
        .from('lms_assignments')
        .upsert(rows, { onConflict: 'item_id,user_id', ignoreDuplicates: true });
      if (insErr) {
        res.status(500).json({ success: false, error: insErr.message });
        return;
      }
    }

    // Mirror assignments with a due date into tasks (no-op for those without one).
    mirrorCourseItem(itemId).catch((err) =>
      console.error('[lms-admin] course mirror sync failed (publish):', err),
    );

    res.json({ success: true, data: { ...updated, assignment_count: userIds.length } });
  } catch (err) {
    console.error('Publish error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.post('/items/:id/unpublish', async (req: Request, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('lms_items')
    .update({ status: 'draft' })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true, data });
});

// POST /admin/lms/items/:id/resync-audience — adds new users to assignments
router.post('/items/:id/resync-audience', async (req: Request, res: Response) => {
  try {
    const itemId = req.params.id as string;
    const userIds = await resolveAudienceUserIds(itemId);
    if (userIds.length) {
      const rows = userIds.map((uid) => ({ item_id: itemId, user_id: uid }));
      const { error } = await supabaseAdmin
        .from('lms_assignments')
        .upsert(rows, { onConflict: 'item_id,user_id', ignoreDuplicates: true });
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
    }
    mirrorCourseItem(itemId).catch((err) =>
      console.error('[lms-admin] course mirror sync failed (resync):', err),
    );
    res.json({ success: true, data: { synced_user_count: userIds.length } });
  } catch (err) {
    console.error('Resync audience error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

async function resolveAudienceUserIds(itemId: string): Promise<string[]> {
  const [{ data: types }, { data: users }] = await Promise.all([
    supabaseAdmin.from('lms_item_audience_types').select('user_type').eq('item_id', itemId),
    supabaseAdmin.from('lms_item_audience_users').select('user_id').eq('item_id', itemId),
  ]);

  const typeList = (types || []).map((r: any) => r.user_type);
  const explicitIds = (users || []).map((r: any) => r.user_id);

  let fromTypes: string[] = [];
  if (typeList.length) {
    const { data: matchingUsers } = await supabaseAdmin
      .from('users')
      .select('id')
      .in('user_type', typeList)
      .neq('status', 'banned')
      .neq('status', 'suspended');
    fromTypes = (matchingUsers || []).map((r: any) => r.id);
  }

  return Array.from(new Set([...fromTypes, ...explicitIds]));
}

// GET /admin/lms/items/:id/assignments — roster
router.get('/items/:id/assignments', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('lms_assignments')
      .select(`
        *,
        user:users(id, display_name, email, avatar_url, user_type)
      `)
      .eq('item_id', req.params.id)
      .order('assigned_at', { ascending: false });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('List assignments error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Sharing (per-item access levels) — migration 165
// ============================================================

const ACCESS_LEVELS = ['viewer', 'commenter', 'contributor', 'admin'] as const;

// GET /admin/lms/items/:id/shares — current grants with user/role details.
// principal_id is polymorphic (no FK), so users + roles are stitched in code.
router.get('/items/:id/shares', async (req: Request, res: Response) => {
  try {
    const { data: shares, error } = await supabaseAdmin
      .from('lms_item_shares')
      .select('*')
      .eq('item_id', req.params.id)
      .order('created_at', { ascending: true });
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }

    const userIds = (shares || []).filter((s: any) => s.principal_type === 'user').map((s: any) => s.principal_id);
    const roleIds = (shares || []).filter((s: any) => s.principal_type === 'role').map((s: any) => s.principal_id);

    const [{ data: users }, { data: roles }] = await Promise.all([
      userIds.length
        ? supabaseAdmin.from('users').select('id, display_name, email, avatar_url, user_type').in('id', userIds)
        : Promise.resolve({ data: [] as any[] }),
      roleIds.length
        ? supabaseAdmin.from('roles').select('id, name, color').in('id', roleIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const userMap = new Map((users || []).map((u: any) => [u.id, u]));
    const roleMap = new Map((roles || []).map((r: any) => [r.id, r]));

    const data = (shares || []).map((s: any) => ({
      ...s,
      user: s.principal_type === 'user' ? userMap.get(s.principal_id) ?? null : null,
      role: s.principal_type === 'role' ? roleMap.get(s.principal_id) ?? null : null,
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('List shares error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const sharesPutSchema = z.object({
  shares: z.array(z.object({
    principal_type: z.enum(['user', 'role']),
    principal_id: z.string().uuid(),
    access_level: z.enum(ACCESS_LEVELS),
  })).default([]),
});

// PUT /admin/lms/items/:id/shares — replace the full share set. Notifies any
// newly added USER principals (role members aren't pinged to avoid spam).
router.put('/items/:id/shares', async (req: Request, res: Response) => {
  try {
    const itemId = req.params.id as string;
    const { shares } = sharesPutSchema.parse(req.body);

    const { data: existing } = await supabaseAdmin
      .from('lms_item_shares').select('principal_type, principal_id').eq('item_id', itemId);
    const existingUserIds = new Set(
      (existing || []).filter((s: any) => s.principal_type === 'user').map((s: any) => s.principal_id),
    );

    // Replace-set: clear then insert (dedupe on principal within the payload).
    await supabaseAdmin.from('lms_item_shares').delete().eq('item_id', itemId);
    if (shares.length) {
      const seen = new Set<string>();
      const rows = shares
        .filter((s) => { const k = `${s.principal_type}:${s.principal_id}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .map((s) => ({
          item_id: itemId,
          principal_type: s.principal_type,
          principal_id: s.principal_id,
          access_level: s.access_level,
          granted_by: req.userId!,
        }));
      const { error: insErr } = await supabaseAdmin.from('lms_item_shares').insert(rows);
      if (insErr) { res.status(500).json({ success: false, error: insErr.message }); return; }
    }

    const { data: item } = await supabaseAdmin.from('lms_items').select('title').eq('id', itemId).maybeSingle();
    const newlyAdded = shares.filter((s) => s.principal_type === 'user' && !existingUserIds.has(s.principal_id));
    if (newlyAdded.length) {
      await notifyLms(
        newlyAdded.map((s) => ({ user_id: s.principal_id, type: 'lms_shared' as const, title: `You were given access to ${(item as any)?.title ?? 'content'}` })),
        itemId,
        req.userId!,
      );
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    console.error('Set shares error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Contributor review queue — migration 165
// ============================================================

// GET /admin/lms/review-queue — submissions awaiting approval.
router.get('/review-queue', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('lms_items')
      .select(`
        id, origin_item_id, kind, track, title, slug, review_state, review_note, submitted_at, submitted_by,
        submitter:users!lms_items_submitted_by_fkey(id, display_name, avatar_url, email),
        origin:lms_items!lms_items_origin_item_id_fkey(id, title, slug, status)
      `)
      .eq('review_state', 'submitted')
      .order('submitted_at', { ascending: true });
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('Review queue error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/lms/items/:id/approve — apply a clone onto its origin, or publish
// brand-new contributor content.
router.post('/items/:id/approve', async (req: Request, res: Response) => {
  try {
    const draftId = req.params.id as string;
    const { data: draft } = await supabaseAdmin
      .from('lms_items').select('id, title, origin_item_id, submitted_by, review_state').eq('id', draftId).single();
    if (!draft) { res.status(404).json({ success: false, error: 'Not found' }); return; }
    if ((draft as any).review_state !== 'submitted') {
      res.status(400).json({ success: false, error: 'Not awaiting review' });
      return;
    }

    let liveId = draftId;
    if ((draft as any).origin_item_id) {
      // Apply the proposed changes onto the live item.
      liveId = await applyRevision(draftId);
    } else {
      // Brand-new content — publish it (mirrors POST /items/:id/publish).
      await supabaseAdmin
        .from('lms_items')
        .update({ status: 'published', published_at: new Date().toISOString(), review_state: 'none', review_note: null })
        .eq('id', draftId);
      const userIds = await resolveAudienceUserIds(draftId);
      if (userIds.length) {
        await supabaseAdmin
          .from('lms_assignments')
          .upsert(userIds.map((uid) => ({ item_id: draftId, user_id: uid })), { onConflict: 'item_id,user_id', ignoreDuplicates: true });
      }
      mirrorCourseItem(draftId).catch((e) => console.error('[lms-admin] mirror sync failed (approve):', e));
    }

    if ((draft as any).submitted_by) {
      await notifyLms(
        [{ user_id: (draft as any).submitted_by, type: 'lms_review_decided', title: `Approved: ${(draft as any).title}` }],
        liveId,
        req.userId!,
        { decision: 'approved' },
      );
    }
    res.json({ success: true, data: { live_item_id: liveId } });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const requestChangesSchema = z.object({ note: z.string().max(2000).optional() });

// POST /admin/lms/items/:id/request-changes — bounce back to the contributor.
router.post('/items/:id/request-changes', async (req: Request, res: Response) => {
  try {
    const draftId = req.params.id as string;
    const { note } = requestChangesSchema.parse(req.body);
    const { data: draft } = await supabaseAdmin
      .from('lms_items').select('id, title, submitted_by').eq('id', draftId).single();
    if (!draft) { res.status(404).json({ success: false, error: 'Not found' }); return; }

    await supabaseAdmin
      .from('lms_items')
      .update({ review_state: 'changes_requested', review_note: note ?? null })
      .eq('id', draftId);

    if ((draft as any).submitted_by) {
      await notifyLms(
        [{ user_id: (draft as any).submitted_by, type: 'lms_review_decided', title: `Changes requested: ${(draft as any).title}`, body: note ?? null }],
        draftId,
        req.userId!,
        { decision: 'changes_requested' },
      );
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return; }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /admin/lms/items/:id/reject — discard a clone, or park new content.
router.post('/items/:id/reject', async (req: Request, res: Response) => {
  try {
    const draftId = req.params.id as string;
    const { data: draft } = await supabaseAdmin
      .from('lms_items').select('id, title, origin_item_id, submitted_by').eq('id', draftId).single();
    if (!draft) { res.status(404).json({ success: false, error: 'Not found' }); return; }

    const submittedBy = (draft as any).submitted_by;
    if ((draft as any).origin_item_id) {
      await discardClone(draftId);
    } else {
      // Keep the draft but take it out of the queue so it can be revised/deleted.
      await supabaseAdmin
        .from('lms_items')
        .update({ review_state: 'none', review_note: null, submitted_by: null, submitted_at: null })
        .eq('id', draftId);
    }

    if (submittedBy) {
      await notifyLms(
        [{ user_id: submittedBy, type: 'lms_review_decided', title: `Not approved: ${(draft as any).title}` }],
        (draft as any).origin_item_id || draftId,
        req.userId!,
        { decision: 'rejected' },
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Reject error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ------------------------------------------------------------
// Move posts into a course
//
// "Adds" one or more standalone posts as lessons of a course. A post is an
// item with exactly one lesson; moving it is a re-parent — the lesson row's
// item_id flips from the post to the course (blocks, quiz questions and the
// lesson-level audience all reference lesson_id, so they travel with it). The
// now-empty post shell is then deleted.
//
// Only DRAFT posts can be moved: deleting a published post would drop its
// existing assignments (and learners' progress), so we require the admin to
// unpublish first.
// ------------------------------------------------------------

const importPostsSchema = z.object({
  post_ids: z.array(z.string().uuid()).min(1),
});

// POST /admin/lms/courses/:id/import-posts
router.post('/courses/:id/import-posts', async (req: Request, res: Response) => {
  try {
    const courseId = req.params.id;
    const { post_ids } = importPostsSchema.parse(req.body);

    // 1. Target must be a course.
    const { data: course, error: courseErr } = await supabaseAdmin
      .from('lms_items')
      .select('id, kind')
      .eq('id', courseId)
      .single();
    if (courseErr || !course) {
      res.status(404).json({ success: false, error: 'Course not found' });
      return;
    }
    if ((course as any).kind !== 'course') {
      res.status(400).json({ success: false, error: 'Target item is not a course' });
      return;
    }

    // 2. Load + validate the source posts (all must be draft posts).
    const { data: posts, error: postsErr } = await supabaseAdmin
      .from('lms_items')
      .select('id, kind, status, title')
      .in('id', post_ids);
    if (postsErr) {
      res.status(500).json({ success: false, error: postsErr.message });
      return;
    }

    const postMap = new Map((posts || []).map((p: any) => [p.id, p]));
    const missing = post_ids.filter((id) => !postMap.has(id));
    if (missing.length) {
      res.status(404).json({ success: false, error: 'One or more posts no longer exist' });
      return;
    }
    const notPosts = (posts || []).filter((p: any) => p.kind !== 'post');
    if (notPosts.length) {
      res.status(400).json({ success: false, error: 'Only posts can be added as lessons to a course' });
      return;
    }
    const published = (posts || []).filter((p: any) => p.status !== 'draft');
    if (published.length) {
      res.status(400).json({
        success: false,
        error: `Unpublish before moving into a course: ${published.map((p: any) => p.title).join(', ')}`,
      });
      return;
    }

    // 3. Append after the course's existing lessons.
    const { data: maxRow } = await supabaseAdmin
      .from('lms_lessons')
      .select('position')
      .eq('item_id', courseId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextPos = ((maxRow as any)?.position ?? -1) + 1;

    // 4. Re-parent each post's lesson(s) into the course, then delete the post
    //    shell. Order follows post_ids so the admin's selection order is kept.
    let movedLessons = 0;
    for (const postId of post_ids) {
      const { data: lessons, error: lessonsErr } = await supabaseAdmin
        .from('lms_lessons')
        .select('id')
        .eq('item_id', postId)
        .order('position', { ascending: true });
      if (lessonsErr) {
        res.status(500).json({ success: false, error: lessonsErr.message });
        return;
      }

      for (const lesson of lessons || []) {
        const { error: upErr } = await supabaseAdmin
          .from('lms_lessons')
          .update({ item_id: courseId, position: nextPos, is_active: true })
          .eq('id', (lesson as any).id);
        if (upErr) {
          res.status(500).json({ success: false, error: upErr.message });
          return;
        }
        nextPos += 1;
        movedLessons += 1;
      }

      // Lessons are already re-parented, so this only removes the empty post
      // shell (and its item-level audience/assignments via cascade).
      const { error: delErr } = await supabaseAdmin.from('lms_items').delete().eq('id', postId);
      if (delErr) {
        res.status(500).json({ success: false, error: delErr.message });
        return;
      }
    }

    // 5. Bump the course so it reflects the change (and bubbles to the top).
    await supabaseAdmin
      .from('lms_items')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', courseId);

    res.json({
      success: true,
      data: { course_id: courseId, moved_posts: post_ids.length, moved_lessons: movedLessons },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Import posts into course error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Lessons
// ============================================================

const lessonCreateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  summary: z.string().max(2000).nullable().optional(),
});

router.post('/items/:id/lessons', async (req: Request, res: Response) => {
  try {
    const body = lessonCreateSchema.parse(req.body);
    const itemId = req.params.id;

    const { data: maxRow } = await supabaseAdmin
      .from('lms_lessons')
      .select('position')
      .eq('item_id', itemId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = ((maxRow as any)?.position ?? -1) + 1;

    const { data, error } = await supabaseAdmin
      .from('lms_lessons')
      .insert({
        item_id: itemId,
        title: body.title || `Lesson ${nextPos + 1}`,
        summary: body.summary ?? null,
        position: nextPos,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.status(201).json({ success: true, data: { ...data, blocks: [] } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const lessonUpdateSchema = lessonCreateSchema.extend({
  position: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
});

router.patch('/lessons/:id', async (req: Request, res: Response) => {
  try {
    const body = lessonUpdateSchema.parse(req.body);
    const patch: Record<string, any> = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.summary !== undefined) patch.summary = body.summary;
    if (body.position !== undefined) patch.position = body.position;
    if (body.is_active !== undefined) patch.is_active = body.is_active;

    const { data, error } = await supabaseAdmin
      .from('lms_lessons')
      .update(patch)
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
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/lessons/:id', async (req: Request, res: Response) => {
  const { error } = await supabaseAdmin.from('lms_lessons').delete().eq('id', req.params.id);
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true });
});

const reorderSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), position: z.number().int().min(0) })),
});

router.put('/items/:id/lessons/reorder', async (req: Request, res: Response) => {
  try {
    const { items } = reorderSchema.parse(req.body);
    for (const it of items) {
      const { error } = await supabaseAdmin
        .from('lms_lessons')
        .update({ position: it.position })
        .eq('id', it.id)
        .eq('item_id', req.params.id);
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /admin/lms/lessons/:id/audience — restrict a lesson to a subset of the
// course audience. Empty arrays clear the restriction (visible to everyone).
router.put('/lessons/:id/audience', async (req: Request, res: Response) => {
  try {
    const body = audienceSchema.parse(req.body);
    const lessonId = req.params.id;

    const { error: delTypesErr } = await supabaseAdmin
      .from('lms_lesson_audience_types')
      .delete()
      .eq('lesson_id', lessonId);
    if (delTypesErr) {
      res.status(500).json({ success: false, error: delTypesErr.message });
      return;
    }

    const { error: delUsersErr } = await supabaseAdmin
      .from('lms_lesson_audience_users')
      .delete()
      .eq('lesson_id', lessonId);
    if (delUsersErr) {
      res.status(500).json({ success: false, error: delUsersErr.message });
      return;
    }

    if (body.user_types.length) {
      const rows = body.user_types.map((t) => ({ lesson_id: lessonId, user_type: t }));
      const { error } = await supabaseAdmin.from('lms_lesson_audience_types').insert(rows);
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
    }

    if (body.user_ids.length) {
      const rows = body.user_ids.map((uid) => ({ lesson_id: lessonId, user_id: uid }));
      const { error } = await supabaseAdmin.from('lms_lesson_audience_users').insert(rows);
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
    }

    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Set lesson audience error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Content blocks
// ============================================================

const blockCreateSchema = z.object({
  type: z.enum(BLOCK_TYPES),
  text_content: z.any().optional(),
  file_url: z.string().nullable().optional(),
  file_name: z.string().nullable().optional(),
  file_size: z.number().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  embed_url: z.string().nullable().optional(),
  embed_provider: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

router.post('/lessons/:id/blocks', async (req: Request, res: Response) => {
  try {
    const body = blockCreateSchema.parse(req.body);
    const lessonId = req.params.id;

    const { data: maxRow } = await supabaseAdmin
      .from('lms_content_blocks')
      .select('position')
      .eq('lesson_id', lessonId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = ((maxRow as any)?.position ?? -1) + 1;

    const { data, error } = await supabaseAdmin
      .from('lms_content_blocks')
      .insert({
        lesson_id: lessonId,
        type: body.type,
        position: nextPos,
        text_content: body.text_content ?? null,
        file_url: body.file_url ?? null,
        file_name: body.file_name ?? null,
        file_size: body.file_size ?? null,
        mime_type: body.mime_type ?? null,
        embed_url: body.embed_url ?? null,
        embed_provider: body.embed_provider ?? null,
        caption: body.caption ?? null,
        metadata: body.metadata ?? {},
      })
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
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const blockUpdateSchema = blockCreateSchema.partial().extend({
  position: z.number().int().min(0).optional(),
});

router.patch('/blocks/:id', async (req: Request, res: Response) => {
  try {
    const body = blockUpdateSchema.parse(req.body);
    const patch: Record<string, any> = {};
    for (const key of [
      'type', 'text_content', 'file_url', 'file_name', 'file_size', 'mime_type',
      'embed_url', 'embed_provider', 'caption', 'metadata', 'position',
    ] as const) {
      if ((body as any)[key] !== undefined) patch[key] = (body as any)[key];
    }

    const { data, error } = await supabaseAdmin
      .from('lms_content_blocks')
      .update(patch)
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
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/blocks/:id', async (req: Request, res: Response) => {
  const { error } = await supabaseAdmin.from('lms_content_blocks').delete().eq('id', req.params.id);
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true });
});

router.put('/lessons/:id/blocks/reorder', async (req: Request, res: Response) => {
  try {
    const { items } = reorderSchema.parse(req.body);
    for (const it of items) {
      const { error } = await supabaseAdmin
        .from('lms_content_blocks')
        .update({ position: it.position })
        .eq('id', it.id)
        .eq('lesson_id', req.params.id);
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Quiz questions
// ============================================================

const questionSchema = z.object({
  prompt: z.string().min(1),
  options: z.array(z.object({ id: z.string(), text: z.string() })).min(2),
  correct_option_id: z.string(),
  explanation: z.string().nullable().optional(),
});

router.post('/blocks/:id/quiz-questions', async (req: Request, res: Response) => {
  try {
    const body = questionSchema.parse(req.body);
    const blockId = req.params.id;

    const { data: maxRow } = await supabaseAdmin
      .from('lms_quiz_questions')
      .select('position')
      .eq('block_id', blockId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = ((maxRow as any)?.position ?? -1) + 1;

    const { data, error } = await supabaseAdmin
      .from('lms_quiz_questions')
      .insert({
        block_id: blockId,
        position: nextPos,
        prompt: body.prompt,
        options: body.options,
        correct_option_id: body.correct_option_id,
        explanation: body.explanation ?? null,
      })
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
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.patch('/quiz-questions/:id', async (req: Request, res: Response) => {
  try {
    const body = questionSchema.partial().parse(req.body);
    const patch: Record<string, any> = {};
    for (const key of ['prompt', 'options', 'correct_option_id', 'explanation'] as const) {
      if ((body as any)[key] !== undefined) patch[key] = (body as any)[key];
    }

    const { data, error } = await supabaseAdmin
      .from('lms_quiz_questions')
      .update(patch)
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
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/quiz-questions/:id', async (req: Request, res: Response) => {
  const { error } = await supabaseAdmin.from('lms_quiz_questions').delete().eq('id', req.params.id);
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true });
});

// ============================================================
// User search (for audience picker)
// ============================================================

router.get('/users/search', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string | undefined)?.trim() || '';
    const userTypeFilter = req.query.user_type as string | undefined;

    let query = supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url, user_type, status')
      .neq('status', 'banned')
      .neq('status', 'suspended')
      .order('display_name', { ascending: true })
      .limit(50);

    if (q) {
      query = query.or(`display_name.ilike.%${q}%,email.ilike.%${q}%`);
    }
    if (userTypeFilter) {
      query = query.eq('user_type', userTypeFilter);
    }

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
