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

export async function resolveCrmLead(
  fields: ContactFields,
  opts?: { persistTo?: { table: 'clients' | 'client_submissions'; id: string } },
): Promise<CrmLinkMatch> {
  // 0. Stored id
  if (fields.crm_lead_id) {
    return { found: true, lead_id: fields.crm_lead_id, matched_by: 'stored' };
  }

  const submissionId = fields.submission_id?.trim() || null;
  const phone = fields.contact_number?.trim() || null;
  const email = fields.email?.trim() || null;

  let leadId: string | null = null;
  let matchedBy: 'submission_id' | 'phone' | 'email' | null = null;

  if (submissionId) {
    const { data } = await supabaseAdmin
      .from('crm_leads')
      .select('id')
      .eq('sh_client_submission_id', submissionId)
      .is('merged_into_lead_id', null)
      .maybeSingle();
    if (data?.id) {
      leadId = data.id;
      matchedBy = 'submission_id';
    }
  }

  if (!leadId && phone) {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length >= 7) {
      const { data } = await supabaseAdmin
        .from('crm_leads')
        .select('id')
        .ilike('phone_e164', `%${cleaned}`)
        .is('merged_into_lead_id', null)
        .limit(1);
      if (data?.[0]?.id) {
        leadId = data[0].id;
        matchedBy = 'phone';
      }
    }
  }

  if (!leadId && email && email.includes('@')) {
    const { data } = await supabaseAdmin
      .from('crm_leads')
      .select('id')
      .ilike('email', email)
      .is('merged_into_lead_id', null)
      .limit(1);
    if (data?.[0]?.id) {
      leadId = data[0].id;
      matchedBy = 'email';
    }
  }

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
