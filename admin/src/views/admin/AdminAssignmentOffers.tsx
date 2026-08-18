'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

interface OfferAmount {
  amount: number;
  currency?: string;
  period?: string;
  /** Talent-side pay derived from margin (when amount is business-side). */
  partner_amount?: number;
  margin_amount?: number;
  margin_type?: 'fixed' | 'percent' | null;
  margin_value?: number | null;
  side?: 'business' | 'talent';
}

interface BidPricing {
  min_customer_price: number | null;
  min_partner_price: number | null;
  margin_type: 'fixed' | 'percent' | null;
  margin_value: number | null;
}
interface OfferEvent {
  id: string;
  actor_type: string;
  action: string;
  amount: unknown;
  note: string | null;
  created_at: string;
}
interface AdminOffer {
  id: string;
  recipient_id: string;
  talent_user_id: string;
  talent_name: string;
  pricing_mode: 'priced' | 'unpriced';
  current_amount: OfferAmount;
  status: string;
  last_actor_side: string | null;
  created_at: string;
  updated_at: string;
  events: OfferEvent[];
}

const OFFER_STEP = 500;

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending_business: { label: 'Needs review', cls: 'bg-[#FEF3C7] text-[#92400E]' },
  pending_talent: { label: 'Awaiting talent', cls: 'bg-[#EEF2F6] text-[#475569]' },
  accepted: { label: 'Accepted', cls: 'bg-[#DCFCE7] text-[#166534]' },
  declined: { label: 'Declined', cls: 'bg-[#F1F1F3] text-[#737373]' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-[#F1F1F3] text-[#737373]' },
  expired: { label: 'Expired', cls: 'bg-[#F1F1F3] text-[#737373]' },
};

function fmtAmount(a: unknown): string | null {
  if (!a || typeof a !== 'object') return null;
  const o = a as OfferAmount;
  if (typeof o.amount !== 'number') return null;
  const cur = o.currency && o.currency !== 'INR' ? `${o.currency} ` : '₹';
  const business = `${cur}${o.amount.toLocaleString()}`;
  if (typeof o.partner_amount === 'number') {
    return `${business} business · ${cur}${o.partner_amount.toLocaleString()} talent`;
  }
  return business;
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  return `₹${n.toLocaleString()}`;
}

function fmtDate(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
}

export default function AdminAssignmentOffers({
  cardId,
  onOpenChat,
  clientView = false,
}: {
  cardId: string;
  onOpenChat?: (talentUserId: string, talentName: string) => void;
  /** Hide admin-only pricing (margin / talent floor) so the section matches the business review screen. */
  clientView?: boolean;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-assignment-offers', cardId],
    queryFn: () =>
      api
        .get(`/admin/subscription-cards/${cardId}/offers`)
        .then((r) => r.data as { source: string; offers: AdminOffer[]; bid_pricing?: BidPricing | null }),
    refetchInterval: 20_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-assignment-offers', cardId] });
    qc.invalidateQueries({ queryKey: ['admin-card-recipients', cardId] });
    // Accepted bid locks subscription_price / partner_price_override on the
    // card — refresh lists + open-card detail so Final price appears.
    qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
    qc.invalidateQueries({ queryKey: ['admin-card'] });
    qc.invalidateQueries({ queryKey: ['admin-card-detail', cardId] });
  };
  const counter = useMutation({
    mutationFn: (v: { offerId: string; amount: OfferAmount; note?: string }) =>
      api.post(`/admin/subscription-cards/${cardId}/offers/${v.offerId}/counter`, { amount: v.amount, ...(v.note ? { note: v.note } : {}) }),
    onSuccess: () => {
      invalidate();
      showToast('Counter-offer sent', 'success');
    },
    onError: (e: any) => showToast(e?.response?.data?.error || 'Could not send counter', 'error'),
  });
  const accept = useMutation({
    mutationFn: (offerId: string) => api.post(`/admin/subscription-cards/${cardId}/offers/${offerId}/accept`, {}),
    onSuccess: () => {
      invalidate();
      showToast('Bid accepted — talent shortlisted; Select from the funnel', 'success');
    },
    onError: (e: any) => showToast(e?.response?.data?.error || 'Could not accept', 'error'),
  });
  const decline = useMutation({
    mutationFn: (offerId: string) => api.post(`/admin/subscription-cards/${cardId}/offers/${offerId}/decline`, {}),
    onSuccess: () => {
      invalidate();
      showToast('Offer declined', 'success');
    },
    onError: (e: any) => showToast(e?.response?.data?.error || 'Could not decline', 'error'),
  });

  const [counterFor, setCounterFor] = useState<string | null>(null);
  const [counterVal, setCounterVal] = useState('');
  const [openThread, setOpenThread] = useState<string | null>(null);

  const offers = data?.offers ?? [];
  const source = data?.source;
  const bidPricing = data?.bid_pricing ?? null;
  const busy = counter.isPending || accept.isPending || decline.isPending;
  const minBusiness = bidPricing?.min_customer_price ?? null;

  const submitCounter = (offerId: string) => {
    const n = Math.round(Number(counterVal));
    if (!Number.isFinite(n) || n <= 0 || n % OFFER_STEP !== 0) {
      showToast(`Amount must be a positive multiple of ₹${OFFER_STEP}`, 'error');
      return;
    }
    if (minBusiness != null && n < minBusiness) {
      showToast(`Business bid cannot be below catalog min ${fmtMoney(minBusiness)}`, 'error');
      return;
    }
    counter.mutate(
      { offerId, amount: { amount: n, currency: 'INR', period: 'project' } },
      {
        onSuccess: () => {
          setCounterFor(null);
          setCounterVal('');
        },
      },
    );
  };

  const marginHint =
    bidPricing?.margin_type === 'percent' && bidPricing.margin_value != null
      ? `${bidPricing.margin_value}% (₹ cut rounds up to nearest ₹100)`
      : bidPricing?.margin_type === 'fixed' && bidPricing.margin_value != null
        ? `₹${bidPricing.margin_value.toLocaleString()} fixed`
        : null;

  return (
    <div className="rounded-2xl border border-[#E7E7EA] bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between border-b border-[#E7E7EA] px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Bidding</h2>
          {!clientView && (minBusiness != null || marginHint) && (
            <p className="mt-0.5 text-[11px] text-foreground-muted">
              {minBusiness != null && (
                <>Min business {fmtMoney(minBusiness)} · Min talent {fmtMoney(bidPricing?.min_partner_price)}</>
              )}
              {minBusiness != null && marginHint ? ' · ' : null}
              {marginHint ? <>Margin {marginHint}</> : null}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!clientView && source === 'live' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[10px] font-semibold text-[#166534]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A]" /> Live
            </span>
          )}
          {source === 'unavailable' && (
            <span className="rounded-full bg-[#FEE2E2] px-2 py-0.5 text-[10px] font-semibold text-[#991B1B]">SquadHire unavailable</span>
          )}
          <span className="text-xs text-foreground-muted">{offers.length}</span>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-[#F1F1F3]" />
          ))}
        </div>
      ) : source === 'unavailable' ? (
        <div className="px-6 py-8 text-center text-sm text-foreground-muted">
          Live offer data is fetched from SquadHire and is momentarily unavailable. It will reappear automatically.
        </div>
      ) : offers.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-foreground-muted">
          No bids yet. Talent bids and business offers appear here live from SquadHire.
        </div>
      ) : (
        <ul className="divide-y divide-[#E7E7EA]">
          {offers.map((o) => {
            const meta = { ...(STATUS_META[o.status] ?? { label: o.status, cls: 'bg-[#F1F1F3] text-[#737373]' }) };
            if (clientView && o.status === 'pending_business') meta.label = 'Your move';
            const canAct = o.status === 'pending_business';
            return (
              <li key={o.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold text-foreground">{o.talent_name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}>{meta.label}</span>
                      <span className="rounded-full bg-[#F1F1F3] px-2 py-0.5 text-[10px] font-medium text-[#525252]">{o.pricing_mode}</span>
                    </div>
                    <p className="mt-1 text-sm text-foreground">
                      <span className="text-foreground-muted">
                        {o.status === 'accepted'
                          ? 'Final agreed'
                          : o.status === 'pending_business'
                            ? 'Talent asks'
                            : o.status === 'pending_talent'
                              ? 'You offered'
                              : 'Latest'}
                        :
                      </span>{' '}
                      <span className="font-semibold">{fmtAmount(o.current_amount) ?? '—'}</span>
                    </p>
                    {o.events.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setOpenThread((t) => (t === o.id ? null : o.id))}
                        className="mt-1 text-xs font-semibold text-[#525252] underline underline-offset-2 hover:text-foreground"
                      >
                        {openThread === o.id ? 'Hide' : 'View'} activity ({o.events.length})
                      </button>
                    )}
                  </div>

                  {(canAct || onOpenChat) && (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {onOpenChat && o.talent_user_id && (
                        <button
                          type="button"
                          onClick={() => onOpenChat(o.talent_user_id, o.talent_name)}
                          className="rounded-lg border border-[#E7E7EA] px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-[#F5F5F6]"
                        >
                          Chatroom
                        </button>
                      )}
                      {canAct && (
                        <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => decline.mutate(o.id)}
                        className="rounded-lg border border-[#E7E7EA] px-3 py-1.5 text-xs font-semibold text-[#737373] transition-colors hover:text-red-600 disabled:opacity-40"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setCounterFor((c) => (c === o.id ? null : o.id));
                          setCounterVal('');
                        }}
                        className="rounded-lg border border-[#E7E7EA] px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-[#F5F5F6] disabled:opacity-40"
                      >
                        Counter
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => accept.mutate(o.id)}
                        className="rounded-lg bg-[#0a0a0a] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#1a1a1a] disabled:opacity-40"
                      >
                        Accept bid
                      </button>
                        </>
                      )}
                    </div>
                  )}
                  {o.status === 'pending_talent' && (
                    <span className="shrink-0 self-center text-xs text-foreground-muted">Awaiting the talent…</span>
                  )}
                </div>

                {counterFor === o.id && (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setCounterVal((v) =>
                          String(Math.max(OFFER_STEP, (Number(v) || OFFER_STEP) - OFFER_STEP)),
                        )
                      }
                      className="rounded-lg border border-[#E7E7EA] px-2.5 py-1.5 text-sm font-semibold disabled:opacity-40"
                    >
                      −{OFFER_STEP}
                    </button>
                    <input
                      type="number"
                      min={OFFER_STEP}
                      step={OFFER_STEP}
                      value={counterVal}
                      onChange={(e) => setCounterVal(e.target.value)}
                      placeholder={
                        minBusiness != null
                          ? `Business figure (min ₹${minBusiness.toLocaleString()})`
                          : 'Business figure (₹)'
                      }
                      className="w-52 rounded-lg border border-[#E7E7EA] bg-surface px-3 py-1.5 text-sm text-foreground"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setCounterVal((v) => String((Number(v) || 0) + OFFER_STEP))
                      }
                      className="rounded-lg border border-[#E7E7EA] px-2.5 py-1.5 text-sm font-semibold disabled:opacity-40"
                    >
                      +{OFFER_STEP}
                    </button>
                    <button
                      type="button"
                      disabled={busy || !(Number(counterVal) > 0) || Number(counterVal) % OFFER_STEP !== 0}
                      onClick={() => submitCounter(o.id)}
                      className="rounded-lg bg-[#0a0a0a] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      Send counter
                    </button>
                  </div>
                )}

                {openThread === o.id && o.events.length > 0 && (
                  <ul className="mt-3 divide-y divide-[#E7E7EA] rounded-xl border border-[#E7E7EA]">
                    {o.events.map((e) => {
                      const amt = fmtAmount(e.amount);
                      const who = e.actor_type === 'business' ? 'Business' : e.actor_type === 'talent' ? o.talent_name : e.actor_type === 'admin' ? 'Admin' : 'System';
                      return (
                        <li key={e.id} className="px-3.5 py-2.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-xs text-foreground">
                              <span className="font-semibold">{who}</span>{' '}
                              <span className="text-foreground-muted">{e.action.replace(/_/g, ' ')}</span>
                            </p>
                            <span className="shrink-0 text-[10px] text-[#a3a3a3]">{fmtDate(e.created_at)}</span>
                          </div>
                          {amt && (
                            <p className="mt-0.5 text-[11px] text-foreground-muted">
                              Figure: <span className="font-semibold">{amt}</span>
                            </p>
                          )}
                          {e.note && <p className="mt-1 whitespace-pre-line rounded-lg bg-[#F5F5F6] px-2.5 py-1.5 text-[11px] text-[#525252]">{e.note}</p>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
