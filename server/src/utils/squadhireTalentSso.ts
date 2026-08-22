import { config } from '../config';

const FETCH_TIMEOUT_MS = 10_000;

export interface SquadhireTalentSsoIdentity {
  talent_user_id: string;
  email: string;
  name: string | null;
  phone: string | null;
  /** SquadHire category slug of the card that assigned them — picks the role. */
  category_slug: string | null;
}

/**
 * Redeem a one-time SquadHire sign-in code for a talent's identity.
 *
 * The talent twin of redeemSquadhireBusinessSsoCode: same single-use, secret-
 * gated exchange, but the payload also carries the category of the subscription
 * card they're assigned to, which is what decides their SquadHub role.
 *
 * Returns null on any failure (unconfigured, unreachable, bad code), so callers
 * fall through to an ordinary sign-in error and an outage can never become an
 * auth bypass.
 */
export async function redeemSquadhireTalentSsoCode(
  code: string,
): Promise<SquadhireTalentSsoIdentity | null> {
  if (!code) return null;

  const base = config.squadhireWebhookUrl;
  if (!base || !config.squadhireWebhookSecret) return null;

  try {
    const url = new URL(base);
    url.pathname = '/api/integrations/squadhub/talent/sso/token';
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
      // 400 is the ordinary "already used / expired" case.
      console.error(`[squadhire-talent-sso] SquadHire responded ${res.status}`);
      return null;
    }

    const payload = (await res.json()) as {
      success?: boolean;
      data?: Partial<SquadhireTalentSsoIdentity> | null;
    };

    const data = payload?.data;
    const email = (data?.email || '').trim().toLowerCase();
    if (!data?.talent_user_id || !email) return null;

    return {
      talent_user_id: String(data.talent_user_id),
      email,
      name: data.name ?? null,
      phone: data.phone ?? null,
      category_slug: data.category_slug ?? null,
    };
  } catch (err: any) {
    console.error('[squadhire-talent-sso] fetch failed:', err?.message);
    return null;
  }
}
