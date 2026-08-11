// ============================================================
// lockAcceptedBidPrice
//
// When bidding ends and a talent is accepted / selected, freeze the
// negotiated figures onto the subscription card so admin + Leads mini-app
// show the final agreed price (business pay + talent earn).
//
//   subscription_price      ← business (customer) amount
//   partner_price_override  ← talent (partner) amount
//
// Amounts come from SquadHire's live offers snapshot (status='accepted'),
// or from an explicit amount the caller already knows (admin accept path).
// ============================================================

import {
  customerPriceFromPartner,
  partnerPriceFromCustomer,
} from '@squadhub/shared';
import { config } from '../config';
import { supabaseAdmin } from '../supabase';
import { expandBusinessBid, loadCardBidPricing } from './cardBidPricing';

const LIVE_TIMEOUT_MS = 5_000;

interface OfferAmount {
  amount?: number;
  partner_amount?: number;
  side?: 'business' | 'talent' | string;
  currency?: string;
  period?: string;
}

interface SnapshotOffer {
  id?: string;
  status?: string;
  talent_user_id?: string;
  recipient_id?: string;
  current_amount?: OfferAmount | null;
}

function buildOffersUrl(): string | null {
  if (!config.squadhireWebhookUrl || !config.squadhireWebhookSecret) return null;
  try {
    const url = new URL(config.squadhireWebhookUrl);
    // Webhook base ends in /squadhub/cards — offers-snapshot sits beside it.
    url.pathname = url.pathname.replace(/\/?$/, '') + '/offers-snapshot';
    url.search = '';
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchOffersSnapshot(cardId: string): Promise<SnapshotOffer[]> {
  const endpoint = buildOffersUrl();
  if (!endpoint || !config.squadhireWebhookSecret) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: JSON.stringify({ external_id: cardId, source: 'squadhub' }),
      signal: controller.signal,
    });
    if (!upstream.ok) return [];
    const json = (await upstream.json()) as { snapshot?: { offers?: SnapshotOffer[] } };
    return Array.isArray(json?.snapshot?.offers) ? json.snapshot!.offers! : [];
  } catch (err) {
    console.warn(
      '[lockAcceptedBidPrice] offers snapshot failed',
      cardId,
      (err as Error)?.message,
    );
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function pickAcceptedOffer(
  offers: SnapshotOffer[],
  talentUserId?: string | null,
  offerId?: string | null,
): SnapshotOffer | null {
  const accepted = offers.filter((o) => o.status === 'accepted');
  if (offerId) {
    const byId = accepted.find((o) => o.id === offerId) || offers.find((o) => o.id === offerId);
    if (byId) return byId;
  }
  if (talentUserId) {
    const forTalent = accepted.find((o) => o.talent_user_id === talentUserId);
    if (forTalent) return forTalent;
  }
  // Most recent accepted if multiple (array order is best-effort).
  return accepted[0] ?? null;
}

/**
 * Normalize an offer amount into business + partner figures using the card's
 * live margin rules when only one side is present.
 */
async function resolveDualAmount(
  cardId: string,
  raw: OfferAmount | null | undefined,
): Promise<{ business: number; partner: number } | null> {
  if (!raw || typeof raw.amount !== 'number' || !(raw.amount > 0)) return null;
  const amount = Math.round(raw.amount);
  const partnerHint =
    typeof raw.partner_amount === 'number' && raw.partner_amount >= 0
      ? Math.round(raw.partner_amount)
      : null;

  if (partnerHint != null && (raw.side === 'business' || raw.side == null)) {
    return { business: amount, partner: partnerHint };
  }
  if (raw.side === 'talent') {
    const ctx = await loadCardBidPricing(cardId);
    const business = customerPriceFromPartner(amount, ctx?.card ?? {}, ctx?.pricing ?? null);
    return { business, partner: amount };
  }
  // Default: amount is business-side (admin counters + listed customer price).
  try {
    const ctx = await loadCardBidPricing(cardId);
    if (ctx) {
      const expanded = expandBusinessBid(amount, ctx);
      return { business: expanded.amount, partner: expanded.partner_amount };
    }
  } catch {
    // Min-floor rejection shouldn't block locking an already-accepted figure —
    // fall through to plain margin math.
  }
  const ctx = await loadCardBidPricing(cardId);
  const partner =
    partnerHint ??
    partnerPriceFromCustomer(amount, ctx?.card ?? {}, ctx?.pricing ?? null);
  return { business: amount, partner };
}

export interface LockAcceptedBidResult {
  locked: boolean;
  business_price?: number;
  partner_price?: number;
  reason?: string;
}

/**
 * Freeze the accepted bid for a card (and optional talent) onto
 * subscription_price + partner_price_override.
 */
export async function lockAcceptedBidPrice(opts: {
  cardId: string;
  /** Prefer the accepted offer for this SquadHire talent. */
  talentUserId?: string | null;
  /** Prefer this offer id when known (admin accept path). */
  offerId?: string | null;
  /** When the caller already has the amount (skips snapshot if enough). */
  amount?: OfferAmount | null;
}): Promise<LockAcceptedBidResult> {
  const { cardId, talentUserId, offerId } = opts;

  let dual: { business: number; partner: number } | null = null;
  if (opts.amount) {
    dual = await resolveDualAmount(cardId, opts.amount);
  }
  if (!dual) {
    const offers = await fetchOffersSnapshot(cardId);
    const offer = pickAcceptedOffer(offers, talentUserId, offerId);
    if (!offer) {
      return { locked: false, reason: 'no_accepted_offer' };
    }
    dual = await resolveDualAmount(cardId, offer.current_amount);
  }
  if (!dual) {
    return { locked: false, reason: 'no_amount_on_offer' };
  }

  const { error } = await supabaseAdmin
    .from('subscription_cards')
    .update({
      subscription_price: dual.business,
      partner_price_override: dual.partner,
    })
    .eq('id', cardId);

  if (error) {
    console.error('[lockAcceptedBidPrice] update failed', cardId, error.message);
    return { locked: false, reason: error.message };
  }

  return {
    locked: true,
    business_price: dual.business,
    partner_price: dual.partner,
  };
}
