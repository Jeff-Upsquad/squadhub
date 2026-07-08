'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JobCard, JobCardCandidate, JobInterview, JobOffer } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import CandidateRow from './CandidateRow';
import CandidateDetailPanel from './CandidateDetailPanel';
import InterviewScheduleDialog from './InterviewScheduleDialog';
import OfferComposer from '../offers/OfferComposer';

// The candidate funnel of one job card — reads come from the LOCAL mirror
// (GET /admin/job-cards/:id/candidates keeps rendering when SquadHire is
// down); writes go through the candidate detail panel's signed proxies.
//
// Funnel tabs are mutually exclusive via bucketOf (same idiom as the
// subscription recipients view) so the tab counts sum to the total.

export type CandidateWithFunnel = JobCardCandidate & {
  interviews: JobInterview[];
  offers: JobOffer[];
};

type Bucket = 'applied' | 'screening' | 'shortlisted' | 'interview' | 'offer' | 'hired' | 'rejected';

type FunnelTab = 'all' | Bucket;

const TABS: { key: FunnelTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'applied', label: 'Applied' },
  { key: 'screening', label: 'Screening' },
  { key: 'shortlisted', label: 'Shortlisted' },
  { key: 'interview', label: 'Interview' },
  { key: 'offer', label: 'Offer' },
  { key: 'hired', label: 'Hired' },
  { key: 'rejected', label: 'Rejected' },
];

// Map a candidate to exactly one funnel bucket, in precedence order (terminal
// states first, then the deepest stage reached). on_hold stays under
// Interview — the round is paused, not over.
export function bucketOf(c: JobCardCandidate): Bucket {
  if (c.status === 'rejected' || c.status === 'withdrawn') return 'rejected';
  if (c.status === 'hired' || c.status === 'joined') return 'hired';
  if (c.status === 'offer' || c.status === 'offer_accepted') return 'offer';
  if (c.status === 'interview' || c.status === 'on_hold') return 'interview';
  if (c.status === 'shortlisted') return 'shortlisted';
  if (c.status === 'screening') return 'screening';
  return 'applied';
}

export default function JobCandidatesView({ card }: { card: JobCard }) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<FunnelTab>('all');
  const [openCandidateId, setOpenCandidateId] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);

  const { data: candidatesRes, isLoading } = useQuery({
    queryKey: ['admin-job-card-candidates', card.id],
    queryFn: () => api.get(`/admin/job-cards/${card.id}/candidates`).then((r) => r.data),
  });
  const candidates: CandidateWithFunnel[] = candidatesRes?.data || [];

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { applied: 0, screening: 0, shortlisted: 0, interview: 0, offer: 0, hired: 0, rejected: 0 };
    for (const cand of candidates) c[bucketOf(cand)] += 1;
    return c;
  }, [candidates]);

  const visible = useMemo(
    () => (activeTab === 'all' ? candidates : candidates.filter((c) => bucketOf(c) === activeTab)),
    [candidates, activeTab],
  );

  const openCandidate = useMemo(
    () => candidates.find((c) => c.id === openCandidateId) || null,
    [candidates, openCandidateId],
  );

  const shortlisted = useMemo(() => candidates.filter((c) => bucketOf(c) === 'shortlisted'), [candidates]);
  // "Send to all selected in one click" — interview-selected candidates.
  const offerable = useMemo(
    () => candidates.filter((c) => c.status === 'interview' || c.status === 'shortlisted' || c.status === 'on_hold'),
    [candidates],
  );

  const startScreening = useMutation({
    mutationFn: () => api.post(`/admin/job-cards/${card.id}/start-screening`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-job-cards'] });
      qc.invalidateQueries({ queryKey: ['admin-job-card-candidates', card.id] });
      showToast('Screening started — the card moves to Applicant Screening.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to start screening', 'error');
    },
  });

  return (
    <div className="space-y-3">
      {/* Stage actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {TABS.map(({ key, label }) => {
            const count = key === 'all' ? candidates.length : counts[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                data-active={activeTab === key}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  activeTab === key
                    ? 'border-transparent bg-sh-lime-soft text-sh-ink shadow-[inset_0_0_0_1px_var(--sh-ink)]'
                    : 'border-divider bg-surface text-foreground-muted hover:text-foreground'
                }`}
              >
                {label} <span className="opacity-70">({count})</span>
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!card.screening_started_at && card.state === 'published' && (
            <button
              type="button"
              onClick={() => startScreening.mutate()}
              disabled={startScreening.isPending}
              title="Moves the card from Broadcasted to Applicant Screening"
              className="rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {startScreening.isPending ? 'Starting…' : 'Start screening'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            disabled={shortlisted.length === 0}
            title={shortlisted.length === 0 ? 'Shortlist candidates first' : undefined}
            className="rounded-md border border-divider px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground disabled:opacity-50"
          >
            Call for interview
          </button>
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            disabled={offerable.length === 0}
            title={offerable.length === 0 ? 'No candidates ready for an offer yet' : undefined}
            className="rounded-md border border-divider px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground disabled:opacity-50"
          >
            Compose offers
          </button>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <p className="py-6 text-center text-xs text-foreground-dim">Loading candidates…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-divider px-4 py-8 text-center text-xs text-foreground-dim">
          {activeTab === 'all'
            ? card.state === 'published'
              ? 'No applicants yet — accepted talents appear here as they apply.'
              : 'Candidates appear once the card is broadcast and talents accept.'
            : 'Nobody in this bucket.'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {visible.map((c) => (
            <CandidateRow key={c.id} candidate={c} onOpen={() => setOpenCandidateId(c.id)} />
          ))}
        </div>
      )}

      {openCandidate && (
        <CandidateDetailPanel card={card} candidate={openCandidate} onClose={() => setOpenCandidateId(null)} />
      )}
      {scheduleOpen && (
        <InterviewScheduleDialog card={card} shortlisted={shortlisted} onClose={() => setScheduleOpen(false)} />
      )}
      {composerOpen && (
        <OfferComposer card={card} selectable={offerable} onClose={() => setComposerOpen(false)} />
      )}
    </div>
  );
}
