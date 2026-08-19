/**
 * Resolve a Squad CRM record (lead / deal / contact) to the Hub cards that
 * belong to the same customer.
 *
 * This is the reverse of clientExternalLinks (Hub → CRM). Squad CRM's
 * Requirement Cards module opens a customer's subscription cards straight from
 * a lead or deal, and the CRM side only knows CRM ids — so the mapping has to
 * happen here, next to the card tables.
 *
 * Everything funnels through crm_leads, because that is where the identity
 * lives: a deal has no phone of its own, and a contact keeps its numbers on
 * crm_contact_persons. From the lead set we reach submissions three ways —
 * the explicit link either side may have stored, then phone, then email — and
 * finally match cards that carry the customer's phone/email directly (cards
 * created before any submission existed).
 *
 * Soft refs only, in both directions: nothing here assumes a FK, and a missing
 * or unmatched record returns an empty set rather than throwing, so a CRM
 * record with no Hub footprint simply shows "no cards yet".
 */

import { supabaseAdmin } from '../supabase';

export type CrmCardScope = {
  leadId?: string | null;
  dealId?: string | null;
  contactId?: string | null;
};

export type CrmScopeResolution = {
  /** Hub client_submissions rows this CRM record maps to. */
  submissionIds: string[];
  /** crm_leads rows the scope expanded to (useful for debugging / display). */
  leadIds: string[];
  /** Distinct phone suffixes (last 10 digits) seen on those leads. */
  phoneSuffixes: string[];
  /** Distinct lowercase emails seen on those leads. */
  emails: string[];
};

/** Last-10-digit suffix, the same normalisation the CRM admin-link uses. */
function phoneSuffixOf(raw: string | null | undefined): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/** Emails the Convert action manufactures are not real identities. */
function realEmail(raw: string | null | undefined): string | null {
  const email = String(raw || '').trim().toLowerCase();
  if (!email || email.endsWith('@placeholder.crm')) return null;
  return email;
}

/**
 * Expand a CRM record to every lead that speaks for the same customer.
 *
 * A deal reaches its leads through source_lead_id / conversation_lead_id and
 * through its contact; a contact reaches them through crm_leads.contact_id.
 * All of them are soft refs, so each step is a separate best-effort query.
 */
async function leadsForScope(scope: CrmCardScope): Promise<any[]> {
  const leadIds = new Set<string>();
  const contactIds = new Set<string>();

  if (scope.leadId) leadIds.add(scope.leadId);
  if (scope.contactId) contactIds.add(scope.contactId);

  if (scope.dealId) {
    const { data: deal } = await supabaseAdmin
      .from('crm_deals')
      .select('contact_id, source_lead_id, conversation_lead_id')
      .eq('id', scope.dealId)
      .maybeSingle();
    if (deal?.source_lead_id) leadIds.add(deal.source_lead_id as string);
    if (deal?.conversation_lead_id) leadIds.add(deal.conversation_lead_id as string);
    if (deal?.contact_id) contactIds.add(deal.contact_id as string);
  }

  // A contact's whole lead footprint — one customer can be a lead in several
  // pipelines (accountants, designers, …) and each may have its own cards.
  if (contactIds.size > 0) {
    const { data: byContact } = await supabaseAdmin
      .from('crm_leads')
      .select('id')
      .in('contact_id', Array.from(contactIds));
    (byContact || []).forEach((l: any) => leadIds.add(l.id));
  }

  if (leadIds.size === 0) return [];

  const { data: leads } = await supabaseAdmin
    .from('crm_leads')
    .select('id, contact_id, sh_client_submission_id, phone_e164, email')
    .in('id', Array.from(leadIds));

  const rows = leads || [];

  // A lead reached directly (not through a contact) still shares its customer
  // with its siblings, so pull those in too — one pass only, no recursion.
  if (!scope.contactId && !scope.dealId) {
    const siblingContactIds = rows.map((l: any) => l.contact_id).filter(Boolean);
    if (siblingContactIds.length > 0) {
      const { data: siblings } = await supabaseAdmin
        .from('crm_leads')
        .select('id, contact_id, sh_client_submission_id, phone_e164, email')
        .in('contact_id', siblingContactIds);
      const byId = new Map<string, any>(rows.map((l: any) => [l.id, l]));
      (siblings || []).forEach((l: any) => byId.set(l.id, l));
      return [...byId.values()];
    }
  }

  return rows;
}

/**
 * CRM record → Hub submissions + the identity fields worth matching cards on.
 * Never throws: CRM being unreachable degrades to "nothing linked".
 */
export async function resolveCrmScope(scope: CrmCardScope): Promise<CrmScopeResolution> {
  const empty: CrmScopeResolution = {
    submissionIds: [],
    leadIds: [],
    phoneSuffixes: [],
    emails: [],
  };
  if (!scope.leadId && !scope.dealId && !scope.contactId) return empty;

  try {
    const leads = await leadsForScope(scope);
    if (leads.length === 0) return empty;

    const leadIds = leads.map((l: any) => l.id as string);
    const phoneSuffixes = Array.from(
      new Set(leads.map((l: any) => phoneSuffixOf(l.phone_e164)).filter(Boolean) as string[]),
    );
    const emails = Array.from(
      new Set(leads.map((l: any) => realEmail(l.email)).filter(Boolean) as string[]),
    );

    // Numbers and addresses can also sit on the contact's people rows rather
    // than the lead itself (a lead created from an ad, then enriched).
    const contactIds = Array.from(
      new Set(leads.map((l: any) => l.contact_id).filter(Boolean) as string[]),
    );
    if (contactIds.length > 0) {
      const { data: persons } = await supabaseAdmin
        .from('crm_contact_persons')
        .select('phone_e164, email')
        .in('contact_id', contactIds);
      for (const p of persons || []) {
        const suffix = phoneSuffixOf((p as any).phone_e164);
        if (suffix && !phoneSuffixes.includes(suffix)) phoneSuffixes.push(suffix);
        const email = realEmail((p as any).email);
        if (email && !emails.includes(email)) emails.push(email);
      }
    }

    const submissionIds = new Set<string>();
    for (const l of leads) {
      if (l.sh_client_submission_id) submissionIds.add(l.sh_client_submission_id as string);
    }

    // The Hub side stores its own link (clientExternalLinks backfills it), so
    // check that direction as well — either app may have matched first.
    const { data: byStoredLink } = await supabaseAdmin
      .from('client_submissions')
      .select('id')
      .in('crm_lead_id', leadIds);
    (byStoredLink || []).forEach((s: any) => submissionIds.add(s.id));

    // Phone / email fallbacks catch customers who exist in both apps but were
    // never explicitly linked. contact_number is stored unnormalised, so the
    // ilike is a prefilter and the suffix comparison is the real test.
    for (const suffix of phoneSuffixes) {
      const { data: subs } = await supabaseAdmin
        .from('client_submissions')
        .select('id, contact_number')
        .ilike('contact_number', `%${suffix}%`)
        .limit(20);
      (subs || [])
        .filter((s: any) => String(s.contact_number || '').replace(/\D/g, '').endsWith(suffix))
        .forEach((s: any) => submissionIds.add(s.id));
    }
    for (const email of emails) {
      const { data: subs } = await supabaseAdmin
        .from('client_submissions')
        .select('id')
        .ilike('email', email)
        .limit(20);
      (subs || []).forEach((s: any) => submissionIds.add(s.id));
    }

    return {
      submissionIds: Array.from(submissionIds),
      leadIds,
      phoneSuffixes,
      emails,
    };
  } catch (err: any) {
    console.warn('[crmCardScope] resolve failed:', err?.message);
    return empty;
  }
}

/**
 * Every card that belongs to one Hub submission, via all four linking paths:
 *   0. lead_submission_id            — Stage B direct FK (preferred)
 *   1. submission_subscription_id    — staged subscription path
 *   2. customer_email                — legacy request/shared_form cards
 *   3. customer_phone (digit suffix) — same, for phone-led leads
 *
 * Lifted out of the admin list route so the CRM scope can reuse it per
 * submission instead of duplicating the join logic.
 */
export async function cardIdsForSubmission(submissionId: string): Promise<Set<string>> {
  const ids = new Set<string>();

  const { data: leadRow } = await supabaseAdmin
    .from('client_submissions')
    .select('email, contact_number')
    .eq('id', submissionId)
    .maybeSingle();

  const { data: stagedForSubmission } = await supabaseAdmin
    .from('client_submission_subscriptions')
    .select('id')
    .eq('submission_id', submissionId);
  const allowedStagedIds = (stagedForSubmission || []).map((r: any) => r.id);

  const phoneDigits = leadRow?.contact_number
    ? String(leadRow.contact_number).replace(/\D/g, '')
    : '';
  const phoneSuffix = phoneDigits.length >= 7 ? phoneDigits : '';

  const [byDirect, byStaged, byEmail, byPhone] = await Promise.all([
    supabaseAdmin.from('subscription_cards').select('id').eq('lead_submission_id', submissionId),
    allowedStagedIds.length > 0
      ? supabaseAdmin
          .from('subscription_cards')
          .select('id')
          .in('submission_subscription_id', allowedStagedIds)
      : Promise.resolve({ data: [] as { id: string }[] }),
    leadRow?.email
      ? supabaseAdmin.from('subscription_cards').select('id').ilike('customer_email', leadRow.email.trim())
      : Promise.resolve({ data: [] as { id: string }[] }),
    phoneSuffix
      ? supabaseAdmin.from('subscription_cards').select('id').ilike('customer_phone', `%${phoneSuffix}`)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);

  (byDirect.data || []).forEach((r: any) => ids.add(r.id));
  (byStaged.data || []).forEach((r: any) => ids.add(r.id));
  (byEmail.data || []).forEach((r: any) => ids.add(r.id));
  (byPhone.data || []).forEach((r: any) => ids.add(r.id));
  return ids;
}

/**
 * Every card belonging to the customer behind a CRM lead / deal / contact.
 *
 * Union of each linked submission's cards plus a direct match on the card's own
 * customer_phone / customer_email — a brief can be raised straight off a CRM
 * conversation, before the customer has a submission at all, and those cards
 * must still show up under the lead.
 */
export async function cardIdsForCrmScope(scope: CrmCardScope): Promise<Set<string>> {
  const ids = new Set<string>();
  const resolution = await resolveCrmScope(scope);

  for (const submissionId of resolution.submissionIds) {
    const perSubmission = await cardIdsForSubmission(submissionId);
    perSubmission.forEach((id) => ids.add(id));
  }

  await Promise.all([
    ...resolution.phoneSuffixes.map(async (suffix) => {
      const { data } = await supabaseAdmin
        .from('subscription_cards')
        .select('id, customer_phone')
        .ilike('customer_phone', `%${suffix}%`);
      (data || [])
        .filter((c: any) => String(c.customer_phone || '').replace(/\D/g, '').endsWith(suffix))
        .forEach((c: any) => ids.add(c.id));
    }),
    ...resolution.emails.map(async (email) => {
      const { data } = await supabaseAdmin
        .from('subscription_cards')
        .select('id')
        .ilike('customer_email', email);
      (data || []).forEach((c: any) => ids.add(c.id));
    }),
  ]);

  return ids;
}
