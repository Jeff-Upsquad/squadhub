import { useEffect, useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { OnboardingListResponse, CandidateOnboardingProgress } from '@squadhub/shared';
import api from '../../../services/api';
import { Chip, groupByBucket, initials, formatPhone } from './helpers';
import CandidateSidePanel from './CandidateSidePanel';
import { useAllowedCategories } from './useAllowedCategories';

const CATEGORY_TABS = [
  { value: 'creative', label: 'Creative' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'sales', label: 'Sales' },
];

type StageKey = keyof Pick<
  CandidateOnboardingProgress,
  'signed_up' | 'onboarding_completed' | 'basic_profile_completed' | 'job_profile_completed' | 'portfolio_completed'
>;
const STAGES: { key: StageKey; short: string }[] = [
  { key: 'signed_up', short: 'Sign-up' },
  { key: 'onboarding_completed', short: 'Course' },
  { key: 'basic_profile_completed', short: 'Basic' },
  { key: 'job_profile_completed', short: 'Job' },
  { key: 'portfolio_completed', short: 'Portfolio' },
];

function StageRow({ progress }: { progress: CandidateOnboardingProgress }) {
  return (
    <div className="flex items-center gap-1.5">
      {STAGES.map((stage, i) => {
        const done = progress[stage.key];
        const isLast = i === STAGES.length - 1;
        return (
          <div key={stage.key} className="flex items-center gap-1.5" title={`${stage.short}: ${done ? 'Done' : 'Pending'}`}>
            <div className="flex flex-col items-center gap-1">
              <span className="relative z-10 flex h-5 w-5 items-center justify-center">
                {done ? (
                  <svg className="h-5 w-5 text-emerald-500" viewBox="0 0 24 24" fill="currentColor">
                    <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <span className="h-4 w-4 rounded-full border-2 border-divider bg-surface" />
                )}
              </span>
              <span className={`text-[10px] font-medium leading-none ${done ? 'text-foreground' : 'text-foreground-dim'}`}>{stage.short}</span>
            </div>
            {!isLast && <span className={`h-0.5 w-4 -translate-y-2 ${done ? 'bg-emerald-300' : 'bg-divider'}`} />}
          </div>
        );
      })}
    </div>
  );
}

export default function OnboardingTab() {
  const [formType, setFormType] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: allowed } = useAllowedCategories();
  const restricted = !!allowed && Object.keys(allowed).length < 3;
  const catTabs = useMemo(() => CATEGORY_TABS.filter((t) => allowed?.[t.value]), [allowed]);
  const tabs = useMemo(
    () => (restricted ? catTabs : [{ value: '', label: 'All' }, ...catTabs]),
    [restricted, catTabs],
  );

  // Scoped users can't request "All" — default to their first allowed category.
  useEffect(() => {
    if (restricted && allowed && !allowed[formType]) {
      setFormType(catTabs[0]?.value ?? '');
      setPage(1);
    }
  }, [restricted, allowed, formType, catTabs]);

  const { data, isLoading, isPlaceholderData } = useQuery<OnboardingListResponse>({
    queryKey: ['candidates-onboarding', formType, search, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (formType) params.set('form_type', formType);
      if (search) params.set('search', search);
      params.set('page', String(page));
      params.set('limit', '25');
      return (await api.get(`/candidates/onboarding?${params.toString()}`)).data;
    },
    placeholderData: keepPreviousData,
    enabled: !!allowed && (!restricted || !!allowed[formType]),
  });

  const leads = data?.leads ?? [];
  const buckets = useMemo(() => groupByBucket(leads), [leads]);
  const selectedIndex = useMemo(() => {
    if (!selectedId) return null;
    const idx = leads.findIndex((l) => l.id === selectedId);
    return idx === -1 ? null : idx;
  }, [selectedId, leads]);

  const navigate = (direction: -1 | 1) => {
    if (selectedIndex === null) return;
    const next = leads[selectedIndex + direction];
    if (next) setSelectedId(next.id);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Onboarding</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Signed-up candidates and their progress through onboarding. Click a row to open the candidate.
        </p>
      </div>

      <div className="flex w-fit gap-1 rounded-lg bg-canvas p-1">
        {tabs.map((tab) => (
          <button
            key={tab.value || 'all'}
            onClick={() => { setFormType(tab.value); setPage(1); }}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              formType === tab.value ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="w-72">
        <input
          placeholder="Search name, email, phone…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="block w-full rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-dim focus:border-[var(--color-accent)] focus:outline-none"
        />
      </div>

      <div className={isPlaceholderData ? 'opacity-70 transition-opacity' : ''}>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-foreground/5" />
            ))}
          </div>
        ) : !leads.length ? (
          <div className="rounded-lg border border-dashed border-divider py-12 text-center text-sm text-foreground-muted">
            No signed-up candidates match your filters.
          </div>
        ) : (
          <div className="space-y-6">
            {buckets.map((bucket) => (
              <section key={bucket.key}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">{bucket.label}</h2>
                  <span className="text-xs text-foreground-dim">{bucket.items.length}</span>
                  <div className="ml-2 h-px flex-1 bg-divider" />
                </div>
                <div className="overflow-hidden rounded-lg border border-divider bg-surface">
                  <ul className="divide-y divide-divider">
                    {bucket.items.map((lead) => {
                      const isSelected = lead.id === selectedId;
                      return (
                        <li
                          key={lead.id}
                          onClick={() => setSelectedId(lead.id)}
                          className={`flex cursor-pointer items-center gap-4 px-4 py-3 transition-colors ${
                            isSelected ? 'bg-[var(--color-accent)]/5 ring-1 ring-inset ring-[var(--color-accent)]/30' : 'hover:bg-canvas'
                          }`}
                        >
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/10 text-sm font-semibold text-[var(--color-accent)]">
                            {initials(lead.name)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium text-foreground">{lead.name}</p>
                              <Chip tone="gray">{lead.form_type}</Chip>
                              {lead.auto_approved && <Chip tone="violet">Auto-approved</Chip>}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-foreground-muted">
                              {formatPhone(lead.phone)}{lead.email ? ` · ${lead.email}` : ''}
                            </p>
                          </div>
                          <div className="hidden lg:block">
                            <StageRow progress={lead.onboarding_progress} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {data && data.total_pages > 1 && (
        <div className="flex items-center justify-between text-sm text-foreground-muted">
          <span>Page {data.page} of {data.total_pages} ({data.total} total)</span>
          <div className="flex gap-2">
            <button
              className="rounded-lg border border-divider px-3 py-1.5 text-sm text-foreground hover:bg-canvas disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              className="rounded-lg border border-divider px-3 py-1.5 text-sm text-foreground hover:bg-canvas disabled:opacity-50"
              disabled={page >= data.total_pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      <CandidateSidePanel
        candidateId={selectedId}
        onClose={() => setSelectedId(null)}
        onNavigate={navigate}
        hasPrev={selectedIndex !== null && selectedIndex > 0}
        hasNext={selectedIndex !== null && selectedIndex < leads.length - 1}
        currentIndex={selectedIndex}
        totalCount={leads.length}
      />
    </div>
  );
}
