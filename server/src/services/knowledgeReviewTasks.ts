import { supabaseAdmin } from '../supabase';
import { mirrorResourceRecipient } from './taskMirror';

type Change = { item_id: string; page_key: string; lesson_id: string | null; revision: number; processed_revision: number };

/** Turn database-captured edits into one reusable Resources task per document/page. */
export async function reconcileKnowledgeReviews(): Promise<number> {
  const { data: config, error: configError } = await supabaseAdmin
    .from('lms_knowledge_review_config').select('reviewer_user_id').eq('singleton', true).maybeSingle();
  if (configError) throw configError;
  if (!config?.reviewer_user_id) throw new Error('Knowledge review owner is not configured');
  const reviewerId = config.reviewer_user_id as string;

  const { data: changes, error } = await supabaseAdmin
    .from('lms_knowledge_review_changes').select('*')
    .is('processed_at', null)
    .order('changed_at', { ascending: true }).limit(200);
  if (error) throw error;
  let processed = 0;
  for (const change of (changes || []) as Change[]) {
    if (change.revision <= change.processed_revision) continue;
    const { data: item, error: itemError } = await supabaseAdmin
      .from('lms_items').select('id, title, track, status, origin_item_id')
      .eq('id', change.item_id).maybeSingle();
    if (itemError) throw itemError;
    if (!item || item.track !== 'knowledge' || item.origin_item_id || item.status === 'archived') {
      await markProcessed(change);
      continue;
    }

    let lesson: { id: string; title: string } | null = null;
    if (change.lesson_id) {
      const result = await supabaseAdmin.from('lms_lessons').select('id, title')
        .eq('id', change.lesson_id).eq('item_id', change.item_id).maybeSingle();
      if (result.error) throw result.error;
      lesson = result.data;
      if (!lesson) { await markProcessed(change); continue; }
    }

    // An explicit share makes published docs appear in the reviewer's Resources
    // catalog. Admin access also lets them inspect draft pages before publish.
    const { error: shareError } = await supabaseAdmin.from('lms_item_shares').upsert({
      item_id: item.id, principal_type: 'user', principal_id: reviewerId,
      access_level: 'admin', granted_by: reviewerId,
    }, { onConflict: 'item_id,principal_type,principal_id', ignoreDuplicates: true });
    if (shareError) throw shareError;

    const key = `${item.id}:${change.page_key}`;
    const title = lesson ? `Review knowledge page: ${lesson.title}` : `Review knowledge doc: ${item.title}`;
    const { data: existing, error: lookupError } = await supabaseAdmin.from('lms_task_sends')
      .select('id, version').eq('knowledge_review_key', key).maybeSingle();
    if (lookupError) throw lookupError;
    let sendId: string;
    let version: number;
    if (existing) {
      sendId = existing.id;
      version = existing.version + 1;
      const { error: updateError } = await supabaseAdmin.from('lms_task_sends')
        .update({ title, version }).eq('id', sendId);
      if (updateError) throw updateError;
    } else {
      const { data: inserted, error: insertError } = await supabaseAdmin.from('lms_task_sends').insert({
        item_id: item.id, scope: lesson ? 'lesson' : 'item', lesson_id: lesson?.id ?? null,
        title, due_date: null, auto_resend: false,
        picked_principals: [{ type: 'user', id: reviewerId }],
        source_kind: 'knowledge', knowledge_review_key: key,
        version: 1, created_by: reviewerId,
      }).select('id, version').single();
      if (insertError || !inserted) throw insertError || new Error('Could not create knowledge review send');
      sendId = inserted.id;
      version = inserted.version;
    }

    const { data: recipient, error: recipientError } = await supabaseAdmin
      .from('lms_task_send_recipients')
      .upsert({ send_id: sendId, user_id: reviewerId, version }, { onConflict: 'send_id,user_id' })
      .select('id').single();
    if (recipientError || !recipient) throw recipientError || new Error('Could not assign knowledge review');
    await mirrorResourceRecipient(recipient.id, { reopen: !!existing });
    const { data: task, error: taskError } = await supabaseAdmin.from('tasks')
      .select('id').eq('source_kind', 'knowledge').eq('source_id', recipient.id)
      .eq('source_user_id', reviewerId).maybeSingle();
    if (taskError || !task) throw taskError || new Error('Could not create the knowledge review task');
    await markProcessed(change);
    processed += 1;
  }
  return processed;
}

async function markProcessed(change: Change): Promise<void> {
  const { error } = await supabaseAdmin.from('lms_knowledge_review_changes')
    .update({ processed_revision: change.revision, processed_at: new Date().toISOString() })
    .eq('item_id', change.item_id).eq('page_key', change.page_key)
    .eq('revision', change.revision);
  if (error) throw error;
}
