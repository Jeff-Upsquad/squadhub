import { supabaseAdmin } from '../supabase';
import { deliver } from './squadhireTraining';
import { HIRING_BOT_SLUG, botIdForSlug } from './squadBots';

/**
 * Create a published Knowledge item from an answer an admin approved in
 * SquadHire (Squad Bot's learning loop: a question the bot handed to the team,
 * answered by a person, drafted as a Q&A, approved). SquadHub stays the home of
 * all knowledge, so the item is created here and synced back like any other.
 */

export interface ApprovedKnowledge {
  question: string;
  answer: string;
  categories: string[];
}

/** Plain text → Tiptap doc: blank-line paragraphs, "- " bullets, "1. " numbered items. */
export function answerToDoc(answer: string) {
  const content: any[] = [];
  const text = (t: string) => (t ? [{ type: 'text', text: t }] : []);
  for (const chunk of answer.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const bullets = lines.every((l) => /^[-•*]\s+/.test(l));
    const numbered = lines.every((l) => /^\d+[.)]\s+/.test(l));
    if (bullets || numbered) {
      content.push({
        type: numbered ? 'orderedList' : 'bulletList',
        content: lines.map((l) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: text(l.replace(/^([-•*]|\d+[.)])\s+/, '')) }],
        })),
      });
    } else {
      const inline: any[] = [];
      lines.forEach((l, i) => {
        if (i) inline.push({ type: 'hardBreak' });
        inline.push(...text(l));
      });
      content.push({ type: 'paragraph', content: inline });
    }
  }
  return { type: 'doc', content };
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'answer';
}

async function uniqueSlug(base: string) {
  for (let i = 1; ; i++) {
    const slug = i === 1 ? `kb-${base}` : `kb-${base}-${i}`;
    const { data } = await supabaseAdmin.from('lms_items').select('id').eq('slug', slug).maybeSingle();
    if (!data) return slug;
  }
}

export async function createApprovedKnowledge(input: ApprovedKnowledge): Promise<string> {
  const now = new Date().toISOString();
  const { data: item, error } = await supabaseAdmin
    .from('lms_items')
    .insert({
      kind: 'post',
      track: 'knowledge',
      // Answers approved in SquadHire are the Squad Hiring Bot's knowledge.
      bot_id: await botIdForSlug(HIRING_BOT_SLUG),
      knowledge_categories: input.categories,
      title: input.question,
      slug: await uniqueSlug(slugify(input.question)),
      status: 'published',
      published_at: now,
    })
    .select('id')
    .single();
  if (error || !item) throw new Error(`Could not create the knowledge item: ${error?.message}`);

  // lms_auto_create_post_lesson made the post's single page; fill it and make it live.
  const { data: lesson } = await supabaseAdmin
    .from('lms_lessons')
    .select('id')
    .eq('item_id', item.id)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!lesson) throw new Error('The knowledge item has no page');
  await supabaseAdmin.from('lms_lessons').update({ is_active: true }).eq('id', lesson.id);
  const { error: blockErr } = await supabaseAdmin
    .from('lms_content_blocks')
    .insert({ lesson_id: lesson.id, type: 'text', position: 0, text_content: answerToDoc(input.answer) });
  if (blockErr) throw new Error(`Could not save the answer: ${blockErr.message}`);

  // Push it to SquadHire now so Squad Bot can use it straight away. A failed
  // push is recorded on the item (squadhire_last_error) and retried on the
  // next edit — the item itself exists either way.
  await deliver(item.id).catch((err) => console.error('[knowledge-from-squadhire] sync failed:', err?.message ?? err));
  return item.id as string;
}
