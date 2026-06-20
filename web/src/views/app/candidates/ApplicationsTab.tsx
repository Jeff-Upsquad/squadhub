import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { CandidatesListResponse } from '@squadhub/shared';
import api from '../../../services/api';
import {
  CATEGORY_CARDS,
  CATEGORY_LABELS,
  STATUS_LABELS,
  STATUS_OPTIONS,
  STATUS_TONE,
  Chip,
  groupByBucket,
  initials,
  formatPhone,
} from './helpers';
import CandidateSidePanel from './CandidateSidePanel';
import { useAllowedCategories } from './useAllowedCategories';

const SIGNED_UP_TABS = [
  { value: '', label: 'Candidates' },
  { value: 'true', label: 'Signed Up' },
];
const VIEW_TABS = [
  { value: '', label: 'Active' },
  { value: 'true', label: 'Recycle Bin' },
];

export default function ApplicationsTab() {
  const [formType, setFormType] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [signedUp, setSignedUp] = useState('');
  const [deleted, setDeleted] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const isHubMode = !formType;

  const { data: allowed } = useAllowedCategories();
  const visibleCards = useMemo(
    () => CATEGORY_CARDS.filter((c) => !allowed || allowed.includes(c.value)),
    [allowed],
  );

  const resetFilters = () => {
    setStatus('');
    setSearch('');
    setSignedUp('');
    setDeleted('');
    setPage(1);
  };

  const { data, isLoading, isPlaceholderData } = useQuery<CandidatesListResponse>({
    queryKey: ['candidates', formType, status, search, signedUp, deleted, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (formType) params.set('form_type', formType);
      if (status) params.set('status', status);
      if (search) params.set('search', search);
      if (signedUp) params.set('signed_up', signedUp);
      if (deleted) params.set('deleted', deleted);
      params.set('page', String(page));
      params.set('limit', '25');
      const res = await api.get(`/candidates?${params.toString()}`);
      return res.data;
    },
    placeholderData: keepPreviousData,
    enabled: !isHubMode,
  });

  const hubCounts = useQuery<Record<string, number>>({
    queryKey: ['candidates-counts', visibleCards.map((c) => c.value).join(',')],
    queryFn: async () => {
      const entries = await Promise.all(
        visibleCards.map(async (cat) => {
          const res = await api.get(`/candidates?form_type=${cat.value}&page=1&limit=1`);
          return [cat.value, res.data.total as number] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
    enabled: isHubMode && !!allowed,
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

  // ---- Hub -----------------------------------------------------------------
  if (isHubMode) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Candidates</h1>
          <p className="mt-1 text-sm text-foreground-muted">Choose a category to review applications.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleCards.map((cat) => (
            <button
              key={cat.value}
              onClick={() => { setFormType(cat.value); resetFilters(); }}
              className="rounded-xl border border-divider bg-surface p-6 text-left transition-all hover:border-[var(--color-accent)] hover:shadow-sm"
            >
              <h3 className="text-lg font-semibold text-foreground">{cat.label}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-foreground-muted">{cat.description}</p>
              <div className="mt-3 text-sm text-foreground-muted">
                {hubCounts.isLoading ? (
                  <span className="inline-block h-4 w-16 animate-pulse rounded bg-foreground/10" />
                ) : (
                  <>
                    <span className="font-semibold text-foreground">{hubCounts.data?.[cat.value] ?? 0}</span> candidates
                  </>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- Category list -------------------------------------------------------
  const categoryLabel = CATEGORY_LABELS[formType] ?? formType;

  return (
    <div className="space-y-5">
      <div>
        <button
          onClick={() => { setFormType(''); resetFilters(); }}
          className="mb-2 text-sm text-foreground-muted transition-colors hover:text-[var(--color-accent)]"
        >
          &larr; Back to Categories
        </button>
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">{categoryLabel} Candidates</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Applications grouped by time. Click a row to review and update status.
        </p>
      </div>

      {/* Signed-up + recycle-bin toggles */}
      <div className="flex flex-wrap gap-3">
        <div className="flex w-fit gap-1 rounded-lg bg-canvas p-1">
          {SIGNED_UP_TABS.map((tab) => (
            <button
              key={tab.value || 'candidates'}
              onClick={() => { setSignedUp(tab.value); setPage(1); }}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                signedUp === tab.value ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex w-fit gap-1 rounded-lg bg-canvas p-1">
          {VIEW_TABS.map((tab) => (
            <button
              key={tab.value || 'active'}
              onClick={() => { setDeleted(tab.value); setPage(1); }}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                deleted === tab.value
                  ? tab.value ? 'bg-surface text-red-600 shadow-sm' : 'bg-surface text-foreground shadow-sm'
                  : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Status + search */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <label className="mb-1 block text-xs font-medium text-foreground-muted">Status</label>
          <select
            className="block w-full rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-[var(--color-accent)] focus:outline-none"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="w-72">
          <label className="mb-1 block text-xs font-medium text-foreground-muted">Search</label>
          <input
            placeholder="Search name, email, phone…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="block w-full rounded-lg border border-divider bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground-dim focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>
      </div>

      {/* Grouped list */}
      <div className={isPlaceholderData ? 'opacity-70 transition-opacity' : ''}>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-foreground/5" />
            ))}
          </div>
        ) : !leads.length ? (
          <div className="rounded-lg border border-dashed border-divider py-12 text-center text-sm text-foreground-muted">
            No candidates match your filters.
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
                              {lead.linked_talent && <Chip tone="green">Signed up</Chip>}
                              {lead.auto_approved && <Chip tone="violet">Auto-approved</Chip>}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-foreground-muted">
                              {formatPhone(lead.phone)}{lead.email ? ` · ${lead.email}` : ''}
                            </p>
                          </div>
                          <div className="hidden sm:block">
                            <Chip tone={STATUS_TONE[lead.status] ?? 'gray'}>{STATUS_LABELS[lead.status] ?? lead.status}</Chip>
                          </div>
                          <div className="hidden w-20 text-right text-xs text-foreground-dim md:block">
                            {new Date(lead.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
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

      {/* Pagination */}
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
