import { config } from '../config';

const FETCH_TIMEOUT_MS = 10_000;

export interface SquadhireBusinessSsoIdentity {
  business_user_id: string;
  email: string;
  name: string | null;
  company_name: string | null;
  phone: string | null;
}

/**
 * Redeem a one-time SquadHire sign-in code for the business's identity.
 *
 * The inbound half of "Open SquadHub" auto-login: a business user taps the
 * SquadHub tab in SquadHire's portal, SquadHire mints an opaque single-use code
 * and sends their browser here with it, and we exchange it server-to-server for
 * who they are. SquadHire is the identity provider in this direction — the
 * exact mirror of /sso/squadhire, where we are the provider for SquadHire's
 * staff portal.
 *
 * The code is worthless on its own: only a caller holding the shared secret can
 * redeem it, it dies on first use, and it expires within minutes. No password
 * or token crosses either way.
 *
 * Returns null on any failure (unconfigured, unreachable, bad code), so callers
 * fall through to an ordinary sign-in error and an outage can never become an
 * auth bypass.
 */
export async function redeemSquadhireBusinessSsoCode(
  code: string,
): Promise<SquadhireBusinessSsoIdentity | null> {
  if (!code) return null;

  const base = config.squadhireWebhookUrl;
  if (!base || !config.squadhireWebhookSecret) return null;

  try {
    const url = new URL(base);
    url.pathname = '/api/integrations/squadhub/business/sso/token';
    url.search = '';

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      // 400 is the ordinary "already used / expired" case — the user just
      // needs to tap the tab again.
      console.error(`[squadhire-business-sso] SquadHire responded ${res.status}`);
      return null;
    }

    const payload = (await res.json()) as {
      success?: boolean;
      data?: Partial<SquadhireBusinessSsoIdentity> | null;
    };

    const data = payload?.data;
    const email = (data?.email || '').trim().toLowerCase();
    if (!data?.business_user_id || !email) return null;

    return {
      business_user_id: String(data.business_user_id),
      email,
      name: data.name ?? null,
      company_name: data.company_name ?? null,
      phone: data.phone ?? null,
    };
  } catch (err: any) {
    console.error('[squadhire-business-sso] fetch failed:', err?.message);
    return null;
  }
}
