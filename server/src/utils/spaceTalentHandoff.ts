// ============================================================
// spaceTalentHandoff
//
// When the talent on a subscription card changes (or the card is reopened to
// source a new one), the card swap alone doesn't move the actual work in the
// linked Design/Video space. This helper hands the space off from the outgoing
// talent to the incoming one:
//
//   1. repoint the folder's auto_assignee_ids so NEW tasks route to the new
//      talent (or nobody, when reopening with no replacement yet),
//   2. reassign the outgoing talent's OPEN tasks in the folder to the new one,
//   3. grant the new talent client access + revoke the old talent's.
//
// Recipients are resolved to a SquadHub users.id: partners already carry it;
// talents are matched by the email SquadHire returned for them (mirrors the
// auto-accept-talent resolution). Best-effort throughout — never throws, since
// the assignment/billing change it follows has already succeeded.
// ============================================================
import { supabaseAdmin } from '../supabase';
import { sharePartnerWithCardClient } from './sharePartnerWithClient';

type RecipientType = 'talent' | 'partner' | null;

interface HandoffInput {
  cardId: string;
  oldRecipientType: RecipientType;
  oldRecipientId: string | null;
  newRecipientType: RecipientType;
  newRecipientId: string | null;
}

// Resolve a card recipient to a SquadHub users.id. Partners already carry the
// user id; talents are matched by the email on their card recipient row.
async function resolveRecipientUserId(
  cardId: string,
  type: RecipientType,
  id: string | null,
): Promise<string | null> {
  if (!type || !id) return null;
  if (type === 'partner') return id;
  const { data: rec } = await supabaseAdmin
    .from('subscription_card_external_recipients')
    .select('email')
    .eq('card_id', cardId)
    .eq('external_user_id', id)
    .maybeSingle();
  const email = (rec as any)?.email as string | undefined;
  if (!email) return null;
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .ilike('email', email)
    .eq('status', 'active')
    .maybeSingle();
  return (user as any)?.id ?? null;
}

// card → submission_subscription → submission → client.
async function resolveCardClientId(cardId: string): Promise<string | null> {
  const { data: card } = await supabaseAdmin
    .from('subscription_cards')
    .select('submission_subscription_id')
    .eq('id', cardId)
    .maybeSingle();
  const subSubId = (card as any)?.submission_subscription_id as string | undefined;
  if (!subSubId) return null;
  const { data: staged } = await supabaseAdmin
    .from('client_submission_subscriptions')
    .select('submission_id')
    .eq('id', subSubId)
    .maybeSingle();
  const submissionId = (staged as any)?.submission_id as string | undefined;
  if (!submissionId) return null;
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('submission_id', submissionId)
    .maybeSingle();
  return (client as any)?.id ?? null;
}

export async function handOffSpaceToNewTalent(input: HandoffInput): Promise<void> {
  const { cardId } = input;
  try {
    const [oldUserId, newUserId] = await Promise.all([
      resolveRecipientUserId(cardId, input.oldRecipientType, input.oldRecipientId),
      resolveRecipientUserId(cardId, input.newRecipientType, input.newRecipientId),
    ]);

    // --- Client access: grant the new user, revoke the outgoing one ---
    if (newUserId) {
      await sharePartnerWithCardClient(newUserId, cardId);
    }
    if (oldUserId && oldUserId !== newUserId) {
      const clientId = await resolveCardClientId(cardId);
      if (clientId) {
        await supabaseAdmin
          .from('partner_client_assignments')
          .delete()
          .eq('user_id', oldUserId)
          .eq('client_id', clientId);
      }
    }

    // --- Space work: repoint auto-assign + reassign open tasks ---
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('linked_folder_id')
      .eq('id', cardId)
      .maybeSingle();
    const folderId = (card as any)?.linked_folder_id as string | null;
    if (!folderId) return;

    const { data: folder } = await supabaseAdmin
      .from('folders')
      .select('id, space_id, auto_assignee_ids')
      .eq('id', folderId)
      .maybeSingle();
    if (!folder) return;

    // Repoint the folder default assignee: drop the old talent, add the new one.
    const currentAuto: string[] = Array.isArray((folder as any).auto_assignee_ids)
      ? (folder as any).auto_assignee_ids
      : [];
    const nextAuto = currentAuto.filter((uid) => uid !== oldUserId);
    if (newUserId && !nextAuto.includes(newUserId)) nextAuto.push(newUserId);
    await supabaseAdmin.from('folders').update({ auto_assignee_ids: nextAuto }).eq('id', folderId);

    if (!oldUserId) return; // nothing more to move

    // Names of statuses that mean "done" for this space — used to skip completed
    // tasks so we don't rewrite who finished past work.
    const doneNames = new Set<string>();
    const spaceId = (folder as any).space_id as string | null;
    if (spaceId) {
      const { data: statuses } = await supabaseAdmin
        .from('space_statuses')
        .select('name, category')
        .eq('space_id', spaceId);
      (statuses || []).forEach((s: any) => {
        if (s.category === 'done' || s.category === 'closed') doneNames.add(s.name);
      });
    }

    const { data: lists } = await supabaseAdmin
      .from('lists')
      .select('id')
      .eq('folder_id', folderId);
    const listIds = (lists || []).map((l: any) => l.id);
    if (!listIds.length) return;

    const { data: tasks } = await supabaseAdmin
      .from('tasks')
      .select('id, status, assignee_ids')
      .in('list_id', listIds)
      .contains('assignee_ids', [oldUserId]);

    for (const t of (tasks || []) as any[]) {
      // Skip completed tasks: 'closed' catalog key or a done/closed space status.
      if (t.status === 'closed' || doneNames.has(t.status)) continue;
      const ids: string[] = Array.isArray(t.assignee_ids) ? t.assignee_ids : [];
      const updated = ids.filter((uid) => uid !== oldUserId);
      if (newUserId && !updated.includes(newUserId)) updated.push(newUserId);
      await supabaseAdmin.from('tasks').update({ assignee_ids: updated }).eq('id', t.id);
    }
  } catch (err) {
    console.error('[spaceTalentHandoff] handOffSpaceToNewTalent failed', cardId, err);
  }
}
