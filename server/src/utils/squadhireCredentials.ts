import { config } from '../config';

const FETCH_TIMEOUT_MS = 10_000;

export interface SquadhireBusinessIdentity {
  business_user_id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  company_name: string | null;
}

export interface SquadhireTalentIdentity {
  talent_user_id: string;
  email: string;
  phone: string | null;
  name: string | null;
}

/**
 * Ask SquadHire whether this email + password really is a business user's
 * SquadHire login.
 *
 * Used once per account, on the business user's first SquadHub sign-in: if the
 * credentials check out we create their SquadHub account with the same
 * password, so "use your SquadHire login" works without either side ever
 * holding the other's password hash. After that the two accounts are
 * independent — this is a seed, not a sync.
 *
 * Returns null on any failure (unconfigured, unreachable, bad credentials), so
 * callers fall through to the ordinary "invalid email or password" response and
 * an outage can never turn into an auth bypass.
 *
 * SquadHire deliberately answers identically for a wrong password, an unknown
 * email and a not-yet-activated account, so nothing here can be used to probe
 * which emails exist.
 */
export async function verifySquadhireBusinessCredentials(input: {
  email: string;
  password: string;
}): Promise<SquadhireBusinessIdentity | null> {
  const email = (input.email || '').trim();
  if (!email || !input.password) return null;

  const base = config.squadhireWebhookUrl;
  if (!base || !config.squadhireWebhookSecret) return null;

  try {
    const url = new URL(base);
    url.pathname = '/api/integrations/squadhub/business/verify-credentials';
    url.search = '';

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: JSON.stringify({ email, password: input.password }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error(`[squadhire-credentials] SquadHire responded ${res.status}`);
      return null;
    }

    const payload = (await res.json()) as {
      success?: boolean;
      data?: ({ valid?: boolean } & Partial<SquadhireBusinessIdentity>) | null;
    };

    const data = payload?.data;
    if (!data?.valid || !data.business_user_id) return null;

    return {
      business_user_id: data.business_user_id,
      email: data.email ?? null,
      phone: data.phone ?? null,
      name: data.name ?? null,
      company_name: data.company_name ?? null,
    };
  } catch (err: any) {
    console.error('[squadhire-credentials] fetch failed:', err?.message);
    return null;
  }
}

/** Verify an assigned talent's SquadHire password without exposing a session. */
export async function verifySquadhireTalentCredentials(input: {
  email: string;
  password: string;
}): Promise<SquadhireTalentIdentity | null> {
  const email = (input.email || '').trim();
  if (!email || !input.password) return null;

  const base = config.squadhireWebhookUrl;
  if (!base || !config.squadhireWebhookSecret) return null;

  try {
    const url = new URL(base);
    url.pathname = '/api/integrations/squadhub/talent/verify-credentials';
    url.search = '';

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: JSON.stringify({ email, password: input.password }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[squadhire-credentials] talent verification responded ${res.status}`);
      return null;
    }

    const payload = (await res.json()) as {
      success?: boolean;
      data?: ({ valid?: boolean } & Partial<SquadhireTalentIdentity>) | null;
    };
    const data = payload?.data;
    if (!data?.valid || !data.talent_user_id || !data.email) return null;

    return {
      talent_user_id: data.talent_user_id,
      email: data.email,
      phone: data.phone ?? null,
      name: data.name ?? null,
    };
  } catch (err: any) {
    console.error('[squadhire-credentials] talent verification failed:', err?.message);
    return null;
  }
}
