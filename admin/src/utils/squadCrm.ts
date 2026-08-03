// Squad CRM lives at crm.squadhub.in and shares this Supabase project,
// so the server can resolve a SquadHub contact/client to its CRM counterpart
// by submission_id → phone (E.164 suffix) → email. This helper hits the
// /admin/clients/lookup-crm-lead endpoint and opens the matched lead in
// a new tab, falling back to the CRM leads list when nothing matches or
// the lookup fails.

import api from '@/services/api';

export const SQUAD_CRM_URL = 'https://crm.squadhub.in';

export type CrmLookupInput = {
  submission_id?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type CrmMatch = {
  found: boolean;
  lead_id?: string;
  matched_by?: string;
};

export async function openLeadInCRM(input: CrmLookupInput): Promise<void> {
  const fallback = `${SQUAD_CRM_URL}/app/leads`;
  const params = new URLSearchParams();
  if (input.submission_id) params.set('submission_id', input.submission_id);
  if (input.phone) params.set('phone', input.phone);
  if (input.email) params.set('email', input.email);

  if (params.toString().length === 0) {
    window.open(fallback, '_blank', 'noopener');
    return;
  }
  try {
    const r = await api.get(`/admin/clients/lookup-crm-lead?${params.toString()}`);
    const leadId: string | undefined = r.data?.data?.lead_id;
    const target = leadId ? `${SQUAD_CRM_URL}/app/leads/${leadId}` : fallback;
    window.open(target, '_blank', 'noopener');
  } catch {
    window.open(fallback, '_blank', 'noopener');
  }
}

/** Open a known CRM lead id, or fall back to the leads list. */
export function openCrmLeadById(leadId: string | null | undefined): void {
  const target = leadId
    ? `${SQUAD_CRM_URL}/app/leads/${leadId}`
    : `${SQUAD_CRM_URL}/app/leads`;
  window.open(target, '_blank', 'noopener');
}
