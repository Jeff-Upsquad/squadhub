import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

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

    let query = supabaseAdmin
      .from('lms_items')
      .select(`
        *,
        category:lms_categories(id, name, color, slug)
      `)
      .order('updated_at', { ascending: false });

    if (kindFilter) query = query.eq('kind', kindFilter);
    if (statusFilter) query = query.eq('status', statusFilter);
    if (categoryFilter) query = query.eq('category_id', categoryFilter);

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
});

router.patch('/lessons/:id', async (req: Request, res: Response) => {
  try {
    const body = lessonUpdateSchema.parse(req.body);
    const patch: Record<string, any> = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.summary !== undefined) patch.summary = body.summary;
    if (body.position !== undefined) patch.position = body.position;

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
