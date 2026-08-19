/**
 * Persist + resolve cross-app identity links for clients / contacts.
 *
 * Soft refs stored on client_submissions + clients:
 *   - crm_lead_id                  → Squad CRM crm_leads.id
 *   - squadhire_business_user_id    → SquadHire business_users.id
 *
 * Lookups prefer stored IDs; on soft-match success we backfill so the next
 * open is O(1). Writes are best-effort (never fail the user-facing path).
 */

import { supabaseAdmin } from '../supabase';
import { config } from '../config';
import { lookupSquadhireBusinessUser } from './squadhireBusinessLookup';

export type CrmLinkMatch = {
  found: true;
  lead_id: string;
  matched_by: 'stored' | 'submission_id' | 'phone' | 'email';
} | { found: false };

export type HireLinkMatch = {
  found: true;
  business_user_id: string;
  company_name: string;
  contact_person_name: string;
  matched_by: 'stored' | 'email' | 'phone';
  admin_url: string | null;
  squadhireAdminUrl: string | null;
} | { found: false };

type ContactFields = {
  submission_id?: string | null;
  email?: string | null;
  contact_number?: string | null;
  crm_lead_id?: string | null;
  squadhire_business_user_id?: string | null;
};

function hireAdminUrl(businessUserId: string, fromHire: string | null): string | null {
  if (fromHire) return fromHire;
  if (!config.squadhireAdminUrl) return null;
  return `${config.squadhireAdminUrl.replace(/\/$/, '')}/business/${businessUserId}`;
}

/** Fire-and-forget patch — only fills null columns. */
async function backfillTable(
  table: 'clients' | 'client_submissions',
  id: string,
  patch: { crm_lead_id?: string; squadhire_business_user_id?: string },
): Promise<void> {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  try {
    // Only write columns that are currently null so we never clobber a
    // deliberate re-link. Two sequential updates keep the SQL simple.
    if (patch.crm_lead_id) {
      await supabaseAdmin
        .from(table)
        .update({ crm_lead_id: patch.crm_lead_id })
        .eq('id', id)
        .is('crm_lead_id', null);
    }
    if (patch.squadhire_business_user_id) {
      await supabaseAdmin
        .from(table)
        .update({ squadhire_business_user_id: patch.squadhire_business_user_id })
        .eq('id', id)
        .is('squadhire_business_user_id', null);
    }
  } catch (err: any) {
    console.warn(`[clientExternalLinks] backfill ${table} ${id} failed:`, err?.message);
  }
}

// A customer can end up with more than one CRM lead — a re-enquiry, a second
// number, an import, or the same person tracked in two service pipelines — and
// Postgres returns those in no particular order. So candidates are returned in
// full and the pick is made deliberately: callers that know which service line
// they want (see crmPipelineMatch) can prefer that pipeline; everyone else gets
// pickBestLead, where a live lead beats a closed/archived/disqualified one and
// the most recently active wins the tie.
const LEAD_PICK_COLUMNS =
  'id, pipeline_id, contact_id, assignee_id, collaborator_ids, archived_at, disqualified_at, closed_at, last_activity_at, updated_at, created_at';
const LEAD_PICK_LIMIT = 20;

export type CrmLeadCandidate = {
  id: string;
  pipeline_id?: string | null;
  contact_id?: string | null;
  assignee_id?: string | null;
  collaborator_ids?: string[] | null;
  archived_at?: string | null;
  disqualified_at?: string | null;
  closed_at?: string | null;
  last_activity_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export function crmLeadIsLive(l: CrmLeadCandidate): boolean {
  return !l.archived_at && !l.disqualified_at && !l.closed_at;
}

export function crmLeadLastTouched(l: CrmLeadCandidate): number {
  return Date.parse(l.last_activity_at || l.updated_at || l.created_at || '') || 0;
}

export function pickBestLead(
  rows: CrmLeadCandidate[] | null | undefined,
): CrmLeadCandidate | null {
  const leads = rows || [];
  if (leads.length <= 1) return leads[0] ?? null;
  return [...leads].sort(
    (a, b) =>
      Number(crmLeadIsLive(b)) - Number(crmLeadIsLive(a)) ||
      crmLeadLastTouched(b) - crmLeadLastTouched(a),
  )[0];
}

/**
 * Every CRM lead this contact could be, from the first identifier that hits:
 * the Hub submission link, then phone, then email. Returns the whole set for
 * that identifier — one customer legitimately has several leads — so the caller
 * can choose which one it wants.
 */
export async function findCrmLeadCandidates(
  fields: ContactFields,
): Promise<{ matched_by: 'submission_id' | 'phone' | 'email' | null; rows: CrmLeadCandidate[] }> {
  const submissionId = fields.submission_id?.trim() || null;
  const phone = fields.contact_number?.trim() || null;
  const email = fields.email?.trim() || null;

  if (submissionId) {
    const { data } = await supabaseAdmin
      .from('crm_leads')
      .select(LEAD_PICK_COLUMNS)
      .eq('sh_client_submission_id', submissionId)
      .is('merged_into_lead_id', null)
      .limit(LEAD_PICK_LIMIT);
    if (data?.length) return { matched_by: 'submission_id', rows: data };
  }

  if (phone) {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length >= 7) {
      const { data } = await supabaseAdmin
        .from('crm_leads')
        .select(LEAD_PICK_COLUMNS)
        .ilike('phone_e164', `%${cleaned}`)
        .is('merged_into_lead_id', null)
        .limit(LEAD_PICK_LIMIT);
      if (data?.length) return { matched_by: 'phone', rows: data };
    }
  }

  if (email && email.includes('@')) {
    const { data } = await supabaseAdmin
      .from('crm_leads')
      .select(LEAD_PICK_COLUMNS)
      .ilike('email', email)
      .is('merged_into_lead_id', null)
      .limit(LEAD_PICK_LIMIT);
    if (data?.length) return { matched_by: 'email', rows: data };
  }

  return { matched_by: null, rows: [] };
}

/** Fetch one known lead by id (used when a contact already stores its link). */
export async function loadCrmLeadById(leadId: string): Promise<CrmLeadCandidate | null> {
  const { data } = await supabaseAdmin
    .from('crm_leads')
    .select(LEAD_PICK_COLUMNS)
    .eq('id', leadId)
    .is('merged_into_lead_id', null)
    .maybeSingle();
  return data ?? null;
}

export async function resolveCrmLead(
  fields: ContactFields,
  opts?: { persistTo?: { table: 'clients' | 'client_submissions'; id: string } },
): Promise<CrmLinkMatch> {
  // 0. Stored id
  if (fields.crm_lead_id) {
    return { found: true, lead_id: fields.crm_lead_id, matched_by: 'stored' };
  }

  const { matched_by: matchedBy, rows } = await findCrmLeadCandidates(fields);
  const leadId = pickBestLead(rows)?.id ?? null;

  if (!leadId || !matchedBy) return { found: false };

  if (opts?.persistTo) {
    void backfillTable(opts.persistTo.table, opts.persistTo.id, { crm_lead_id: leadId });
  }

  return { found: true, lead_id: leadId, matched_by: matchedBy };
}

export async function resolveSquadhireBusiness(
  fields: ContactFields,
  opts?: { persistTo?: { table: 'clients' | 'client_submissions'; id: string } },
): Promise<HireLinkMatch> {
  // 0. Stored id — build admin URL from config (no need to call Hire)
  if (fields.squadhire_business_user_id) {
    const id = fields.squadhire_business_user_id;
    return {
      found: true,
      business_user_id: id,
      company_name: '',
      contact_person_name: '',
      matched_by: 'stored',
      admin_url: hireAdminUrl(id, null),
      squadhireAdminUrl: config.squadhireAdminUrl || null,
    };
  }

  const match = await lookupSquadhireBusinessUser({
    email: fields.email,
    phone: fields.contact_number,
  });
  if (!match) return { found: false };

  if (opts?.persistTo) {
    void backfillTable(opts.persistTo.table, opts.persistTo.id, {
      squadhire_business_user_id: match.business_user_id,
    });
  }

  return {
    found: true,
    business_user_id: match.business_user_id,
    company_name: match.company_name,
    contact_person_name: match.contact_person_name,
    matched_by: match.matched_by,
    admin_url: hireAdminUrl(match.business_user_id, match.admin_url),
    squadhireAdminUrl: config.squadhireAdminUrl || null,
  };
}

/**
 * Resolve which SquadHire business_users.id should own a card on delivery.
 *
 * Prefer a live soft-match on email+phone (Profiles prefers an activated
 * account over an invite shell when both exist). That fixes the common
 * "email invite row vs phone login" split that leaves cards invisible on
 * the business portal. Fall back to the stored stamp when Hire is down or
 * no soft-match exists. When soft-match wins and differs from the stamp,
 * re-stamp contact + client so Hub identity stays aligned.
 */
export async function resolveHireBusinessUserIdForCardDelivery(input: {
  submissionId?: string | null;
  email?: string | null;
  phone?: string | null;
}): Promise<string | null> {
  const submissionId = input.submissionId?.trim() || null;
  let storedId: string | null = null;

  if (submissionId) {
    try {
      const { data } = await supabaseAdmin
        .from('client_submissions')
        .select('squadhire_business_user_id')
        .eq('id', submissionId)
        .maybeSingle();
      storedId = (data?.squadhire_business_user_id as string | null) ?? null;
    } catch (err: any) {
      console.warn(
        '[clientExternalLinks] load stored hire id failed:',
        err?.message,
      );
    }
  }

  const soft = await lookupSquadhireBusinessUser({
    email: input.email,
    phone: input.phone,
  });

  if (soft?.business_user_id) {
    if (submissionId && soft.business_user_id !== storedId) {
      try {
        await supabaseAdmin
          .from('client_submissions')
          .update({ squadhire_business_user_id: soft.business_user_id })
          .eq('id', submissionId);
        await supabaseAdmin
          .from('clients')
          .update({ squadhire_business_user_id: soft.business_user_id })
          .eq('submission_id', submissionId);
      } catch (err: any) {
        console.warn(
          '[clientExternalLinks] re-stamp hire id after soft-match failed:',
          err?.message,
        );
      }
    }
    return soft.business_user_id;
  }

  return storedId;
}

/**
 * Copy external link columns from a submission onto a newly materialised
 * client (or fill nulls on an existing client). Call on convert.
 */
export async function copyExternalLinksToClient(
  submissionId: string,
  clientId: string,
): Promise<void> {
  try {
    const { data: sub } = await supabaseAdmin
      .from('client_submissions')
      .select('crm_lead_id, squadhire_business_user_id')
      .eq('id', submissionId)
      .maybeSingle();
    if (!sub) return;

    const patch: Record<string, string> = {};
    if (sub.crm_lead_id) patch.crm_lead_id = sub.crm_lead_id;
    if (sub.squadhire_business_user_id) {
      patch.squadhire_business_user_id = sub.squadhire_business_user_id;
    }
    if (Object.keys(patch).length === 0) return;

    // Only fill nulls on the client.
    if (patch.crm_lead_id) {
      await supabaseAdmin
        .from('clients')
        .update({ crm_lead_id: patch.crm_lead_id })
        .eq('id', clientId)
        .is('crm_lead_id', null);
    }
    if (patch.squadhire_business_user_id) {
      await supabaseAdmin
        .from('clients')
        .update({ squadhire_business_user_id: patch.squadhire_business_user_id })
        .eq('id', clientId)
        .is('squadhire_business_user_id', null);
    }
  } catch (err: any) {
    console.warn('[clientExternalLinks] copy to client failed:', err?.message);
  }
}
