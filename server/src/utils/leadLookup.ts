import { supabaseAdmin } from '../supabase';

/**
 * Lead (client_submissions) lookup + find-or-create by contact identity.
 *
 * Extracted from routes/leads-public.ts so the Job Cards brief can reuse the
 * exact matching rules the public brief form uses: case-insensitive email
 * first, then last-10-digit phone suffix. Job cards then link DIRECTLY via
 * job_cards.lead_submission_id (no read-time email re-matching — that
 * fragility is what this module exists to avoid).
 */

// Last 10 digits is the universal phone identity in this system (the admin
// Squad-CRM lookup uses the same shape). 7+ digits guards against trivial
// partial matches.
export function phoneSuffix(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

// Returns the most recently matching client_submissions row, or null.
// Matches case-insensitive email first; falls back to last-10-digit phone
// suffix (mirrors migration 081's backfill regex and /leads/lookup).
export async function findSubmissionByContact(
  email?: string | null,
  phone?: string | null,
): Promise<any | null> {
  const normEmail = email?.trim().toLowerCase() || null;
  const suffix = phoneSuffix(phone);

  if (normEmail) {
    const { data } = await supabaseAdmin
      .from('client_submissions')
      .select('*')
      .ilike('email', normEmail)
      .order('created_at', { ascending: false })
      .limit(1);
    if (data && data.length > 0) return data[0];
  }

  if (suffix) {
    // PostgREST can't do right(regexp_replace(...)) directly; pull a small
    // candidate set filtered to rows ending in the last four digits, then
    // match the full suffix in-process.
    const tail4 = suffix.slice(-4);
    const { data } = await supabaseAdmin
      .from('client_submissions')
      .select('*')
      .ilike('contact_number', `%${tail4}`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) {
      for (const row of data) {
        const rowSuffix = phoneSuffix(row.contact_number);
        if (rowSuffix && rowSuffix === suffix) return row;
      }
    }
  }

  return null;
}

export interface FindOrCreateSubmissionInput {
  email?: string | null;
  phone?: string | null;
  contact_name?: string | null;
  business_name?: string | null;
  /** Optional; validated against countries. client_submissions.country_id is
   *  NOT NULL, so when absent we fall back to India (the hiring service's
   *  home market) and the admin can rebill later. */
  country_id?: string | null;
}

/**
 * Find-or-create a client_submissions lead by contact identity. Returns the
 * row, or null when creation failed (callers treat the lead link as
 * best-effort — a job card with lead_submission_id NULL is still valid).
 */
export async function findOrCreateSubmissionByContact(
  input: FindOrCreateSubmissionInput,
): Promise<any | null> {
  const existing = await findSubmissionByContact(input.email, input.phone);
  if (existing) return existing;

  // Need at least one contact identity to create a meaningful lead.
  if (!input.email?.trim() && !phoneSuffix(input.phone)) return null;

  let countryId: string | null = null;
  if (input.country_id) {
    const { data: countryRow } = await supabaseAdmin
      .from('countries')
      .select('id')
      .eq('id', input.country_id)
      .maybeSingle();
    countryId = (countryRow as any)?.id ?? null;
  }
  if (!countryId) {
    const { data: fallback } = await supabaseAdmin
      .from('countries')
      .select('id')
      .ilike('name', 'India')
      .maybeSingle();
    countryId = (fallback as any)?.id ?? null;
  }
  if (!countryId) {
    console.error('[leadLookup] cannot create lead — no country resolvable');
    return null;
  }

  const { data: created, error } = await supabaseAdmin
    .from('client_submissions')
    .insert({
      business_name: input.business_name?.trim() || input.contact_name?.trim() || 'Unknown business',
      contact_person: input.contact_name?.trim() || 'Unknown',
      contact_number: input.phone?.trim() || '',
      email: input.email?.trim().toLowerCase() || '',
      country_id: countryId,
      status: 'new',
    })
    .select('*')
    .single();
  if (error || !created) {
    console.error('[leadLookup] lead create failed', error?.message);
    return null;
  }
  return created;
}

/**
 * Resolve the converted clients row for a submission, or null when the lead
 * hasn't converted yet. Lets job cards stamp client_id alongside
 * lead_submission_id when the client already exists.
 */
export async function findClientForSubmission(submissionId: string): Promise<{ id: string } | null> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('submission_id', submissionId)
    .maybeSingle();
  return (data as any) ?? null;
}
