'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JobCard, JobCardStage } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import JobBriefForm from './JobBriefForm';
import JobCardEditor from './JobCardEditor';
import JobMatchPreview from './JobMatchPreview';
import OnboardingPanel from './onboarding/OnboardingPanel';
import JobCandidatesView from './candidates/JobCandidatesView';
import JobCardQnA from './qa/JobCardQnA';
import CloseJobCardDialog from './dialogs/CloseJobCardDialog';

// Job Cards — the hiring pipeline, sibling of Subscription Cards. Stored card
// state is deliberately small (new → onboarding → published → closed); the
// eleven tabs here are DERIVED buckets via categorizeJobCard(), the client
// mirror of server utils/jobStage.ts.

export type AdminJobCard = JobCard;

/**
 * Client mirror of the server's categorizeJobCard (utils/jobStage.ts) — keep
 * the precedence identical. Contract §5: the Applicant Screening bucket keys
 * on screening_started_at (from SquadHire's job_screening_started echo), NOT
 * on applicant counts — the card stays Broadcasted until Start Screening.
 */
export function categorizeJobCard(card: AdminJobCard): JobCardStage {
  if (card.deleted_at) return 'trash';
  if (card.archived_at) return 'archive';
  if (card.cancelled_at) return 'cancelled';

  // Off the market: recalled cards file under Onboarding until re-published
  // (publish clears recalled_at). Mirrors server utils/jobStage.ts.
  if (card.recalled_at && card.state === 'onboarding') return 'onboarding';

  const openings = card.openings_count ?? 1;
  const placed = card.placed_count ?? 0;
  const hired = card.hired_count ?? 0;

  if (placed > 0 && (card.state === 'closed' || placed >= openings)) return 'placed';
  if (hired > 0) return 'hired';
  if ((card.offer_count ?? 0) > 0) return 'offer';
  if ((card.interview_count ?? 0) > 0) return 'interview';
  if ((card.shortlisted_count ?? 0) > 0) return 'short_listing';
  if (card.screening_started_at) return 'screening';

  if (card.state === 'closed') return 'cancelled';
  if (card.state === 'published') return 'broadcasted';
  if (card.state === 'onboarding') return 'onboarding';
  return 'new';
}

type Tab = Exclude<JobCardStage, 'trash'>;

const TABS: { key: Tab; label: string }[] = [
  { key: 'new', label: 'New Deals' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'broadcasted', label: 'Broadcasted' },
  { key: 'screening', label: 'Applicant Screening' },
  { key: 'short_listing', label: 'Short Listing' },
  { key: 'interview', label: 'Interview Process' },
  { key: 'offer', label: 'Offer' },
  { key: 'hired', label: 'Hired' },
  { key: 'placed', label: 'Placed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'archive', label: 'Archive' },
];

const HEADER_META: Record<Tab, { title: string; subtitle: string }> = {
  new: { title: 'New Deals', subtitle: 'Incoming hiring briefs. Start onboarding to build the business, brand and job profiles.' },
  onboarding: { title: 'Onboarding', subtitle: 'Profiles being built. Attach a job profile and publish to broadcast the card to SquadHire talents.' },
  broadcasted: { title: 'Broadcasted', subtitle: 'Live on SquadHire — matched talents are applying. Click Start Screening when applications are in.' },
  screening: { title: 'Applicant Screening', subtitle: 'Screening started — review applicants and shortlist the promising ones.' },
  short_listing: { title: 'Short Listing', subtitle: 'Shortlisted candidates — schedule interview rounds when ready.' },
  interview: { title: 'Interview Process', subtitle: 'Interview rounds in progress — run the day console per candidate and record outcomes.' },
  offer: { title: 'Offer', subtitle: 'Offers out — track accepts, declines and negotiations.' },
  hired: { title: 'Hired', subtitle: 'Candidates hired, waiting on their joining date. Mark joined when they start.' },
  placed: { title: 'Placed', subtitle: 'Done — candidates joined and the card is placed.' },
  cancelled: { title: 'Cancelled', subtitle: 'Cancelled or closed-without-hire cards.' },
  archive: { title: 'Archive', subtitle: 'Cards you archived — hidden from talent feeds and the active pipeline.' },
};

const STAGE_PILL: Record<JobCardStage, { bg: string; color: string; label: string }> = {
  new: { bg: '#EEF2F6', color: '#475569', label: 'New Deal' },
  onboarding: { bg: '#FEF3C7', color: '#92400E', label: 'Onboarding' },
  broadcasted: { bg: '#DCFCE7', color: '#15803D', label: 'Broadcasted' },
  screening: { bg: '#E0F2FE', color: '#075985', label: 'Screening' },
  short_listing: { bg: '#EDE9FE', color: '#6D28D9', label: 'Short Listing' },
  interview: { bg: '#DBEAFE', color: '#1E40AF', label: 'Interview' },
  offer: { bg: '#FCE7F3', color: '#9D174D', label: 'Offer' },
  hired: { bg: '#D1FAE5', color: '#065F46', label: 'Hired' },
  placed: { bg: '#065F46', color: '#FFFFFF', label: 'Placed' },
  cancelled: { bg: '#EEF2F6', color: '#475569', label: 'Cancelled' },
  archive: { bg: '#F2EBFE', color: '#6B21A8', label: 'Archived' },
  trash: { bg: '#FEE2E2', color: '#B91C1C', label: 'Trash' },
};

export function JobStagePill({ stage }: { stage: JobCardStage }) {
  const pill = STAGE_PILL[stage] ?? { bg: '#EEF2F6', color: '#475569', label: stage };
  return (
    <span className="sh-status-pill shrink-0" style={{ backgroundColor: pill.bg, color: pill.color }}>
      {pill.label}
    </span>
  );
}

const ROLE_BADGES: Record<string, { label: string; bg: string; color: string }> = {
  Designers: { label: 'Designer', bg: '#FCE7F3', color: '#9D174D' },
  Editors: { label: 'Editor', bg: '#CCFBF1', color: '#115E59' },
};

function RoleBadge({ role }: { role?: string | null }) {
  if (!role) return null;
  const badge = ROLE_BADGES[role] ?? { label: role, bg: '#EEF2F6', color: '#475569' };
  return (
    <span className="sh-status-pill shrink-0" style={{ backgroundColor: badge.bg, color: badge.color }}>
      {badge.label}
    </span>
  );
}

/** SquadHire delivery axis — same three states as subscription cards. */
function jobDeliveryState(card: AdminJobCard): 'skipped' | 'pending' | 'delivered' {
  if (card.squadhire_synced_at) return 'delivered';
  const hasCategories = (card.job_profile?.squadhire_category_ids ?? []).length > 0;
  if (!hasCategories) return 'skipped';
  return 'pending';
}

function jobCardTitle(card: AdminJobCard): string {
  const business = card.business_profile?.name || card.customer_company || card.customer_name || 'Unknown business';
  const role = card.job_profile?.title || card.role_service_type;
  return role ? `${business} · ${role}` : business;
}

function packageLabel(card: AdminJobCard): string {
  const cur = card.package_currency || 'INR';
  const per = card.package_period === 'annual' ? '/yr' : '/mo';
  if (card.package_min != null && card.package_max != null) {
    return `${cur} ${Number(card.package_min).toLocaleString()}–${Number(card.package_max).toLocaleString()}${per}`;
  }
  if (card.package_max != null) return `${cur} ${Number(card.package_max).toLocaleString()}${per}`;
  if (card.package_min != null) return `${cur} ${Number(card.package_min).toLocaleString()}${per}`;
  return '';
}

function formatPublishedAt(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days < 1) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  if (days < 7) return `${days}d ago at ${time}`;
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${time}`;
}

export default function AdminJobCards({
  compact = false,
}: {
  // When true (CardsHub / Leads mini app) drop the large page title so the
  // product tabs + these status subtabs sit in one compact chrome stack.
  compact?: boolean;
} = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [activeTab, setActiveTab] = useState<Tab>('new');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [showBriefForm, setShowBriefForm] = useState(false);

  // Card detail is URL-driven (?card=<id>) so the browser back button
  // collapses the detail back to the list — same idiom as Subscription Cards.
  const selectedCardId = searchParams.get('card');
  // Other query params are preserved — see the matching note in
  // AdminSubscriptionCards (the Leads mini app keeps its tab in the URL).
  const setSelectedCardId = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) {
        params.set('card', id);
        router.push(`${pathname}?${params.toString()}`);
      } else if (typeof window !== 'undefined' && window.history.length > 1) {
        router.back();
      } else {
        params.delete('card');
        const qs = params.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname);
      }
    },
    [router, pathname, searchParams],
  );

  // One list query feeds every tab (the server returns all non-deleted cards;
  // buckets are derived client-side so tab counts stay live together).
  const { data: cardsRes, isLoading, isFetching } = useQuery({
    queryKey: ['admin-job-cards', debouncedSearch],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();
      return api.get('/admin/job-cards', { params }).then((r) => r.data);
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const cards: AdminJobCard[] = cardsRes?.data || [];

  const bucketed = useMemo(() => {
    const out = Object.fromEntries(TABS.map((t) => [t.key, [] as AdminJobCard[]])) as Record<Tab, AdminJobCard[]>;
    for (const c of cards) {
      const stage = (c.stage as Tab | undefined) ?? categorizeJobCard(c);
      if (stage !== 'trash' && out[stage as Tab]) out[stage as Tab].push(c);
    }
    return out;
  }, [cards]);

  const cardsForTab = bucketed[activeTab] ?? [];

  const selectedCard = useMemo(() => cards.find((c) => c.id === selectedCardId) || null, [cards, selectedCardId]);

  const switchTab = useCallback(
    (next: Tab) => {
      setActiveTab(next);
      // Keep ?leadTab= (and anything else) when collapsing a card — a bare
      // pathname replace used to bounce the Leads hub back to its default tab.
      if (searchParams.get('card')) {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('card');
        const qs = params.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname);
      }
    },
    [pathname, router, searchParams],
  );

  const headerMeta = HEADER_META[activeTab];
  const headerCount = `${cardsForTab.length} card${cardsForTab.length === 1 ? '' : 's'}`;

  return (
    <div className={`flex min-h-0 h-full flex-col ${compact ? '' : 'sh-surface'}`}>
      {!selectedCardId && (
        <div className={compact ? 'px-6 pt-2.5 pb-3 space-y-2.5' : 'px-6 pt-6 pb-4 space-y-4'}>
          {!compact && (
            <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-[var(--color-sh-warm-border)] pb-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2.5">
                  <h1 className="sh-display text-2xl leading-none sm:text-[28px]">{headerMeta.title}</h1>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-sh-warm-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-bold text-[var(--color-sh-ink)]">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-sh-lime)' }} />
                    {headerCount}
                  </span>
                </div>
                <p className="max-w-xl text-[13px] text-[var(--color-sh-ink-muted)]">{headerMeta.subtitle}</p>
              </div>
              <button type="button" onClick={() => setShowBriefForm(true)} className="sh-btn-primary sh-btn-primary-sm shrink-0">
                + Create hiring brief
              </button>
            </header>
          )}

          {/* Tabs — the full hiring lifecycle in one row. */}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 overflow-x-auto">
              <div className={compact ? 'sh-tab-bar sh-tab-bar-sm' : 'sh-tab-bar'}>
                {TABS.map(({ key, label }) => {
                  const count = bucketed[key]?.length ?? 0;
                  return (
                    <button
                      key={key}
                      type="button"
                      data-active={activeTab === key}
                      onClick={() => switchTab(key)}
                      className="sh-tab"
                      title={HEADER_META[key].subtitle}
                    >
                      {label}
                      <span className="opacity-70"> ({count})</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {compact && (
              <button type="button" onClick={() => setShowBriefForm(true)} className="sh-btn-primary sh-btn-primary-xs shrink-0">
                + Create brief
              </button>
            )}
          </div>

          {/* Search */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative flex-1 min-w-[160px]">
              <svg
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-sh-ink-faint)]"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search business, role, job title…"
                className="sh-input sh-input-sm pl-8 pr-8"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-sh-ink-faint)] transition hover:bg-[var(--color-sh-cream)] hover:text-[var(--color-sh-ink)]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedCardId ? (
        <JobCardDetailView key={selectedCardId} cardId={selectedCardId} fallback={selectedCard} onBack={() => setSelectedCardId(null)} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
          {isFetching && !isLoading && (
            <div className="mb-3 flex items-center gap-2 text-[11px] font-medium text-[var(--color-sh-ink-faint)]">
              <span className="inline-flex h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
              Updating…
            </div>
          )}
          {isLoading ? (
            <JobCardListSkeleton />
          ) : cardsForTab.length === 0 ? (
            <EmptyState
              title={debouncedSearch ? 'No cards match your search' : `Nothing in ${headerMeta.title}`}
              hint={debouncedSearch ? 'Try clearing the search above.' : headerMeta.subtitle}
            />
          ) : (
            <div className="space-y-2">
              {cardsForTab.map((card) => (
                <JobCardRow key={card.id} card={card} onOpen={() => setSelectedCardId(card.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {showBriefForm && (
        <JobBriefForm
          onClose={() => setShowBriefForm(false)}
          onCreated={() => {
            setShowBriefForm(false);
            switchTab('new');
          }}
        />
      )}
    </div>
  );
}

function JobCardListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="sh-card flex items-center justify-between px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-[var(--color-sh-cream)]" />
            <div className="space-y-2">
              <div className="h-3.5 w-40 animate-pulse rounded bg-[var(--color-sh-cream)]" />
              <div className="h-3 w-24 animate-pulse rounded bg-[var(--color-sh-cream)]" />
            </div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <div className="h-6 w-20 animate-pulse rounded-full bg-[var(--color-sh-cream)]" />
            <div className="h-6 w-20 animate-pulse rounded-full bg-[var(--color-sh-cream)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="sh-card flex flex-col items-center gap-2 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-sh-cream)] text-[var(--color-sh-ink-faint)]">
        <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-[var(--color-sh-ink)]">{title}</p>
      <p className="max-w-xs text-xs text-[var(--color-sh-ink-muted)]">{hint}</p>
    </div>
  );
}

function FunnelCountChip({ card }: { card: AdminJobCard }) {
  const parts: { label: string; n: number }[] = [
    { label: 'applied', n: card.applicants_count ?? 0 },
    { label: 'shortlisted', n: card.shortlisted_count ?? 0 },
    { label: 'interview', n: card.interview_count ?? 0 },
    { label: 'offers', n: card.offer_count ?? 0 },
    { label: 'hired', n: card.hired_count ?? 0 },
  ];
  const total = parts.reduce((s, p) => s + p.n, 0);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-sh-warm-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px]"
      title={parts.map((p) => `${p.n} ${p.label}`).join(', ')}
    >
      <span className="font-medium text-[var(--color-sh-ink-subtle)]">Candidates</span>
      {total === 0 ? (
        <span className="text-[var(--color-sh-ink-faint)]">—</span>
      ) : (
        <span className="inline-flex items-center gap-1 tabular-nums">
          {parts
            .filter((p) => p.n > 0)
            .map((p) => (
              <span key={p.label} className="font-semibold text-[var(--color-sh-ink)]">
                {p.n} {p.label}
              </span>
            ))}
        </span>
      )}
    </span>
  );
}

function JobCardRow({ card, onOpen }: { card: AdminJobCard; onOpen: () => void }) {
  const business = card.business_profile?.name || card.customer_company || card.customer_name || 'Unknown';
  const title = card.job_profile?.title || '';
  const pkg = packageLabel(card);
  const stage = (card.stage as JobCardStage | undefined) ?? categorizeJobCard(card);
  const delivery = jobDeliveryState(card);
  return (
    <button onClick={onOpen} className="sh-card sh-card-interactive flex w-full items-center justify-between px-5 py-4 text-left">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-sh-lime-soft)] text-[var(--color-sh-ink)] text-sm font-bold ring-1 ring-[var(--color-sh-warm-border)]">
          {business.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-[var(--color-sh-ink)]">{business}</p>
            <RoleBadge role={card.role_service_type} />
          </div>
          {(title || pkg) && (
            <p className="mt-0.5 truncate text-xs text-[var(--color-sh-ink-muted)]">
              {title}
              {title && pkg ? ', ' : ''}
              {pkg}
              {card.openings_count > 1 ? ` · ${card.openings_count} openings` : ''}
            </p>
          )}
          {card.published_at && (
            <p className="mt-1 truncate text-[11px] text-[var(--color-sh-ink-faint)]">
              published {formatPublishedAt(card.published_at)}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {card.state === 'published' && delivery === 'skipped' && (
          <span
            className="sh-status-pill"
            style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}
            title="The job profile has no SquadHire categories, so this card cannot reach talents. Edit the job profile and re-publish."
          >
            Not on SquadHire
          </span>
        )}
        {card.state === 'published' && delivery === 'pending' && (
          <span
            className="sh-status-pill"
            style={{ backgroundColor: '#FFE9D9', color: '#9A3412' }}
            title={
              card.squadhire_sync_last_error
                ? `SquadHire delivery failed: ${card.squadhire_sync_last_error} (${card.squadhire_sync_attempts ?? 0} attempts). Retry sweeper runs every 5 min.`
                : `SquadHire delivery in progress (${card.squadhire_sync_attempts ?? 0} attempts so far).`
            }
          >
            SquadHire pending
          </span>
        )}
        {card.paused_at && (
          <span className="sh-status-pill bg-amber-500/15 text-amber-500">
            Paused
          </span>
        )}
        {card.recalled_at && (
          // Recalled and not yet re-published (publish clears recalled_at):
          // off SquadHire, editable, funnel preserved.
          <span className="sh-status-pill bg-amber-500/15 text-amber-500">
            Recalled
          </span>
        )}
        <JobStagePill stage={stage} />
        <FunnelCountChip card={card} />
      </div>
    </button>
  );
}

// ─── Detail view ─────────────────────────────────────────────────────────

type DetailTab = 'overview' | 'candidates' | 'qa' | 'activity';

function JobCardDetailView({
  cardId,
  fallback,
  onBack,
}: {
  cardId: string;
  /** Thin list-hydrated card shown while the detail (full profile) loads. */
  fallback: AdminJobCard | null;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  // Keyed under the 'admin-job-cards' prefix so every list invalidation
  // (candidate proxies, lifecycle mutations in child components) refreshes
  // the detail header's counters and stage too.
  const { data: detailRes, isLoading } = useQuery({
    queryKey: ['admin-job-cards', 'detail', cardId],
    queryFn: () => api.get(`/admin/job-cards/${cardId}`).then((r) => r.data),
  });
  const card: AdminJobCard | null = detailRes?.data ?? fallback;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-job-cards'] });
  };

  const lifecycle = useMutation({
    mutationFn: ({ action }: { action: 'publish' | 'recall' | 'pause' | 'resume' | 'cancel' | 'archive' | 'unarchive' | 'duplicate' }) =>
      api.post(`/admin/job-cards/${cardId}/${action}`, {}),
    onSuccess: (res, vars) => {
      invalidate();
      const messages: Record<string, string> = {
        publish: 'Card published — delivering to SquadHire in the background.',
        recall: 'Card recalled to Onboarding — edit and re-publish when ready.',
        pause: 'Card paused — hidden from talents until you resume.',
        resume: 'Card resumed.',
        cancel: 'Card cancelled.',
        archive: 'Card archived.',
        unarchive: 'Card unarchived.',
        duplicate: 'Card duplicated into New Deals.',
      };
      showToast(messages[vars.action] ?? 'Done.', 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Action failed', 'error');
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/job-cards/${cardId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-job-cards'] });
      showToast('Card moved to Trash.', 'success');
      onBack();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to delete the card', 'error');
    },
  });

  if (!card) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-foreground-dim">{isLoading ? 'Loading card…' : 'Card not found.'}</p>
      </div>
    );
  }

  const stage = (card.stage as JobCardStage | undefined) ?? categorizeJobCard(card);
  const busy = lifecycle.isPending || remove.isPending;
  const isDraft = card.state === 'new' || card.state === 'onboarding';
  const isPublished = card.state === 'published';

  // Distinct candidates on the card = everyone who applied. The per-stage
  // counters (screening/shortlisted/interview/…) are SUBSETS of this as a
  // candidate progresses, so summing them double-counts (e.g. applied + now
  // shortlisted = one person, not two).
  const candidateTotal = card.applicants_count ?? 0;

  const actionBtn =
    'rounded-md border border-divider px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground disabled:opacity-50';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-[var(--color-sh-warm-border)] px-6 pt-6 pb-4">
        <button type="button" onClick={onBack} className="-ml-1 mb-3 flex items-center gap-1 text-sm text-foreground-muted transition hover:text-foreground">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Job Cards
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="sh-display text-xl leading-tight sm:text-2xl">{jobCardTitle(card)}</h1>
              <JobStagePill stage={stage} />
              {card.paused_at && (
                <span className="sh-status-pill bg-amber-500/15 text-amber-500">
                  Paused
                </span>
              )}
              {card.recalled_at && (
                <span
                  className="sh-status-pill bg-amber-500/15 text-amber-500"
                  title="Recalled — taken down from SquadHire; edit and re-publish for a fresh broadcast. Existing candidates are preserved."
                >
                  Recalled
                </span>
              )}
              <RoleBadge role={card.role_service_type} />
            </div>
            <p className="mt-1 text-xs text-[var(--color-sh-ink-muted)]">
              {[
                packageLabel(card),
                `${card.openings_count} opening${card.openings_count === 1 ? '' : 's'}`,
                card.expected_joining_date ? `joining ${card.expected_joining_date}` : null,
                card.published_at ? `published ${formatPublishedAt(card.published_at)}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>

          {/* Lifecycle actions per state */}
          <div className="flex flex-wrap items-center gap-1.5">
            {isDraft && (
              <>
                <button type="button" disabled={busy} onClick={() => setOnboardingOpen(true)} className="rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
                  {card.state === 'new' ? 'Start onboarding' : 'Onboarding'}
                </button>
                {card.state === 'onboarding' && card.job_profile_id && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('Publish this card?\n\nIt delivers to SquadHire and matched talents are notified.')) {
                        lifecycle.mutate({ action: 'publish' });
                      }
                    }}
                    className="rounded-md bg-green-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    Publish
                  </button>
                )}
              </>
            )}
            {isPublished && !card.paused_at && (
              <button type="button" disabled={busy} onClick={() => lifecycle.mutate({ action: 'pause' })} className={actionBtn} title="Hide the card from talents until you resume">
                Pause
              </button>
            )}
            {card.paused_at && (
              <button type="button" disabled={busy} onClick={() => lifecycle.mutate({ action: 'resume' })} className="rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
                Resume
              </button>
            )}
            {isPublished && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('Recall this card?\n\nIt comes off SquadHire and returns to Onboarding for edits.')) {
                      lifecycle.mutate({ action: 'recall' });
                    }
                  }}
                  className={actionBtn}
                >
                  Recall
                </button>
                <button type="button" disabled={busy} onClick={() => setCloseOpen(true)} className={actionBtn} title="End the round — withdraws un-accepted offers and notifies remaining candidates">
                  Close
                </button>
              </>
            )}
            {card.state !== 'closed' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('Cancel this card permanently?\n\nIt closes and comes off SquadHire. This cannot be undone.')) {
                    lifecycle.mutate({ action: 'cancel' });
                  }
                }}
                className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                Cancel
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => setEditorOpen(true)} className={actionBtn}>
              Edit
            </button>
            <button type="button" disabled={busy} onClick={() => lifecycle.mutate({ action: 'duplicate' })} className={actionBtn} title="Copy details into a fresh New Deals draft">
              Duplicate
            </button>
            {card.archived_at ? (
              <button type="button" disabled={busy} onClick={() => lifecycle.mutate({ action: 'unarchive' })} className={actionBtn}>
                Unarchive
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => lifecycle.mutate({ action: 'archive' })} className={actionBtn}>
                Archive
              </button>
            )}
            {isDraft && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('Move this card to Trash?')) remove.mutate();
                }}
                className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Detail sub-tabs */}
        <div className="mt-4 flex items-center gap-1.5">
          {(
            [
              { key: 'overview', label: 'Overview' },
              { key: 'candidates', label: `Candidates (${candidateTotal})` },
              { key: 'qa', label: 'Q&A' },
              { key: 'activity', label: 'Activity' },
            ] as { key: DetailTab; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setDetailTab(key)}
              data-active={detailTab === key}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                detailTab === key
                  ? 'border-transparent bg-[var(--color-sh-lime-soft)] text-[var(--color-sh-ink)] shadow-[inset_0_0_0_1px_var(--color-sh-ink)]'
                  : 'border-[var(--color-sh-warm-border)] bg-surface text-[var(--color-sh-ink-muted)] hover:text-[var(--color-sh-ink)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {detailTab === 'overview' && <JobCardOverview card={card} onOpenOnboarding={() => setOnboardingOpen(true)} onOpenEditor={() => setEditorOpen(true)} />}
        {detailTab === 'candidates' && <JobCandidatesView card={card} />}
        {detailTab === 'qa' && <JobCardQnA card={card} />}
        {detailTab === 'activity' && <JobCardActivity cardId={card.id} />}
      </div>

      {onboardingOpen && (
        <OnboardingPanel
          card={card}
          onClose={() => setOnboardingOpen(false)}
          onAttached={() => {
            setOnboardingOpen(false);
            invalidate();
          }}
        />
      )}
      {editorOpen && <JobCardEditor card={card} onClose={() => { setEditorOpen(false); invalidate(); }} />}
      {closeOpen && <CloseJobCardDialog card={card} onClose={() => setCloseOpen(false)} />}
    </div>
  );
}

function OverviewField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-dim">{label}</p>
      <p className="mt-0.5 text-sm text-foreground">{value ?? '—'}</p>
    </div>
  );
}

function JobCardOverview({
  card,
  onOpenOnboarding,
  onOpenEditor,
}: {
  card: AdminJobCard;
  onOpenOnboarding: () => void;
  onOpenEditor: () => void;
}) {
  const profile = card.job_profile ?? null;
  const business = card.business_profile ?? null;
  const brand = card.brand_profile ?? null;
  const overriddenCount = Object.keys(card.rule_overrides ?? {}).length;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Card facts */}
      <div className="space-y-4">
        <div className="rounded-lg border border-divider bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Card details</p>
            <button type="button" onClick={onOpenEditor} className="text-[11px] font-semibold text-accent hover:underline">
              Edit
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <OverviewField label="Business" value={card.customer_company || business?.name || '—'} />
            <OverviewField label="Contact" value={card.customer_name || '—'} />
            <OverviewField label="Email" value={card.customer_email || '—'} />
            <OverviewField label="Phone" value={card.customer_phone || '—'} />
            <OverviewField label="Package" value={packageLabel(card) || '—'} />
            <OverviewField label="Openings" value={card.openings_count} />
            <OverviewField label="Expected joining" value={card.expected_joining_date || '—'} />
            <OverviewField label="Expires" value={card.expires_at ? new Date(card.expires_at).toLocaleDateString() : '—'} />
            <OverviewField label="Distribution" value={card.distribution === 'manual' ? 'Manual (hand-picked)' : 'Broadcast'} />
            <OverviewField
              label="Rule overrides"
              value={overriddenCount > 0 ? `${overriddenCount} rule${overriddenCount === 1 ? '' : 's'} overridden` : 'Inheriting profile defaults'}
            />
          </div>
          {card.brief_note && (
            <div className="mt-3 border-t border-divider pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-dim">Brief note</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{card.brief_note}</p>
            </div>
          )}
          {card.package_notes && (
            <div className="mt-3 border-t border-divider pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-dim">Package notes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{card.package_notes}</p>
            </div>
          )}
        </div>

        <JobMatchPreview card={card} />
      </div>

      {/* Profile hierarchy */}
      <div className="space-y-4">
        <div className="rounded-lg border border-divider bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Job profile</p>
            <button type="button" onClick={onOpenOnboarding} className="text-[11px] font-semibold text-accent hover:underline">
              {profile ? 'Open onboarding' : 'Start onboarding'}
            </button>
          </div>
          {profile ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <OverviewField label="Title" value={profile.title} />
                <OverviewField label="Type" value={`${profile.employment_type?.replace('_', ' ') ?? '—'} · ${profile.work_mode ?? '—'}`} />
                <OverviewField
                  label="Salary range"
                  value={
                    profile.salary_min != null || profile.salary_max != null
                      ? `${profile.salary_currency} ${profile.salary_min != null ? Number(profile.salary_min).toLocaleString() : '—'}–${profile.salary_max != null ? Number(profile.salary_max).toLocaleString() : '—'}${profile.salary_period === 'annual' ? '/yr' : '/mo'}`
                      : '—'
                  }
                />
                <OverviewField
                  label="SquadHire categories"
                  value={
                    (profile.squadhire_category_ids ?? []).length > 0 ? (
                      `${profile.squadhire_category_ids.length} selected`
                    ) : (
                      <span className="font-semibold text-amber-700 dark:text-amber-400">None — cannot broadcast</span>
                    )
                  }
                />
              </div>
              {profile.description && (
                <p className="line-clamp-4 whitespace-pre-wrap text-xs text-foreground-muted">{profile.description}</p>
              )}
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-divider px-3 py-4 text-center text-xs text-foreground-dim">
              No job profile yet — run onboarding to build the business, brand and job profiles.
            </p>
          )}
        </div>

        {business && (
          <div className="rounded-lg border border-divider bg-surface p-4">
            <p className="mb-3 text-sm font-semibold text-foreground">Business{brand ? ' & brand' : ''}</p>
            <div className="grid grid-cols-2 gap-3">
              <OverviewField label="Business" value={business.name} />
              <OverviewField label="Industry" value={business.industry || '—'} />
              {brand && <OverviewField label="Brand" value={brand.name} />}
              {business.website && (
                <OverviewField
                  label="Website"
                  value={
                    <a href={business.website} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-2 hover:underline">
                      {business.website}
                    </a>
                  }
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function JobCardActivity({ cardId }: { cardId: string }) {
  const { data: eventsRes, isLoading } = useQuery({
    queryKey: ['admin-job-card-events', cardId],
    queryFn: () => api.get(`/admin/job-cards/${cardId}/events`).then((r) => r.data),
  });
  const events: Array<{ id: string; event_type: string; actor_label: string | null; actor_type: string | null; created_at: string; metadata: Record<string, unknown> }> =
    eventsRes?.data || [];

  if (isLoading) return <p className="py-6 text-center text-xs text-foreground-dim">Loading activity…</p>;
  if (events.length === 0) {
    return <p className="rounded-lg border border-dashed border-divider px-4 py-8 text-center text-xs text-foreground-dim">No activity yet.</p>;
  }

  return (
    <ol className="space-y-1.5">
      {events.map((e) => (
        <li key={e.id} className="flex items-center justify-between gap-3 rounded-lg border border-divider bg-surface px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{e.event_type.replace(/_/g, ' ')}</p>
            <p className="mt-0.5 text-[11px] text-foreground-dim">
              {e.actor_label || e.actor_type || 'system'}
            </p>
          </div>
          <span className="shrink-0 text-[11px] text-foreground-dim">
            {new Date(e.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
        </li>
      ))}
    </ol>
  );
}
