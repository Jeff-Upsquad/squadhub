'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { JobCard, JobOffer, JobOfferStatus } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

// Negotiation controls for one offer. All actions proxy to SquadHire
// (canonical) and the echo updates this mirror. A counteroffer is FINAL by
// spec — after it the candidate can only accept / decline / ask a question
// (Profiles enforces the lockout with a 403/409).

const STATUS_PILL: Record<JobOfferStatus, { bg: string; color: string; label: string }> = {
  draft: { bg: '#EEF2F6', color: '#475569', label: 'Draft' },
  sent: { bg: '#DBEAFE', color: '#1E40AF', label: 'Sent' },
  viewed: { bg: '#E0F2FE', color: '#075985', label: 'Viewed' },
  negotiation_requested: { bg: '#FEF3C7', color: '#92400E', label: 'Negotiating' },
  countered: { bg: '#EDE9FE', color: '#6D28D9', label: 'Countered' },
  accepted: { bg: '#D1FAE5', color: '#065F46', label: 'Accepted' },
  declined: { bg: '#FEE2E2', color: '#B91C1C', label: 'Declined' },
  withdrawn: { bg: '#EEF2F6', color: '#475569', label: 'Withdrawn' },
  expired: { bg: '#EEF2F6', color: '#475569', label: 'Expired' },
};

const inputCls =
  'w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none';

function amountLine(offer: JobOffer): string {
  const parts: string[] = [];
  const cur = offer.compensation?.currency || offer.ctc_currency || 'INR';
  (['training', 'probation', 'confirmed'] as const).forEach((k) => {
    const c = offer.compensation?.[k];
    if (c?.amount != null) {
      parts.push(`${k === 'confirmed' ? 'After probation' : k.charAt(0).toUpperCase() + k.slice(1)}: ${cur} ${Number(c.amount).toLocaleString()} ${c.cadence === 'per_annum' ? '/yr' : '/mo'}`);
    }
  });
  if (offer.total_ctc != null) parts.push(`CTC: ${cur} ${Number(offer.total_ctc).toLocaleString()}`);
  return parts.join(' · ') || 'No package recorded';
}

export default function OfferNegotiationThread({
  card,
  offer,
}: {
  card: JobCard;
  offer: JobOffer;
}) {
  const qc = useQueryClient();
  const [counterOpen, setCounterOpen] = useState(false);
  const [counterAmount, setCounterAmount] = useState('');
  const [counterNote, setCounterNote] = useState('');
  const [showLetter, setShowLetter] = useState(false);

  const offerRef = offer.external_offer_id ?? offer.id;
  const pill = STATUS_PILL[offer.status] ?? { bg: '#EEF2F6', color: '#475569', label: offer.status };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-job-card-candidates', card.id] });
    qc.invalidateQueries({ queryKey: ['admin-job-cards'] });
  };

  const negotiation = useMutation({
    mutationFn: (action: 'accept' | 'decline') =>
      api.post(`/admin/job-cards/${card.id}/offers/${offerRef}/negotiation`, { action }),
    onSuccess: (_res, action) => {
      invalidate();
      showToast(action === 'accept' ? 'Negotiation accepted.' : 'Negotiation declined.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Negotiation action failed', 'error');
    },
  });

  const counter = useMutation({
    mutationFn: () => {
      const amount = counterAmount.trim() ? Math.round(Number(counterAmount)) : null;
      return api.post(`/admin/job-cards/${card.id}/offers/${offerRef}/counter`, {
        ...(amount != null && Number.isFinite(amount) && amount >= 0
          ? {
              compensation: { currency: offer.ctc_currency || 'INR', confirmed: { amount, cadence: 'per_month' } },
              total_ctc: amount * 12,
            }
          : {}),
        note: counterNote.trim() || undefined,
      });
    },
    onSuccess: () => {
      invalidate();
      setCounterOpen(false);
      showToast('Final counteroffer sent — the candidate can now only accept, decline, or ask a question.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Counteroffer failed', 'error');
    },
  });

  const withdraw = useMutation({
    mutationFn: () => api.post(`/admin/job-cards/${card.id}/offers/${offerRef}/withdraw`),
    onSuccess: () => {
      invalidate();
      showToast('Offer withdrawn — the candidate is notified.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Withdraw failed', 'error');
    },
  });

  const live = !['accepted', 'declined', 'withdrawn', 'expired'].includes(offer.status);
  const busy = negotiation.isPending || counter.isPending || withdraw.isPending;

  return (
    <div className="rounded-lg border border-divider bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {offer.position_title || 'Offer'}
            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: pill.bg, color: pill.color }}>
              {pill.label}
            </span>
            {offer.revision > 1 && (
              <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold text-foreground-muted">
                Rev {offer.revision}
              </span>
            )}
            {offer.is_final && (
              <span className="rounded-full bg-[#991B1B] px-2 py-0.5 text-[10px] font-semibold text-white" title="Final counteroffer — no further negotiation">
                FINAL
              </span>
            )}
            {offer.delivery_mode === 'manual_email' && (
              <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold text-foreground-dim">Manual email</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-foreground-muted">{amountLine(offer)}</p>
          <p className="mt-0.5 text-[11px] text-foreground-dim">
            {offer.join_by_date ? `Join by ${offer.join_by_date}` : ''}
            {offer.join_by_date && offer.offer_expires_at ? ' · ' : ''}
            {offer.offer_expires_at ? `Expires ${new Date(offer.offer_expires_at).toLocaleDateString()}` : ''}
          </p>
        </div>
        {offer.rendered_body_html && (
          <button
            type="button"
            onClick={() => setShowLetter((v) => !v)}
            className="shrink-0 rounded-md border border-divider px-2.5 py-1 text-[11px] font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground"
          >
            {showLetter ? 'Hide letter' : 'View letter'}
          </button>
        )}
      </div>

      {showLetter && offer.rendered_body_html && (
        <div className="mt-3 rounded-lg border border-divider bg-white p-4">
          <div
            className="max-w-none text-[13px] leading-relaxed text-[#222] [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-bold"
            dangerouslySetInnerHTML={{ __html: offer.rendered_body_html }}
          />
        </div>
      )}

      {live && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-divider pt-2.5">
          {offer.status === 'negotiation_requested' && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => negotiation.mutate('accept')}
                className="rounded-md bg-ink px-2.5 py-1 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                Accept negotiation
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => negotiation.mutate('decline')}
                className="rounded-md border border-divider px-2.5 py-1 text-[11px] font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground disabled:opacity-50"
              >
                Decline negotiation
              </button>
              {!offer.is_final && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCounterOpen((v) => !v)}
                  className="rounded-md border border-[#6D28D9]/30 bg-[#EDE9FE] px-2.5 py-1 text-[11px] font-semibold text-[#6D28D9] transition hover:bg-[#E4DEFC] disabled:opacity-50"
                >
                  Counteroffer (final)
                </button>
              )}
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Withdraw this offer? The candidate is notified and the offer closes.')) {
                withdraw.mutate();
              }
            }}
            className="rounded-md border border-red-200 px-2.5 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          >
            Withdraw
          </button>
        </div>
      )}

      {counterOpen && (
        <div className="mt-2.5 space-y-2 rounded-md border border-[#6D28D9]/20 bg-[#EDE9FE]/30 p-3">
          <p className="text-[11px] font-semibold text-[#6D28D9]">
            This counteroffer is FINAL — after it the candidate can only accept, decline, or ask a question.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              type="number"
              min={0}
              value={counterAmount}
              onChange={(e) => setCounterAmount(e.target.value)}
              placeholder={`Counter amount / month (${offer.ctc_currency || 'INR'})`}
              className={inputCls}
            />
            <input
              type="text"
              value={counterNote}
              onChange={(e) => setCounterNote(e.target.value)}
              placeholder="Note (optional)"
              className={inputCls}
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setCounterOpen(false)}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={counter.isPending}
              onClick={() => counter.mutate()}
              className="rounded-md bg-[#6D28D9] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {counter.isPending ? 'Sending…' : 'Send final counteroffer'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
