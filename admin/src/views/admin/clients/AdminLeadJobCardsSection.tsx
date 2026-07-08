import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import type { AdminJobCard } from '../jobs/AdminJobCards';
import { categorizeJobCard } from '../jobs/AdminJobCards';
import type { JobCardStage } from '@squadhub/shared';

type Props = {
  submissionId: string;
};

// The hiring sibling of AdminLeadCardsSection — job cards linked to this lead
// via the DIRECT lead_submission_id FK. The list endpoint has no submission
// filter (stage/search only), so the shared 'admin-job-cards' list is
// filtered client-side; the cache is shared with the Job Cards module.

const STAGE_PILL: Record<JobCardStage, { bg: string; fg: string; label: string }> = {
  new: { bg: '#EEF2F6', fg: '#475569', label: 'New Deal' },
  onboarding: { bg: '#FEF3C7', fg: '#92400E', label: 'Onboarding' },
  broadcasted: { bg: '#DCFCE7', fg: '#15803D', label: 'Broadcasted' },
  screening: { bg: '#E0F2FE', fg: '#075985', label: 'Screening' },
  short_listing: { bg: '#EDE9FE', fg: '#6D28D9', label: 'Short Listing' },
  interview: { bg: '#DBEAFE', fg: '#1E40AF', label: 'Interview' },
  offer: { bg: '#FCE7F3', fg: '#9D174D', label: 'Offer' },
  hired: { bg: '#D1FAE5', fg: '#065F46', label: 'Hired' },
  placed: { bg: '#065F46', fg: '#FFFFFF', label: 'Placed' },
  cancelled: { bg: '#EEF2F6', fg: '#475569', label: 'Cancelled' },
  archive: { bg: '#F2EBFE', fg: '#6B21A8', label: 'Archived' },
  trash: { bg: '#FEE2E2', fg: '#B91C1C', label: 'Trash' },
};

function formatPublishedAt(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function AdminLeadJobCardsSection({ submissionId }: Props) {
  const { data: cardsRes, isLoading } = useQuery({
    queryKey: ['admin-job-cards', ''],
    queryFn: () => api.get('/admin/job-cards').then((r) => r.data),
    enabled: !!submissionId,
  });
  const cards: AdminJobCard[] = useMemo(
    () => ((cardsRes?.data || []) as AdminJobCard[]).filter((c) => c.lead_submission_id === submissionId),
    [cardsRes, submissionId],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Job Cards</h4>
        {cards.length > 0 && (
          <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-foreground-muted">
            {cards.length}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="py-3 text-center text-xs text-foreground-dim">Loading…</p>
      ) : cards.length === 0 ? (
        <p className="py-3 text-center text-xs text-foreground-dim">No job cards yet.</p>
      ) : (
        <ul className="divide-y divide-[#F1F5F9] rounded-lg border border-divider bg-surface">
          {cards.map((card) => {
            const stage = (card.stage as JobCardStage | undefined) ?? categorizeJobCard(card);
            const pill = STAGE_PILL[stage] ?? STAGE_PILL.new;
            return (
              <li key={card.id}>
                <a
                  href={`/admin/job-cards?card=${card.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm hover:bg-surface-alt transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <p className="font-medium text-foreground">
                        {card.job_profile?.title || card.role_service_type || 'Job card'}
                      </p>
                      {card.openings_count > 1 && (
                        <p className="text-xs text-foreground-muted">{card.openings_count} openings</p>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{ backgroundColor: pill.bg, color: pill.fg }}
                      >
                        {pill.label}
                      </span>
                      {card.published_at && (
                        <span className="text-[11px] text-foreground-dim">{formatPublishedAt(card.published_at)}</span>
                      )}
                    </div>
                  </div>
                  <svg
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-dim"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
