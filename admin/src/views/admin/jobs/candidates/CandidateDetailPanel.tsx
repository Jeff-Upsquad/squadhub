'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { JobCard } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import SliderPanel from '../../clients/SliderPanel';
import InterviewConsole from './InterviewConsole';
import InterviewScheduleDialog from './InterviewScheduleDialog';
import HireDialog from './HireDialog';
import OfferComposer from '../offers/OfferComposer';
import OfferNegotiationThread from '../offers/OfferNegotiationThread';
import { candidateStatusPill } from './CandidateRow';
import type { CandidateWithFunnel } from './JobCandidatesView';

// Per-candidate drilldown — review actions, interview rounds timeline,
// offers + negotiation, hire & mark-joined. Every write is a signed proxy to
// SquadHire (canonical); the local mirror re-renders off the echo.

type ReviewAction = 'shortlist' | 'reject' | 'on-hold' | 'select';

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function CandidateDetailPanel({
  card,
  candidate,
  onClose,
}: {
  card: JobCard;
  candidate: CandidateWithFunnel;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [hireOpen, setHireOpen] = useState(false);

  const name = candidate.talent_name || candidate.talent_email || 'Unknown talent';
  const pill = candidateStatusPill(candidate.status);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-job-card-candidates', card.id] });
    qc.invalidateQueries({ queryKey: ['admin-job-cards'] });
  };

  const review = useMutation({
    mutationFn: (action: ReviewAction) =>
      api.post(`/admin/job-cards/${card.id}/candidates/${candidate.external_candidate_id}/${action}`, {}),
    onSuccess: (_res, action) => {
      invalidate();
      const labels: Record<ReviewAction, string> = {
        shortlist: 'Candidate shortlisted.',
        reject: 'Candidate rejected — they will be notified.',
        'on-hold': 'Candidate put on hold.',
        select: 'Candidate selected — ready for an offer.',
      };
      showToast(labels[action], 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Review action failed', 'error');
    },
  });

  const markJoined = useMutation({
    mutationFn: () =>
      api.post(`/admin/job-cards/${card.id}/candidates/${candidate.external_candidate_id}/mark-joined`, {}),
    onSuccess: () => {
      invalidate();
      showToast(`${name} marked as joined — Placed.`, 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to mark joined', 'error');
    },
  });

  const busy = review.isPending || markJoined.isPending;
  const s = candidate.status;

  // Which actions make sense at this point of the funnel (Profiles still
  // validates canonically — these are affordances, not the state machine).
  const canShortlist = ['applied', 'screening', 'on_hold'].includes(s);
  const canSelect = ['interview', 'on_hold', 'shortlisted'].includes(s);
  const canReject = !['rejected', 'withdrawn', 'hired', 'joined'].includes(s);
  const canHold = ['applied', 'screening', 'shortlisted', 'interview'].includes(s);
  const canCallInterview = ['shortlisted', 'interview', 'on_hold'].includes(s);
  const canOffer = ['interview', 'shortlisted', 'on_hold'].includes(s) || s === 'offer';
  const canHire = s === 'offer_accepted';
  const canMarkJoined = s === 'hired';

  const timeline: { label: string; at: string | null }[] = [
    { label: 'Applied', at: candidate.applied_at },
    { label: 'Screening', at: candidate.screening_started_at },
    { label: 'Shortlisted', at: candidate.shortlisted_at },
    { label: 'First interview', at: candidate.first_interview_at },
    { label: 'Offered', at: candidate.offered_at },
    { label: 'Offer accepted', at: candidate.offer_accepted_at },
    { label: 'Hired', at: candidate.hired_at },
    { label: 'Joined', at: candidate.joined_at },
    { label: 'Rejected', at: candidate.rejected_at },
  ];

  return (
    <SliderPanel open onClose={onClose} title={name} width="w-[620px]">
      <div className="space-y-5">
        {/* Identity + status */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {name}
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: pill.bg, color: pill.color }}>
                {pill.label}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-foreground-muted">
              {[candidate.talent_email, candidate.talent_phone].filter(Boolean).join(' · ') || 'No contact on file'}
            </p>
            {candidate.rejection_reason && (
              <p className="mt-1 text-[11px] text-red-600">
                Rejected{candidate.rejection_stage ? ` at ${candidate.rejection_stage}` : ''}: {candidate.rejection_reason}
              </p>
            )}
            {candidate.joining_date && (
              <p className="mt-1 text-[11px] text-foreground-muted">Joining date: {candidate.joining_date}</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-1.5">
          {canShortlist && (
            <button type="button" disabled={busy} onClick={() => review.mutate('shortlist')} className="rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
              Shortlist
            </button>
          )}
          {canCallInterview && (
            <button type="button" disabled={busy} onClick={() => setScheduleOpen(true)} className="rounded-md border border-divider px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground disabled:opacity-50">
              Call for interview
            </button>
          )}
          {canSelect && (
            <button type="button" disabled={busy} onClick={() => review.mutate('select')} className="rounded-md border border-divider px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground disabled:opacity-50">
              Select
            </button>
          )}
          {canOffer && (
            <button type="button" disabled={busy} onClick={() => setComposerOpen(true)} className="rounded-md border border-divider px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground disabled:opacity-50">
              Compose offer
            </button>
          )}
          {canHire && (
            <button type="button" disabled={busy} onClick={() => setHireOpen(true)} className="rounded-md bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
              Hire
            </button>
          )}
          {canMarkJoined && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Mark ${name} as joined? The candidate moves to Placed.`)) markJoined.mutate();
              }}
              className="rounded-md bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              Mark joined
            </button>
          )}
          {canHold && (
            <button type="button" disabled={busy} onClick={() => review.mutate('on-hold')} className="rounded-md border border-divider px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground disabled:opacity-50">
              On hold
            </button>
          )}
          {canReject && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Reject ${name}? They receive a rejection notification.`)) review.mutate('reject');
              }}
              className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
            >
              Reject
            </button>
          )}
        </div>

        {/* Funnel timeline */}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-dim">Timeline</h4>
          <ul className="space-y-1">
            {timeline
              .filter((t) => t.at)
              .map((t) => (
                <li key={t.label} className="flex items-center justify-between text-xs">
                  <span className="text-foreground">{t.label}</span>
                  <span className="text-foreground-dim">{formatDate(t.at)}</span>
                </li>
              ))}
            {timeline.every((t) => !t.at) && <li className="text-xs text-foreground-dim">No events yet.</li>}
          </ul>
        </section>

        {/* Interviews */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Interview rounds</h4>
            {canCallInterview && (
              <button type="button" onClick={() => setScheduleOpen(true)} className="text-[11px] font-semibold text-accent hover:underline">
                + Schedule round
              </button>
            )}
          </div>
          <InterviewConsole card={card} interviews={candidate.interviews} />
        </section>

        {/* Offers */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Offers</h4>
            {canOffer && (
              <button type="button" onClick={() => setComposerOpen(true)} className="text-[11px] font-semibold text-accent hover:underline">
                + Compose offer
              </button>
            )}
          </div>
          {candidate.offers.length === 0 ? (
            <p className="rounded-lg border border-dashed border-divider px-3 py-3 text-center text-xs text-foreground-dim">
              No offers yet.
            </p>
          ) : (
            <div className="space-y-2">
              {candidate.offers.map((offer) => (
                <OfferNegotiationThread key={offer.id} card={card} offer={offer} />
              ))}
            </div>
          )}
        </section>
      </div>

      {scheduleOpen && (
        <InterviewScheduleDialog
          card={card}
          shortlisted={[candidate]}
          defaultCandidateIds={[candidate.external_candidate_id]}
          onClose={() => setScheduleOpen(false)}
        />
      )}
      {composerOpen && (
        <OfferComposer
          card={card}
          selectable={[candidate]}
          defaultCandidateIds={[candidate.external_candidate_id]}
          onClose={() => setComposerOpen(false)}
        />
      )}
      {hireOpen && <HireDialog card={card} candidate={candidate} onClose={() => setHireOpen(false)} />}
    </SliderPanel>
  );
}
