import { config } from '../config';
import { supabaseAdmin } from '../supabase';

/**
 * Deliver a Resources item to SquadHire as talent training.
 *
 * SquadHire talents aren't SquadHub users, so they can't be reached through
 * item sharing. An item flagged `squadhire_audience` is pushed over the same
 * signed server-to-server channel the card and job webhooks already use, and
 * lands in their Training Program.
 *
 * We send CONTENT ONLY. Who the course reaches, what module it unlocks and
 * whether it gates onboarding are SquadHire's decisions; their ingest
 * deliberately ignores anything else we might send, and a republish never
 * disturbs their gating.
 *
 * Delivery is best-effort and never blocks the author: a failure is recorded
 * on the row (`squadhire_last_error`) and the next publish retries. There is
 * no queue here on purpose — the payload is a full snapshot, so the newest
 * push always wins and a missed one costs nothing but staleness.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const SYNC_PATH = '/api/integrations/squadhub/training/sync';

function squadhireUrl(): string | null {
  if (!config.squadhireWebhookUrl || !config.squadhireWebhookSecret) return null;
  const url = new URL(config.squadhireWebhookUrl);
  url.pathname = SYNC_PATH;
  url.search = '';
  return url.toString();
}

/** Fire a sync without making the caller wait or fail on it. */
export function syncItemToSquadhire(itemId: string): void {
  void deliver(itemId).catch((err) => {
    console.error('[squadhire-training] delivery failed:', err?.message ?? err);
  });
}

export async function deliver(itemId: string): Promise<void> {
  const endpoint = squadhireUrl();
  if (!endpoint) return; // integration not configured in this environment

  const { data: item } = await supabaseAdmin
    .from('lms_items')
    .select('id, kind, track, title, summary, icon, cover_image_url, status, squadhire_audience')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return;

  // Not (or no longer) talent-facing. Still tell SquadHire, so an item that
  // had the flag removed disappears for talents instead of lingering.
  const visible = item.squadhire_audience === true && item.status === 'published';

  const payload = {
    id: item.id,
    kind: item.kind,
    track: item.track,
    title: item.title,
    summary: item.summary ?? null,
    icon: item.icon ?? null,
    cover_image_url: item.cover_image_url ?? null,
    visible,
    pages: visible ? await loadPages(itemId) : [],
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret as string,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`SquadHire responded ${res.status}: ${text.slice(0, 300)}`);
    }

    await supabaseAdmin
      .from('lms_items')
      .update({ squadhire_synced_at: new Date().toISOString(), squadhire_last_error: null })
      .eq('id', itemId);
  } catch (err: any) {
    await supabaseAdmin
      .from('lms_items')
      .update({ squadhire_last_error: String(err?.message ?? err).slice(0, 500) })
      .eq('id', itemId);
    throw err;
  }
}

/**
 * The item's pages with their blocks, language variants and quiz questions.
 *
 * Draft pages (`is_active = false`) are left out — they aren't visible to
 * SquadHub learners either. Quiz answers ARE included: SquadHire grades
 * submissions on its own server and needs them, and this is a signed
 * server-to-server channel, not something a learner can read.
 */
async function loadPages(itemId: string) {
  const { data: lessons } = await supabaseAdmin
    .from('lms_lessons')
    .select('id, parent_lesson_id, title, summary, icon, position, is_active')
    .eq('item_id', itemId)
    .order('position', { ascending: true });

  const visibleLessons = (lessons ?? []).filter((l: any) => l.is_active !== false);
  const lessonIds = visibleLessons.map((l: any) => l.id);
  if (lessonIds.length === 0) return [];

  const { data: blocks } = await supabaseAdmin
    .from('lms_content_blocks')
    .select('*')
    .in('lesson_id', lessonIds)
    .order('position', { ascending: true });

  const allBlocks = (blocks ?? []) as any[];
  const blockIds = allBlocks.map((b) => b.id);

  const [videosRes, questionsRes] = await Promise.all([
    blockIds.length
      ? supabaseAdmin.from('lms_content_block_videos').select('*').in('block_id', blockIds)
      : Promise.resolve({ data: [] as any[] }),
    blockIds.length
      ? supabaseAdmin
          .from('lms_quiz_questions')
          .select('id, block_id, position, prompt, options, correct_option_id, explanation')
          .in('block_id', blockIds)
          .order('position', { ascending: true })
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const videosByBlock = new Map<string, any[]>();
  for (const v of videosRes.data ?? []) {
    const list = videosByBlock.get(v.block_id) ?? [];
    list.push(v);
    videosByBlock.set(v.block_id, list);
  }
  const questionsByBlock = new Map<string, any[]>();
  for (const q of questionsRes.data ?? []) {
    const list = questionsByBlock.get(q.block_id) ?? [];
    list.push(q);
    questionsByBlock.set(q.block_id, list);
  }

  const blocksByLesson = new Map<string, any[]>();
  for (const b of allBlocks) {
    const list = blocksByLesson.get(b.lesson_id) ?? [];
    list.push({
      id: b.id,
      type: b.type,
      position: b.position,
      text_content: b.text_content ?? null,
      file_url: b.file_url ?? null,
      file_name: b.file_name ?? null,
      file_size: b.file_size ?? null,
      mime_type: b.mime_type ?? null,
      embed_url: b.embed_url ?? null,
      embed_provider: b.embed_provider ?? null,
      caption: b.caption ?? null,
      metadata: b.metadata ?? {},
      videos: (videosByBlock.get(b.id) ?? []).map((v) => ({
        language: v.language,
        embed_url: v.embed_url ?? null,
        embed_provider: v.embed_provider ?? null,
        file_url: v.file_url ?? null,
        file_name: v.file_name ?? null,
        file_size: v.file_size ?? null,
        mime_type: v.mime_type ?? null,
      })),
      quiz_questions: (questionsByBlock.get(b.id) ?? []).map((q) => ({
        id: q.id,
        position: q.position,
        prompt: q.prompt,
        options: q.options ?? [],
        correct_option_id: q.correct_option_id,
        explanation: q.explanation ?? null,
      })),
    });
    blocksByLesson.set(b.lesson_id, list);
  }

  // A page whose parent was filtered out as a draft is promoted to the root,
  // so hiding a heading never hides the pages beneath it.
  const present = new Set(lessonIds);

  return visibleLessons.map((l: any) => ({
    id: l.id,
    parent_id: l.parent_lesson_id && present.has(l.parent_lesson_id) ? l.parent_lesson_id : null,
    title: l.title,
    summary: l.summary ?? null,
    icon: l.icon ?? null,
    position: l.position ?? 0,
    blocks: blocksByLesson.get(l.id) ?? [],
  }));
}
