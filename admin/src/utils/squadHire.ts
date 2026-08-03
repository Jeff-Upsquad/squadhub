// SquadHire (Profiles) business-user deep-links for the Clients module
// Connections panel. Lookup is email/phone soft-match via the SquadHub server
// (which calls SquadHire's signed integration endpoint).

import api from '@/services/api';

export type SquadhireBusinessMatch = {
  found: boolean;
  business_user_id?: string;
  company_name?: string;
  contact_person_name?: string;
  matched_by?: string;
  admin_url?: string | null;
  squadhireAdminUrl?: string | null;
};

export async function lookupSquadhireBusiness(input: {
  email?: string | null;
  phone?: string | null;
}): Promise<SquadhireBusinessMatch> {
  const params = new URLSearchParams();
  if (input.email) params.set('email', input.email);
  if (input.phone) params.set('phone', input.phone);
  if (params.toString().length === 0) return { found: false };

  try {
    const r = await api.get(`/admin/clients/lookup-squadhire-business?${params.toString()}`);
    return (r.data?.data as SquadhireBusinessMatch) || { found: false };
  } catch {
    return { found: false };
  }
}

export function openSquadhireBusiness(match: SquadhireBusinessMatch | null | undefined): void {
  if (!match?.found) return;
  const url =
    match.admin_url ||
    (match.squadhireAdminUrl && match.business_user_id
      ? `${match.squadhireAdminUrl.replace(/\/$/, '')}/business/${match.business_user_id}`
      : null);
  if (!url) return;
  window.open(url, '_blank', 'noopener');
}
