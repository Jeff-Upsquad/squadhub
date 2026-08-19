/**
 * Copy Squad CRM lead/deal owners onto Hub subscription / assignment / job cards.
 *
 * Resolution (first match wins):
 *   1. Open CRM deal spawned from the matching lead (live commercial owner)
 *   2. The CRM lead itself (assignee_id + collaborator_ids)
 *   3. Hub contact primary/secondary sales people
 *
 * Never throws — card create must succeed even if CRM is unreachable.
 */

import { supabaseAdmin } from '../supabase';
import { resolveCrmLead } from './clientExternalLinks';

export type CardCrmAssignees = {
  assignee_id: string | null;
  collaborator_ids: string[];
};

export const EMPTY_CARD_ASSIGNEES: CardCrmAssignees = {
  assignee_id: null,
  collaborator_ids: [],
};

export type CardAssigneeUser = {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export function normalizeCardAssignees(
  assigneeId: string | null | undefined,
  collaboratorIds: string[] | null | undefined,
): CardCrmAssignees {
  const primary = assigneeId || null;
  const rest = Array.from(
    new Set((collaboratorIds || []).filter((id) => id && id !== primary)),
  );
  return { assignee_id: primary, collaborator_ids: rest };
}

export async function resolveCrmCardAssignees(input: {
  submissionId?: string | null;
  crmLeadId?: string | null;
  email?: string | null;
  phone?: string | null;
  primarySalesPersonId?: string | null;
  secondarySalesPersonId?: string | null;
}): Promise<CardCrmAssignees> {
  try {
    let leadId: string | null = null;

    const crm = await resolveCrmLead({
      submission_id: input.submissionId ?? null,
      email: input.email ?? null,
      contact_number: input.phone ?? null,
      crm_lead_id: input.crmLeadId ?? null,
    });
    if (crm.found) leadId = crm.lead_id;

    if (leadId) {
      const fromCrm = await assigneesFromCrmLead(leadId);
      if (fromCrm.assignee_id || fromCrm.collaborator_ids.length > 0) {
        return fromCrm;
      }
    }

    return normalizeCardAssignees(
      input.primarySalesPersonId ?? null,
      input.secondarySalesPersonId ? [input.secondarySalesPersonId] : [],
    );
  } catch (err: any) {
    console.warn('[cardCrmAssignees] resolve failed:', err?.message);
    return normalizeCardAssignees(
      input.primarySalesPersonId ?? null,
      input.secondarySalesPersonId ? [input.secondarySalesPersonId] : [],
    );
  }
}

/** Convenience: pull identity + Hub sales people off a client_submissions row. */
export async function resolveCrmCardAssigneesFromSubmission(
  submission: {
    id?: string | null;
    crm_lead_id?: string | null;
    email?: string | null;
    contact_number?: string | null;
    primary_sales_person_id?: string | null;
    secondary_sales_person_id?: string | null;
  } | null | undefined,
): Promise<CardCrmAssignees> {
  if (!submission) return EMPTY_CARD_ASSIGNEES;
  return resolveCrmCardAssignees({
    submissionId: submission.id,
    crmLeadId: submission.crm_lead_id,
    email: submission.email,
    phone: submission.contact_number,
    primarySalesPersonId: submission.primary_sales_person_id,
    secondarySalesPersonId: submission.secondary_sales_person_id,
  });
}

async function assigneesFromCrmLead(leadId: string): Promise<CardCrmAssignees> {
  const [{ data: lead }, { data: deals }] = await Promise.all([
    supabaseAdmin
      .from('crm_leads')
      .select('id, assignee_id, collaborator_ids')
      .eq('id', leadId)
      .is('merged_into_lead_id', null)
      .maybeSingle(),
    supabaseAdmin
      .from('crm_deals')
      .select('assignee_id, collaborator_ids, updated_at')
      .eq('source_lead_id', leadId)
      .is('moved_out_at', null)
      .eq('status', 'open')
      .order('updated_at', { ascending: false })
      .limit(1),
  ]);

  const deal = deals?.[0];
  if (deal && (deal.assignee_id || (deal.collaborator_ids || []).length > 0)) {
    return normalizeCardAssignees(deal.assignee_id, deal.collaborator_ids);
  }
  if (lead) {
    return normalizeCardAssignees(lead.assignee_id, lead.collaborator_ids);
  }
  return EMPTY_CARD_ASSIGNEES;
}

/** Join assignee + collaborator user rows onto a list of cards. */
export async function hydrateCardAssigneeUsers<T extends {
  assignee_id?: string | null;
  collaborator_ids?: string[] | null;
}>(cards: T[]): Promise<(T & {
  assignee: CardAssigneeUser | null;
  collaborators: CardAssigneeUser[];
})[]> {
  const ids = new Set<string>();
  for (const c of cards) {
    if (c.assignee_id) ids.add(c.assignee_id);
    for (const id of c.collaborator_ids || []) if (id) ids.add(id);
  }
  const userById = new Map<string, CardAssigneeUser>();
  if (ids.size > 0) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, avatar_url')
      .in('id', Array.from(ids));
    (data || []).forEach((u: any) => {
      userById.set(u.id, {
        id: u.id,
        display_name: u.display_name ?? null,
        email: u.email ?? null,
        avatar_url: u.avatar_url ?? null,
      });
    });
  }
  return cards.map((c) => ({
    ...c,
    assignee: c.assignee_id ? userById.get(c.assignee_id) ?? null : null,
    collaborators: (c.collaborator_ids || [])
      .map((id) => userById.get(id))
      .filter((u): u is CardAssigneeUser => !!u),
  }));
}

/**
 * One-shot backfill for cards the SQL migration couldn't link (email/phone
 * match, missing lead_submission_id, etc.). Only fills cards that still have
 * no primary assignee. Returns how many rows were written.
 */
export async function backfillUnlinkedCardAssignees(): Promise<{
  subscription: number;
  job: number;
}> {
  const counts = { subscription: 0, job: 0 };

  const { data: subCards } = await supabaseAdmin
    .from('subscription_cards')
    .select('id, lead_submission_id, submission_subscription_id, customer_email, customer_phone')
    .is('assignee_id', null)
    .is('deleted_at', null);

  for (const card of subCards || []) {
    const submission = await loadSubmissionForCard(card);
    const assignees = await resolveCrmCardAssignees({
      submissionId: submission?.id ?? card.lead_submission_id,
      crmLeadId: submission?.crm_lead_id,
      email: submission?.email || card.customer_email,
      phone: submission?.contact_number || card.customer_phone,
      primarySalesPersonId: submission?.primary_sales_person_id,
      secondarySalesPersonId: submission?.secondary_sales_person_id,
    });
    if (!assignees.assignee_id && assignees.collaborator_ids.length === 0) continue;
    const { error } = await supabaseAdmin
      .from('subscription_cards')
      .update(assignees)
      .eq('id', card.id)
      .is('assignee_id', null);
    if (!error) counts.subscription += 1;
  }

  const { data: jobCards } = await supabaseAdmin
    .from('job_cards')
    .select('id, lead_submission_id, customer_email, customer_phone')
    .is('assignee_id', null)
    .is('deleted_at', null);

  for (const card of jobCards || []) {
    const submission = card.lead_submission_id
      ? await loadSubmissionById(card.lead_submission_id)
      : null;
    const assignees = await resolveCrmCardAssignees({
      submissionId: submission?.id ?? card.lead_submission_id,
      crmLeadId: submission?.crm_lead_id,
      email: submission?.email || card.customer_email,
      phone: submission?.contact_number || card.customer_phone,
      primarySalesPersonId: submission?.primary_sales_person_id,
      secondarySalesPersonId: submission?.secondary_sales_person_id,
    });
    if (!assignees.assignee_id && assignees.collaborator_ids.length === 0) continue;
    const { error } = await supabaseAdmin
      .from('job_cards')
      .update(assignees)
      .eq('id', card.id)
      .is('assignee_id', null);
    if (!error) counts.job += 1;
  }

  return counts;
}

async function loadSubmissionById(id: string) {
  const { data } = await supabaseAdmin
    .from('client_submissions')
    .select('id, crm_lead_id, email, contact_number, primary_sales_person_id, secondary_sales_person_id')
    .eq('id', id)
    .maybeSingle();
  return data;
}

async function loadSubmissionForCard(card: {
  lead_submission_id?: string | null;
  submission_subscription_id?: string | null;
}) {
  if (card.lead_submission_id) return loadSubmissionById(card.lead_submission_id);
  if (!card.submission_subscription_id) return null;
  const { data: staged } = await supabaseAdmin
    .from('client_submission_subscriptions')
    .select('submission_id')
    .eq('id', card.submission_subscription_id)
    .maybeSingle();
  if (!staged?.submission_id) return null;
  return loadSubmissionById(staged.submission_id);
}
