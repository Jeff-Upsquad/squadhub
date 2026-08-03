import { config } from '../config';

const FETCH_TIMEOUT_MS = 10_000;

export interface SquadhireBusinessMatch {
  business_user_id: string;
  company_name: string;
  contact_person_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  matched_by: 'email' | 'phone';
  admin_url: string | null;
}

/**
 * Ask SquadHire for a business_users row matching email and/or phone.
 * Uses the same signed integration base URL as talent/card webhooks.
 * Returns null when unconfigured, unreachable, or no match.
 */
export async function lookupSquadhireBusinessUser(input: {
  email?: string | null;
  phone?: string | null;
}): Promise<SquadhireBusinessMatch | null> {
  const email = (input.email || '').trim();
  const phone = (input.phone || '').trim();
  if (!email && !phone) return null;

  const base = config.squadhireWebhookUrl;
  if (!base || !config.squadhireWebhookSecret) return null;

  try {
    const url = new URL(base);
    url.pathname = '/api/integrations/squadhub/business/lookup';
    url.search = '';

    const body: Record<string, string> = {};
    if (email) body.email = email;
    if (phone) body.phone = phone;

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`[squadhire-business-lookup] SquadHire responded ${res.status}`);
      return null;
    }

    const payload = (await res.json()) as {
      success?: boolean;
      data?: SquadhireBusinessMatch | null;
    };
    if (!payload?.data?.business_user_id) return null;

    // Prefer SquadHire's admin_url when set; otherwise build from our config.
    let adminUrl = payload.data.admin_url;
    if (!adminUrl && config.squadhireAdminUrl) {
      const baseAdmin = config.squadhireAdminUrl.replace(/\/$/, '');
      adminUrl = `${baseAdmin}/business/${payload.data.business_user_id}`;
    }

    return { ...payload.data, admin_url: adminUrl };
  } catch (err: any) {
    console.error('[squadhire-business-lookup] fetch failed:', err?.message);
    return null;
  }
}
