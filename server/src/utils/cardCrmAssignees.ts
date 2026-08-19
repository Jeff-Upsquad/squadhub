/**
 * Copy Squad CRM lead/deal owners onto Hub subscription / assignment / job cards.
 *
 * Which CRM record we follow depends on what the card is FOR. CRM keeps a
 * pipeline family per service line, so one customer can be an accountant lead
 * AND a designer/editor lead at the same time, under different owners. The
 * card's service line picks the family; see crmPipelineMatch.
 *
 * Resolution (first match wins), searching the customer's whole CRM footprint —
 * leads, nurture and client records (all rows of crm_leads) plus open deals:
 *   1. Open deal on the card's service line (live commercial owner)
 *   2. Lead / nurture / client record on that same service line
 *   3. A record in a pipeline that names no trade at all ("Main Leads") —
 *      neutral, so still allowed to speak for the card
 *   4. Hub contact primary/secondary sales people
 *
 * We deliberately do NOT borrow an owner from another trade's pipeline: a card
 * with nobody on it shows a red "Unassigned" chip an admin can act on, which is
 * easier to catch than a plausible-looking but wrong name.
 *
 * Never throws — card create must succeed even if CRM is unreachable.
 */

import { supabaseAdmin } from '../supabase';
import {
  crmLeadIsLive,
  crmLeadLastTouched,
  findCrmLeadCandidates,
  loadCrmLeadById,
  type CrmLeadCandidate,
} from './clientExternalLinks';
import {
  pipelineConflictsWithService,
  pipelineMatchesService,
} from './crmPipelineMatch';

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
  /**
   * What the card is for — "Accountants", "Designer plus Editor", a catalog
   * slug, anything nameable. Steers which CRM pipeline family we follow.
   */
  serviceLabel?: string | null;
}): Promise<CardCrmAssignees> {
  const hubFallback = () =>
    normalizeCardAssignees(
      input.primarySalesPersonId ?? null,
      input.secondarySalesPersonId ? [input.secondarySalesPersonId] : [],
    );

  try {
    const owners = await ownersFromCrm(input);
    if (owners && (owners.assignee_id || owners.collaborator_ids.length > 0)) {
      return owners;
    }
    return hubFallback();
  } catch (err: any) {
    console.warn('[cardCrmAssignees] resolve failed:', err?.message);
    return hubFallback();
  }
}

type OpenDeal = {
  assignee_id?: string | null;
  collaborator_ids?: string[] | null;
  pipeline_id?: string | null;
  source_lead_id?: string | null;
  updated_at?: string | null;
};

/**
 * Follow the customer into the CRM pipeline family that matches this card's
 * service line, and read the owner from whatever we find there.
 *
 * The search covers the customer's whole CRM footprint, not just their leads:
 *   • lead records — which is also where nurture and client pipelines live
 *   • open deals — a separate table, found via the customer's contact as well
 *     as via their leads, so a deal counts even when it grew out of a lead in
 *     a different pipeline
 *
 * Within the matching family a live deal outranks a lead, because the deal owner
 * is the person actually working the money. If the customer has nothing on this
 * card's service line at all, we fall back to their best lead overall rather
 * than leaving the card ownerless.
 */
async function ownersFromCrm(input: {
  submissionId?: string | null;
  crmLeadId?: string | null;
  email?: string | null;
  phone?: string | null;
  serviceLabel?: string | null;
}): Promise<CardCrmAssignees | null> {
  const leads = await findLeadCandidates(input);
  if (leads.length === 0) return null;

  const service = input.serviceLabel ?? null;
  const deals = await findOpenDeals(leads);

  const pipelines = await loadPipelines([
    ...leads.map((l) => l.pipeline_id),
    ...deals.map((d) => d.pipeline_id),
  ]);
  const onService = (pipelineId: string | null | undefined) =>
    pipelineMatchesService(pipelineId ? pipelines.get(pipelineId)?.name : null, service);
  // A record in another trade's pipeline must not speak for this card. Client
  // pipelines are exempt: they file existing customers by business unit
  // ("Content Squad Clients"), which says nothing about what a new card is for.
  const offService = (pipelineId: string | null | undefined) => {
    const pipeline = pipelineId ? pipelines.get(pipelineId) : null;
    if (!pipeline || pipeline.kind === 'clients') return false;
    return pipelineConflictsWithService(pipeline.name, service);
  };

  // 1. A live deal on the card's service line — the strongest signal there is.
  const matchedDeals = deals.filter((d) => onService(d.pipeline_id) && dealHasOwner(d));
  if (matchedDeals.length > 0) {
    const deal = mostRecentDeal(matchedDeals);
    return normalizeCardAssignees(deal.assignee_id, deal.collaborator_ids);
  }

  // 2. A lead (or nurture / client record) on that same service line.
  const usableDeals = deals.filter((d) => !offService(d.pipeline_id));
  const matchedLeads = leads.filter((l) => onService(l.pipeline_id));
  if (matchedLeads.length > 0) {
    return ownersForLead(rankLeads(matchedLeads, input.crmLeadId)[0], usableDeals, onService);
  }

  // 3. Nothing on this exact service line, but a record in a pipeline that
  //    isn't ANY particular trade ("Main Leads") is neutral, not wrong — those
  //    can still speak for the card. Cards with no service line of their own
  //    land here too, which keeps their old behaviour intact.
  const neutralLeads = leads.filter((l) => !offService(l.pipeline_id));
  if (neutralLeads.length > 0) {
    return ownersForLead(rankLeads(neutralLeads, input.crmLeadId)[0], usableDeals, onService);
  }

  // 4. Everything this customer has belongs to a different trade. Borrowing an
  //    owner from there would quietly put the wrong person on the card, so leave
  //    it for the Hub sales people — and failing those, an admin, via the red
  //    "Unassigned" chip.
  return null;
}

/** Owners for one lead: its own open deal first, else the lead's own people. */
function ownersForLead(
  lead: CrmLeadCandidate,
  deals: OpenDeal[],
  onService: (pipelineId: string | null | undefined) => boolean,
): CardCrmAssignees {
  const own = deals.filter((d) => d.source_lead_id === lead.id && dealHasOwner(d));
  if (own.length > 0) {
    const deal = own.find((d) => onService(d.pipeline_id)) ?? mostRecentDeal(own);
    return normalizeCardAssignees(deal.assignee_id, deal.collaborator_ids);
  }
  return normalizeCardAssignees(lead.assignee_id, lead.collaborator_ids);
}

function dealHasOwner(d: OpenDeal): boolean {
  return !!(d.assignee_id || (d.collaborator_ids || []).length > 0);
}

function mostRecentDeal(deals: OpenDeal[]): OpenDeal {
  return [...deals].sort(
    (a, b) => Date.parse(b.updated_at || '') - Date.parse(a.updated_at || ''),
  )[0];
}

/**
 * Tie-breakers once the service line has had its say: an already-linked lead,
 * then a live one, then whichever was touched most recently.
 */
function rankLeads(leads: CrmLeadCandidate[], storedLeadId?: string | null): CrmLeadCandidate[] {
  return [...leads].sort(
    (a, b) =>
      Number(b.id === storedLeadId) - Number(a.id === storedLeadId) ||
      Number(crmLeadIsLive(b)) - Number(crmLeadIsLive(a)) ||
      crmLeadLastTouched(b) - crmLeadLastTouched(a),
  );
}

/** The customer's lead records: the one already linked, plus contact matches. */
async function findLeadCandidates(input: {
  submissionId?: string | null;
  crmLeadId?: string | null;
  email?: string | null;
  phone?: string | null;
}): Promise<CrmLeadCandidate[]> {
  const byId = new Map<string, CrmLeadCandidate>();

  if (input.crmLeadId) {
    const stored = await loadCrmLeadById(input.crmLeadId);
    if (stored) byId.set(stored.id, stored);
  }

  const { rows } = await findCrmLeadCandidates({
    submission_id: input.submissionId ?? null,
    email: input.email ?? null,
    contact_number: input.phone ?? null,
    crm_lead_id: null,
  });
  for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row);

  return Array.from(byId.values());
}

/**
 * Open deals belonging to this customer — matched on the CRM contact as well as
 * on the leads themselves, so we still find a deal that was spawned from some
 * other lead of theirs.
 */
async function findOpenDeals(leads: CrmLeadCandidate[]): Promise<OpenDeal[]> {
  const leadIds = leads.map((l) => l.id);
  const contactIds = Array.from(
    new Set(leads.map((l) => l.contact_id).filter((id): id is string => !!id)),
  );

  const columns = 'assignee_id, collaborator_ids, pipeline_id, source_lead_id, updated_at';
  const queries = [
    supabaseAdmin
      .from('crm_deals')
      .select(columns)
      .in('source_lead_id', leadIds)
      .is('moved_out_at', null)
      .eq('status', 'open')
      .limit(50),
  ];
  if (contactIds.length > 0) {
    queries.push(
      supabaseAdmin
        .from('crm_deals')
        .select(columns)
        .in('contact_id', contactIds)
        .is('moved_out_at', null)
        .eq('status', 'open')
        .limit(50),
    );
  }

  const results = await Promise.all(queries);
  const seen = new Set<string>();
  const deals: OpenDeal[] = [];
  for (const { data } of results) {
    for (const d of data || []) {
      // No id in the projection, so dedupe on what identifies a deal here.
      const key = `${d.source_lead_id}|${d.pipeline_id}|${d.updated_at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deals.push(d as OpenDeal);
    }
  }
  return deals;
}

/** id → pipeline, for the handful of pipelines a candidate set touches. */
async function loadPipelines(
  ids: (string | null | undefined)[],
): Promise<Map<string, { name: string; kind: string }>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => !!id)));
  const pipelines = new Map<string, { name: string; kind: string }>();
  if (unique.length === 0) return pipelines;
  const { data } = await supabaseAdmin
    .from('crm_pipelines')
    .select('id, name, kind')
    .in('id', unique);
  (data || []).forEach((p: any) => pipelines.set(p.id, { name: p.name, kind: p.kind }));
  return pipelines;
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
  serviceLabel?: string | null,
): Promise<CardCrmAssignees> {
  if (!submission) return EMPTY_CARD_ASSIGNEES;
  return resolveCrmCardAssignees({
    submissionId: submission.id,
    crmLeadId: submission.crm_lead_id,
    email: submission.email,
    phone: submission.contact_number,
    primarySalesPersonId: submission.primary_sales_person_id,
    secondarySalesPersonId: submission.secondary_sales_person_id,
    serviceLabel: serviceLabel ?? null,
  });
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
    .select('id, lead_submission_id, submission_subscription_id, customer_email, customer_phone, service_type')
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
      serviceLabel: card.service_type,
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
    .select('id, lead_submission_id, customer_email, customer_phone, role_service_type')
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
      serviceLabel: card.role_service_type,
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
