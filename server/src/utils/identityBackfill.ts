/**
 * Phase 4 — batch backfill + identity conflict diagnosis.
 *
 * Backfill stamps missing crm_lead_id / squadhire_business_user_id on
 * contacts and clients, and lead_submission_id on orphan cards.
 *
 * Conflicts: email and phone resolve to different rows (CRM leads, Hub
 * contacts, or Hire business users). Surfaces for admin review — we never
 * auto-merge.
 */

import { supabaseAdmin } from '../supabase';
import { findSubmissionByContact, phoneSuffix } from './leadLookup';
import {
  resolveCrmLead,
  resolveSquadhireBusiness,
  copyExternalLinksToClient,
} from './clientExternalLinks';

export type IdentityConflict = {
  kind: 'crm' | 'hub_contact' | 'squadhire';
  message: string;
  email_id: string | null;
  phone_id: string | null;
};

export type IdentityDiagnosis = {
  conflicts: IdentityConflict[];
  crm_lead_id: string | null;
  squadhire_business_user_id: string | null;
  hub_contact_id: string | null;
};

async function findCrmLeadByEmail(email: string | null | undefined): Promise<string | null> {
  if (!email || !email.includes('@')) return null;
  const { data } = await supabaseAdmin
    .from('crm_leads')
    .select('id')
    .ilike('email', email.trim())
    .is('merged_into_lead_id', null)
    .limit(1);
  return data?.[0]?.id ?? null;
}

async function findCrmLeadByPhone(phone: string | null | undefined): Promise<string | null> {
  if (!phone) return null;
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 7) return null;
  const { data } = await supabaseAdmin
    .from('crm_leads')
    .select('id')
    .ilike('phone_e164', `%${cleaned}`)
    .is('merged_into_lead_id', null)
    .limit(1);
  return data?.[0]?.id ?? null;
}

/**
 * Diagnose whether email and phone point at different people across systems.
 * Does not write anything.
 */
export async function diagnoseIdentityConflicts(input: {
  email?: string | null;
  phone?: string | null;
  submission_id?: string | null;
  crm_lead_id?: string | null;
  squadhire_business_user_id?: string | null;
}): Promise<IdentityDiagnosis> {
  const email = input.email?.trim() || null;
  const phone = input.phone?.trim() || null;
  const conflicts: IdentityConflict[] = [];

  // CRM
  const [crmByEmail, crmByPhone] = await Promise.all([
    findCrmLeadByEmail(email),
    findCrmLeadByPhone(phone),
  ]);
  if (crmByEmail && crmByPhone && crmByEmail !== crmByPhone) {
    conflicts.push({
      kind: 'crm',
      message:
        'Email and phone match different Squad CRM leads. Resolve which lead is correct and merge in CRM if needed.',
      email_id: crmByEmail,
      phone_id: crmByPhone,
    });
  }

  // Hub contacts (client_submissions)
  let hubByEmail: string | null = null;
  let hubByPhone: string | null = null;
  if (email) {
    const { data } = await supabaseAdmin
      .from('client_submissions')
      .select('id')
      .ilike('email', email)
      .order('created_at', { ascending: false })
      .limit(1);
    hubByEmail = data?.[0]?.id ?? null;
  }
  const suffix = phoneSuffix(phone);
  if (suffix) {
    const { data } = await supabaseAdmin
      .from('client_submissions')
      .select('id, contact_number')
      .ilike('contact_number', `%${suffix.slice(-4)}`)
      .order('created_at', { ascending: false })
      .limit(50);
    for (const row of data || []) {
      if (phoneSuffix(row.contact_number) === suffix) {
        hubByPhone = row.id;
        break;
      }
    }
  }
  if (hubByEmail && hubByPhone && hubByEmail !== hubByPhone) {
    conflicts.push({
      kind: 'hub_contact',
      message:
        'Email and phone match different Hub contacts. Open both and merge manually if they are the same person.',
      email_id: hubByEmail,
      phone_id: hubByPhone,
    });
  }

  // SquadHire — two separate lookups so we can detect conflict
  // (resolveSquadhireBusiness collapses them). Use soft lookups via the
  // integration only when email or phone is present.
  let hireEmailId: string | null = null;
  let hirePhoneId: string | null = null;
  if (email || phone) {
    const [byEmail, byPhone] = await Promise.all([
      email
        ? resolveSquadhireBusiness({ email, contact_number: null })
        : Promise.resolve({ found: false } as const),
      phone
        ? resolveSquadhireBusiness({ email: null, contact_number: phone })
        : Promise.resolve({ found: false } as const),
    ]);
    if (byEmail.found) hireEmailId = byEmail.business_user_id;
    if (byPhone.found) hirePhoneId = byPhone.business_user_id;
    if (hireEmailId && hirePhoneId && hireEmailId !== hirePhoneId) {
      conflicts.push({
        kind: 'squadhire',
        message:
          'Email and phone match different SquadHire business users. Prefer the activated account; contact support if both are live.',
        email_id: hireEmailId,
        phone_id: hirePhoneId,
      });
    }
  }

  return {
    conflicts,
    crm_lead_id: input.crm_lead_id || crmByPhone || crmByEmail || null,
    squadhire_business_user_id:
      input.squadhire_business_user_id || hirePhoneId || hireEmailId || null,
    hub_contact_id: input.submission_id || hubByPhone || hubByEmail || null,
  };
}

export type BackfillStats = {
  submissions_scanned: number;
  submissions_crm_stamped: number;
  submissions_hire_stamped: number;
  clients_scanned: number;
  clients_crm_stamped: number;
  clients_hire_stamped: number;
  cards_scanned: number;
  cards_linked: number;
  job_cards_scanned: number;
  job_cards_linked: number;
  conflicts_seen: number;
  errors: string[];
};

/**
 * One-shot (or chunked) backfill. Safe to re-run — only fills null columns.
 * Hire lookups are sequential with a small pause to avoid hammering Profiles.
 */
export async function runIdentityBackfill(opts?: {
  /** Max rows per table to process this call. Default 100. */
  limit?: number;
  /** When true, skip SquadHire network calls (CRM + card linking only). */
  skip_hire?: boolean;
}): Promise<BackfillStats> {
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  const skipHire = !!opts?.skip_hire;
  const stats: BackfillStats = {
    submissions_scanned: 0,
    submissions_crm_stamped: 0,
    submissions_hire_stamped: 0,
    clients_scanned: 0,
    clients_crm_stamped: 0,
    clients_hire_stamped: 0,
    cards_scanned: 0,
    cards_linked: 0,
    job_cards_scanned: 0,
    job_cards_linked: 0,
    conflicts_seen: 0,
    errors: [],
  };

  // ── Contacts missing external ids ──
  const { data: subs, error: subErr } = await supabaseAdmin
    .from('client_submissions')
    .select('id, email, contact_number, crm_lead_id, squadhire_business_user_id')
    .or('crm_lead_id.is.null,squadhire_business_user_id.is.null')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (subErr) stats.errors.push(`submissions query: ${subErr.message}`);

  for (const row of subs || []) {
    stats.submissions_scanned += 1;
    try {
      const diagnosis = await diagnoseIdentityConflicts({
        email: row.email,
        phone: row.contact_number,
        submission_id: row.id,
        crm_lead_id: row.crm_lead_id,
        squadhire_business_user_id: row.squadhire_business_user_id,
      });
      if (diagnosis.conflicts.length) stats.conflicts_seen += diagnosis.conflicts.length;

      if (!row.crm_lead_id) {
        const crm = await resolveCrmLead(
          {
            submission_id: row.id,
            email: row.email,
            contact_number: row.contact_number,
          },
          { persistTo: { table: 'client_submissions', id: row.id } },
        );
        // resolveCrmLead backfills async via void; do a direct await write for certainty
        if (crm.found) {
          await supabaseAdmin
            .from('client_submissions')
            .update({ crm_lead_id: crm.lead_id })
            .eq('id', row.id)
            .is('crm_lead_id', null);
          stats.submissions_crm_stamped += 1;
        }
      }

      if (!row.squadhire_business_user_id && !skipHire) {
        const hire = await resolveSquadhireBusiness(
          {
            email: row.email,
            contact_number: row.contact_number,
          },
          { persistTo: { table: 'client_submissions', id: row.id } },
        );
        if (hire.found) {
          await supabaseAdmin
            .from('client_submissions')
            .update({ squadhire_business_user_id: hire.business_user_id })
            .eq('id', row.id)
            .is('squadhire_business_user_id', null);
          stats.submissions_hire_stamped += 1;
        }
        // gentle throttle for Hire API
        await sleep(50);
      }
    } catch (err: any) {
      stats.errors.push(`submission ${row.id}: ${err?.message || err}`);
    }
  }

  // ── Clients missing external ids ──
  const { data: clients, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, email, contact_number, submission_id, crm_lead_id, squadhire_business_user_id')
    .or('crm_lead_id.is.null,squadhire_business_user_id.is.null')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (clientErr) stats.errors.push(`clients query: ${clientErr.message}`);

  for (const row of clients || []) {
    stats.clients_scanned += 1;
    try {
      // Prefer copy from linked submission first.
      if (row.submission_id) {
        await copyExternalLinksToClient(row.submission_id, row.id);
      }

      if (!row.crm_lead_id) {
        const crm = await resolveCrmLead({
          submission_id: row.submission_id,
          email: row.email,
          contact_number: row.contact_number,
        });
        if (crm.found) {
          await supabaseAdmin
            .from('clients')
            .update({ crm_lead_id: crm.lead_id })
            .eq('id', row.id)
            .is('crm_lead_id', null);
          stats.clients_crm_stamped += 1;
        }
      }

      if (!row.squadhire_business_user_id && !skipHire) {
        const hire = await resolveSquadhireBusiness({
          email: row.email,
          contact_number: row.contact_number,
        });
        if (hire.found) {
          await supabaseAdmin
            .from('clients')
            .update({ squadhire_business_user_id: hire.business_user_id })
            .eq('id', row.id)
            .is('squadhire_business_user_id', null);
          stats.clients_hire_stamped += 1;
        }
        await sleep(50);
      }
    } catch (err: any) {
      stats.errors.push(`client ${row.id}: ${err?.message || err}`);
    }
  }

  // ── Orphan subscription cards (no lead_submission_id) ──
  const { data: cards, error: cardErr } = await supabaseAdmin
    .from('subscription_cards')
    .select('id, customer_email, customer_phone, customer_name, customer_company')
    .is('lead_submission_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (cardErr) stats.errors.push(`cards query: ${cardErr.message}`);

  for (const card of cards || []) {
    stats.cards_scanned += 1;
    try {
      const sub = await findSubmissionByContact(card.customer_email, card.customer_phone);
      if (sub?.id) {
        await supabaseAdmin
          .from('subscription_cards')
          .update({ lead_submission_id: sub.id })
          .eq('id', card.id)
          .is('lead_submission_id', null);
        stats.cards_linked += 1;
      }
    } catch (err: any) {
      stats.errors.push(`card ${card.id}: ${err?.message || err}`);
    }
  }

  // ── Orphan job cards ──
  const { data: jobCards, error: jobErr } = await supabaseAdmin
    .from('job_cards')
    .select('id, customer_email, customer_phone, customer_name, customer_company')
    .is('lead_submission_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (jobErr) stats.errors.push(`job_cards query: ${jobErr.message}`);

  for (const card of jobCards || []) {
    stats.job_cards_scanned += 1;
    try {
      const sub = await findSubmissionByContact(card.customer_email, card.customer_phone);
      if (sub?.id) {
        await supabaseAdmin
          .from('job_cards')
          .update({ lead_submission_id: sub.id })
          .eq('id', card.id)
          .is('lead_submission_id', null);
        stats.job_cards_linked += 1;
      }
    } catch (err: any) {
      stats.errors.push(`job_card ${card.id}: ${err?.message || err}`);
    }
  }

  return stats;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
