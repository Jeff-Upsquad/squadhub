import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import type { JobCard, JobCardStage } from '@squadhub/shared';

// Client-facing Job Cards — the hiring sibling of ClientSubscriptionCards.
// GET /job-cards/mine resolves the logged-in client by email against both the
// converted clients rows and the lead submissions (direct FKs on job_cards).

const STAGE_PILL: Record<JobCardStage, { bg: string; fg: string; label: string }> = {
  new: { bg: 'rgba(100,116,139,0.1)', fg: '#64748B', label: 'New' },
  onboarding: { bg: 'rgba(217,119,6,0.1)', fg: '#D97706', label: 'Onboarding' },
  broadcasted: { bg: 'rgba(16,185,129,0.1)', fg: '#059669', label: 'Broadcasted' },
  screening: { bg: 'rgba(2,132,199,0.1)', fg: '#0284C7', label: 'Screening' },
  short_listing: { bg: 'rgba(109,40,217,0.1)', fg: '#6D28D9', label: 'Short Listing' },
  interview: { bg: 'rgba(30,64,175,0.1)', fg: '#1E40AF', label: 'Interviews' },
  offer: { bg: 'rgba(157,23,77,0.1)', fg: '#9D174D', label: 'Offer stage' },
  hired: { bg: 'rgba(6,95,70,0.12)', fg: '#065F46', label: 'Hired' },
  placed: { bg: 'rgba(6,95,70,0.9)', fg: '#FFFFFF', label: 'Placed' },
  cancelled: { bg: 'rgba(100,116,139,0.1)', fg: '#64748B', label: 'Closed' },
  archive: { bg: 'rgba(107,33,168,0.1)', fg: '#6B21A8', label: 'Archived' },
  trash: { bg: 'rgba(185,28,28,0.1)', fg: '#B91C1C', label: 'Deleted' },
};

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
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function packageLabel(card: JobCard): string {
  const cur = card.package_currency || 'INR';
  const per = card.package_period === 'annual' ? '/yr' : '/mo';
  if (card.package_min != null && card.package_max != null) {
    return `${cur} ${Number(card.package_min).toLocaleString()}–${Number(card.package_max).toLocaleString()}${per}`;
  }
  if (card.package_max != null) return `${cur} ${Number(card.package_max).toLocaleString()}${per}`;
  if (card.package_min != null) return `${cur} ${Number(card.package_min).toLocaleString()}${per}`;
  return '';
}

export default function ClientJobCards() {
  const { data: res, isLoading, error } = useQuery({
    queryKey: ['my-job-cards'],
    queryFn: () => api.get('/job-cards/mine').then((r) => r.data),
  });

  const cards: JobCard[] = res?.data || [];

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">
          Job Cards
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Hiring rounds running for your business — from broadcast to placement.
        </p>

        <div className="mt-6">
          {isLoading ? (
            <p className="text-sm text-foreground-muted">Loading…</p>
          ) : error ? (
            <p className="text-sm text-red-500">Failed to load job cards.</p>
          ) : cards.length === 0 ? (
            <div className="rounded-lg border border-divider bg-surface-alt p-8 text-center">
              <p className="text-sm text-foreground-muted">
                No job cards yet. They&apos;ll appear here once a hiring round starts for your business.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {cards.map((c) => {
                const stage = (c.stage as JobCardStage | undefined) ?? 'new';
                const pill = STAGE_PILL[stage] ?? STAGE_PILL.new;
                const pkg = packageLabel(c);
                const funnel: string[] = [];
                if ((c.applicants_count ?? 0) > 0) funnel.push(`${c.applicants_count} applied`);
                if ((c.shortlisted_count ?? 0) > 0) funnel.push(`${c.shortlisted_count} shortlisted`);
                if ((c.interview_count ?? 0) > 0) funnel.push(`${c.interview_count} in interviews`);
                if ((c.offer_count ?? 0) > 0) funnel.push(`${c.offer_count} offered`);
                if ((c.hired_count ?? 0) > 0) funnel.push(`${c.hired_count} hired`);
                return (
                  <li key={c.id}>
                    <div className="block w-full rounded-lg border border-divider bg-surface-alt p-4 text-left">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate font-medium text-foreground">
                              {c.job_profile?.title || c.role_service_type || 'Job opening'}
                            </h3>
                            {c.openings_count > 1 && (
                              <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
                                {c.openings_count} openings
                              </span>
                            )}
                          </div>
                          {(c.brand_profile?.name || c.business_profile?.name) && (
                            <p className="mt-1 truncate text-sm text-foreground-muted">
                              {c.brand_profile?.name || c.business_profile?.name}
                            </p>
                          )}
                          {pkg && <p className="mt-0.5 truncate text-xs text-foreground-muted">{pkg}</p>}
                        </div>
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                          style={{ backgroundColor: pill.bg, color: pill.fg }}
                        >
                          {pill.label}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-muted">
                        {c.published_at ? <span>Published {formatRelative(c.published_at)}</span> : <span>Not published yet</span>}
                        {funnel.length > 0 && (
                          <>
                            <span>·</span>
                            <span>{funnel.join(' · ')}</span>
                          </>
                        )}
                        {c.expected_joining_date && (
                          <>
                            <span>·</span>
                            <span>Joining {c.expected_joining_date}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
