'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

type PartnerHit = {
  id: string;
  name: string;
  email: string | null;
  tier: string | null;
  country_id: string | null;
};

type TalentHit = {
  id: string;
  name: string;
  email: string | null;
  country: string | null;
  tier: string | null;
};

export default function AssignRecipientPicker({
  cardId,
  onClose,
}: {
  cardId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the search input on open.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Close on Escape — same pattern as the recipients panel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Both searches fire in parallel against the single query so the user
  // only types once and sees grouped results.
  const partnersQ = useQuery({
    queryKey: ['admin-partner-search', debouncedQuery],
    queryFn: () =>
      api.get('/admin/partners/search', { params: { q: debouncedQuery } }).then(
        (r) => (r.data?.data as PartnerHit[]) ?? [],
      ),
    enabled: debouncedQuery.length > 0,
  });

  const talentsQ = useQuery({
    queryKey: ['admin-talent-search', debouncedQuery],
    queryFn: () =>
      api.get('/admin/talents/search', { params: { q: debouncedQuery } }).then(
        (r) => (r.data?.data as TalentHit[]) ?? [],
      ),
    enabled: debouncedQuery.length > 0,
    retry: 0,
  });

  const assignPartner = useMutation({
    mutationFn: (partnerId: string) =>
      api.post(`/admin/subscription-cards/${cardId}/assign-partner`, { partner_id: partnerId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', cardId] });
      onClose();
    },
    onError: (err: any) =>
      alert(err?.response?.data?.error || err.message || 'Failed to assign partner'),
  });

  const assignTalent = useMutation({
    mutationFn: (t: TalentHit) =>
      api.post(`/admin/subscription-cards/${cardId}/assign-talent`, {
        talent_id: t.id,
        talent_name: t.name || undefined,
        talent_email: t.email || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', cardId] });
      onClose();
    },
    onError: (err: any) =>
      alert(err?.response?.data?.error || err.message || 'Failed to assign talent'),
  });

  const isAssigning = assignPartner.isPending || assignTalent.isPending;

  const partners = partnersQ.data ?? [];
  const talents = talentsQ.data ?? [];
  const isLoading = partnersQ.isLoading || talentsQ.isLoading;
  const isError = !!partnersQ.error && !!talentsQ.error; // both failed
  const hasResults = partners.length > 0 || talents.length > 0;
  const totalCount = useMemo(() => partners.length + talents.length, [partners, talents]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-[560px] w-[520px] max-w-[95vw] flex-col overflow-hidden rounded-[16px] border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-sh-warm-border)] bg-surface px-5 py-4">
          <div className="space-y-1.5 min-w-0">
            <span className="sh-eyebrow">
              <span className="sh-eyebrow-dot" />
              Assign recipient
            </span>
            <h3 className="sh-display text-xl">Pick a partner or talent</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-[var(--color-sh-ink-muted)] hover:bg-[var(--color-sh-cream)] hover:text-[var(--color-sh-ink)] transition"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-[var(--color-sh-warm-border)] bg-surface px-5 py-3">
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-sh-ink-faint)]"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search partners and talents by name or email…"
              className="sh-input pl-9"
            />
          </div>
          {debouncedQuery.length > 0 && hasResults && (
            <p className="mt-2 text-[11px] text-[var(--color-sh-ink-faint)]">
              {totalCount} {totalCount === 1 ? 'match' : 'matches'} · {partners.length} partner{partners.length === 1 ? '' : 's'} · {talents.length} talent{talents.length === 1 ? '' : 's'}
            </p>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {debouncedQuery.length === 0 ? (
            <div className="sh-card flex h-full flex-col items-center justify-center py-12 text-center">
              <svg className="h-8 w-8 text-[var(--color-sh-ink-faint)]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
              </svg>
              <p className="mt-3 text-sm font-semibold text-[var(--color-sh-ink)]">Start typing to search</p>
              <p className="mt-1 text-xs text-[var(--color-sh-ink-muted)]">
                Searches partners (SquadHub) and talents (SquadHire) at once.
              </p>
            </div>
          ) : isLoading && !hasResults ? (
            <div className="sh-card py-12 text-center">
              <p className="text-sm text-[var(--color-sh-ink-faint)]">Searching…</p>
            </div>
          ) : isError ? (
            <div className="sh-card py-12 text-center">
              <p className="text-sm text-red-600">Search failed. Try again.</p>
            </div>
          ) : !hasResults ? (
            <div className="sh-card py-12 text-center">
              <p className="text-sm text-[var(--color-sh-ink-subtle)]">No partners or talents found.</p>
              <p className="mt-1 text-xs text-[var(--color-sh-ink-faint)]">
                Try a different search term.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Partners section */}
              {partners.length > 0 && (
                <section>
                  <h4 className="sh-section-heading mb-2 px-1">
                    Partners <span className="opacity-70">({partners.length})</span>
                  </h4>
                  <div className="space-y-1.5">
                    {partners.map((p) => (
                      <button
                        key={`partner-${p.id}`}
                        disabled={isAssigning}
                        onClick={() => assignPartner.mutate(p.id)}
                        className="sh-card sh-card-interactive flex w-full items-center justify-between gap-3 px-4 py-3 text-left disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-1 ring-[var(--color-sh-warm-border)]"
                            style={{ background: '#DBEAFE', color: '#1E40AF' }}
                          >
                            {(p.name || 'P').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[var(--color-sh-ink)]">{p.name}</p>
                            {p.email && (
                              <p className="truncate text-[11px] text-[var(--color-sh-ink-faint)]">{p.email}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="sh-status-pill" style={{ backgroundColor: '#DBEAFE', color: '#1E40AF' }}>
                            Partner
                          </span>
                          {p.tier && (
                            <span className="sh-status-pill" style={{ backgroundColor: '#EEF2F6', color: '#475569' }}>
                              {p.tier}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                  {partnersQ.isFetching && (
                    <p className="mt-2 text-[11px] text-[var(--color-sh-ink-faint)]">Refining…</p>
                  )}
                </section>
              )}

              {/* Talents section */}
              {talents.length > 0 && (
                <section>
                  <h4 className="sh-section-heading mb-2 px-1">
                    Talents <span className="opacity-70">({talents.length})</span>
                  </h4>
                  <div className="space-y-1.5">
                    {talents.map((t) => (
                      <button
                        key={`talent-${t.id}`}
                        disabled={isAssigning}
                        onClick={() => assignTalent.mutate(t)}
                        className="sh-card sh-card-interactive flex w-full items-center justify-between gap-3 px-4 py-3 text-left disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-1 ring-[var(--color-sh-warm-border)]"
                            style={{ background: 'var(--color-sh-lime-soft)', color: 'var(--color-sh-ink)' }}
                          >
                            {(t.name || 'T').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[var(--color-sh-ink)]">{t.name || 'Unnamed talent'}</p>
                            {t.email && (
                              <p className="truncate text-[11px] text-[var(--color-sh-ink-faint)]">{t.email}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="sh-status-pill" style={{ backgroundColor: '#F2EBFE', color: '#6B21A8' }}>
                            Talent
                          </span>
                          {t.tier && (
                            <span className="sh-status-pill" style={{ backgroundColor: '#EEF2F6', color: '#475569' }}>
                              {t.tier}
                            </span>
                          )}
                          {t.country && (
                            <span className="sh-status-pill" style={{ backgroundColor: '#EEF2F6', color: '#475569' }}>
                              {t.country}
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                  {talentsQ.isFetching && (
                    <p className="mt-2 text-[11px] text-[var(--color-sh-ink-faint)]">Refining…</p>
                  )}
                  {talentsQ.error && (
                    <p className="mt-2 text-[11px] text-red-600">
                      Couldn&apos;t reach SquadHire — only partners shown above.
                    </p>
                  )}
                </section>
              )}

              {/* Partial-success message: partners-only when SquadHire is down */}
              {partners.length > 0 && talents.length === 0 && talentsQ.error && (
                <p className="text-center text-[11px] text-amber-700">
                  Couldn&apos;t reach SquadHire — talents not loaded.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
