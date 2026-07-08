'use client';

import type { JobCandidateStatus } from '@squadhub/shared';
import type { CandidateWithFunnel } from './JobCandidatesView';

// One candidate row in the funnel list — mirrors the recipients-row idiom
// (avatar initial + name + contact, status pill + stage chips on the right).

export const CANDIDATE_STATUS_PILL: Record<JobCandidateStatus, { bg: string; color: string; label: string }> = {
  matched: { bg: '#EEF2F6', color: '#475569', label: 'Matched' },
  applied: { bg: '#D1FAE5', color: '#065F46', label: 'Applied' },
  screening: { bg: '#E0F2FE', color: '#075985', label: 'Screening' },
  shortlisted: { bg: '#EDE9FE', color: '#6D28D9', label: 'Shortlisted' },
  interview: { bg: '#DBEAFE', color: '#1E40AF', label: 'Interview' },
  offer: { bg: '#FEF3C7', color: '#92400E', label: 'Offer sent' },
  offer_accepted: { bg: '#FCE7F3', color: '#9D174D', label: 'Offer accepted' },
  hired: { bg: '#065F46', color: '#FFFFFF', label: 'Hired' },
  joined: { bg: '#0a0a0a', color: '#FFFFFF', label: 'Joined' },
  rejected: { bg: '#FEE2E2', color: '#B91C1C', label: 'Rejected' },
  withdrawn: { bg: '#EEF2F6', color: '#475569', label: 'Withdrawn' },
  on_hold: { bg: '#FEF3C7', color: '#92400E', label: 'On hold' },
};

// Unknown statuses from the mirror degrade to a neutral pill instead of
// crashing the funnel (same defensive idiom as the recipients view).
const STATUS_PILL_FALLBACK = { bg: '#EEF2F6', color: '#475569', label: '' };

export function candidateStatusPill(status: string): { bg: string; color: string; label: string } {
  return CANDIDATE_STATUS_PILL[status as JobCandidateStatus] ?? { ...STATUS_PILL_FALLBACK, label: status };
}

function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function CandidateRow({
  candidate,
  onOpen,
}: {
  candidate: CandidateWithFunnel;
  onOpen: () => void;
}) {
  const name = candidate.talent_name || candidate.talent_email || 'Unknown talent';
  const pill = candidateStatusPill(candidate.status);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-divider bg-surface px-4 py-3 text-left transition hover:border-ink"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-bold text-foreground">
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{name}</p>
          <p className="mt-0.5 truncate text-xs text-foreground-muted">
            {[candidate.talent_email, candidate.talent_phone].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {candidate.interviews.length > 0 && (
          <span className="rounded-full border border-divider bg-canvas px-2 py-0.5 text-[10px] font-semibold text-foreground-muted">
            {candidate.interviews.length} round{candidate.interviews.length === 1 ? '' : 's'}
          </span>
        )}
        {candidate.offers.length > 0 && (
          <span className="rounded-full border border-divider bg-canvas px-2 py-0.5 text-[10px] font-semibold text-foreground-muted">
            {candidate.offers.length} offer{candidate.offers.length === 1 ? '' : 's'}
          </span>
        )}
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: pill.bg, color: pill.color }}>
          {pill.label}
        </span>
        {candidate.applied_at && (
          <span className="hidden text-[11px] text-foreground-dim sm:inline">applied {formatRelative(candidate.applied_at)}</span>
        )}
      </div>
    </button>
  );
}
