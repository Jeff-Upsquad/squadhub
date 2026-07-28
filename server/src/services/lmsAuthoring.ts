import { supabaseAdmin } from '../supabase';
import type { NotificationType } from '@squadhub/shared';

// ============================================================
// Shared authoring logic for the contributor "submit for review" flow.
//
// A contributor edits a DRAFT CLONE of a live item (a full deep copy with
// origin_item_id set). On approval the clone's content is applied back onto
// the live item by re-parenting its lessons; on rejection the clone is
// discarded. Reuses the lesson re-parenting technique proven in
// lms-admin.ts `POST /courses/:id/import-posts`.
// ============================================================

function slugifyBase(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || `item-${Date.now()}`
  );
}

async function ensureUniqueSlug(base: string, ignoreId?: string): Promise<string> {
  let candidate = base;
  let suffix = 1;
  while (true) {
    const { data } = await supabaseAdmin.from('lms_items').select('id').eq('slug', candidate).limit(1);
    const conflict = (data || []).find((r: any) => r.id !== ignoreId);
    if (!conflict) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

/**
 * Insert notification rows (excluding the actor). Mirrors the pattern in
 * meetings_events.ts. reference_type 'lms_item' matches the existing
 * lms_assigned / lms_updated notifications.
 */
export async function notifyLms(
  rows: { user_id: string; type: NotificationType; title: string; body?: string | null }[],
  itemId: string,
  actorId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const seen = new Set<string>();
  const filtered = rows.filter((r) => {
    if (!r.user_id || r.user_id === actorId || seen.has(r.user_id)) return false;
    seen.add(r.user_id);
    return true;
  });
  if (!filtered.length) return;
  await supabaseAdmin.from('notifications').insert(
    filtered.map((r) => ({
      user_id: r.user_id,
      type: r.type,
      reference_id: itemId,
      reference_type: 'lms_item',
      actor_id: actorId,
      title: r.title,
      body: r.body ?? null,
      metadata: { item_id: itemId, ...metadata },
    })),
  );
}

/** The single open draft clone for a live item, if one exists. */
export async function getOpenClone(originId: string): Promise<any | null> {
  const { data } = await supabaseAdmin
    .from('lms_items')
    .select('*')
    .eq('origin_item_id', originId)
    .in('review_state', ['draft', 'submitted', 'changes_requested'])
    .maybeSingle();
  return data || null;
}

/**
 * Create (or return the existing) draft clone of a live item for a contributor
 * to edit. Deep-copies lessons, blocks and quiz questions.
 */
export async function cloneItemForReview(originId: string, userId: string): Promise<any> {
  const existing = await getOpenClone(originId);
  if (existing) return existing;

  const { data: origin, error: originErr } = await supabaseAdmin
    .from('lms_items')
    .select('*')
    .eq('id', originId)
    .single();
  if (originErr || !origin) throw new Error('Origin item not found');

  const slug = await ensureUniqueSlug(`${slugifyBase((origin as any).slug || (origin as any).title)}-draft`);

  const { data: clone, error: cloneErr } = await supabaseAdmin
    .from('lms_items')
    .insert({
      kind: (origin as any).kind,
      track: (origin as any).track,
      title: (origin as any).title,
      slug,
      summary: (origin as any).summary,
      cover_image_url: (origin as any).cover_image_url,
      category_id: (origin as any).category_id,
      status: 'draft',
      review_state: 'draft',
      origin_item_id: originId,
      created_by: userId,
    })
    .select()
    .single();
  if (cloneErr || !clone) throw new Error(cloneErr?.message || 'Failed to create draft');

  // The lms_auto_create_post_lesson trigger seeds a lesson for kind='post';
  // clear it so the deep-copy below is the sole source of lessons.
  await supabaseAdmin.from('lms_lessons').delete().eq('item_id', (clone as any).id);

  await deepCopyLessons(originId, (clone as any).id);
  return clone;
}

/** Copy every lesson + block (+ quiz questions) of `fromItemId` onto `toItemId`. */
async function deepCopyLessons(fromItemId: string, toItemId: string): Promise<void> {
  const { data: lessons } = await supabaseAdmin
    .from('lms_lessons')
    .select('*')
    .eq('item_id', fromItemId)
    .order('position', { ascending: true });

  for (const lesson of lessons || []) {
    const { data: newLesson } = await supabaseAdmin
      .from('lms_lessons')
      .insert({
        item_id: toItemId,
        title: (lesson as any).title,
        summary: (lesson as any).summary,
        position: (lesson as any).position,
        is_active: (lesson as any).is_active,
      })
      .select()
      .single();
    if (!newLesson) continue;

    const { data: blocks } = await supabaseAdmin
      .from('lms_content_blocks')
      .select('*')
      .eq('lesson_id', (lesson as any).id)
      .order('position', { ascending: true });

    for (const b of blocks || []) {
      const { data: newBlock } = await supabaseAdmin
        .from('lms_content_blocks')
        .insert({
          lesson_id: (newLesson as any).id,
          type: (b as any).type,
          position: (b as any).position,
          text_content: (b as any).text_content,
          file_url: (b as any).file_url,
          file_name: (b as any).file_name,
          file_size: (b as any).file_size,
          mime_type: (b as any).mime_type,
          embed_url: (b as any).embed_url,
          embed_provider: (b as any).embed_provider,
          caption: (b as any).caption,
          metadata: (b as any).metadata,
        })
        .select()
        .single();
      if (!newBlock || (b as any).type !== 'quiz') continue;

      const { data: questions } = await supabaseAdmin
        .from('lms_quiz_questions')
        .select('*')
        .eq('block_id', (b as any).id)
        .order('position', { ascending: true });
      for (const q of questions || []) {
        await supabaseAdmin.from('lms_quiz_questions').insert({
          block_id: (newBlock as any).id,
          position: (q as any).position,
          prompt: (q as any).prompt,
          options: (q as any).options,
          correct_option_id: (q as any).correct_option_id,
          explanation: (q as any).explanation,
        });
      }
    }
  }
}

/**
 * Apply an approved clone onto its origin: copy metadata, re-parent the clone's
 * lessons onto the origin, drop the origin's old lessons, then delete the clone
 * shell. Ordered so the origin is never left with zero lessons mid-flight.
 * Returns the origin item id.
 *
 * Known limitation: learner progress and lesson-level audience on the replaced
 * lessons are reset (new lesson ids), same as any content republish.
 */
export async function applyRevision(cloneId: string): Promise<string> {
  const { data: clone, error: cloneErr } = await supabaseAdmin
    .from('lms_items')
    .select('*')
    .eq('id', cloneId)
    .single();
  if (cloneErr || !clone) throw new Error('Draft not found');
  const originId = (clone as any).origin_item_id as string | null;
  if (!originId) throw new Error('Draft has no origin to apply onto');

  // Capture the origin's current lessons so we can delete exactly them after
  // the clone's lessons are safely attached.
  const { data: oldLessons } = await supabaseAdmin
    .from('lms_lessons')
    .select('id')
    .eq('item_id', originId);
  const oldLessonIds = (oldLessons || []).map((l: any) => l.id);

  // 1. Copy metadata clone -> origin (keep origin slug/status/kind/track).
  await supabaseAdmin
    .from('lms_items')
    .update({
      title: (clone as any).title,
      summary: (clone as any).summary,
      cover_image_url: (clone as any).cover_image_url,
      category_id: (clone as any).category_id,
      review_state: 'none',
      review_note: null,
      submitted_by: null,
      submitted_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', originId);

  // 2. Re-parent the clone's lessons onto the origin (blocks/quiz follow via FK).
  await supabaseAdmin.from('lms_lessons').update({ item_id: originId }).eq('item_id', cloneId);

  // 3. Drop the origin's previous lessons (cascades their blocks/quiz/progress).
  if (oldLessonIds.length) {
    await supabaseAdmin.from('lms_lessons').delete().in('id', oldLessonIds);
  }

  // 4. Remove the now-empty clone shell.
  await supabaseAdmin.from('lms_items').delete().eq('id', cloneId);

  return originId;
}

/** Discard a rejected clone (and its lessons/blocks via cascade). */
export async function discardClone(cloneId: string): Promise<void> {
  await supabaseAdmin.from('lms_items').delete().eq('id', cloneId);
}
