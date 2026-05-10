'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

type Tab = 'partner' | 'talent';

type PartnerHit = { id: string; name: string; email: string | null; tier: string | null };
type TalentHit = { id: string; name: string; email: string | null; country: string | null; tier: string | null };

export default function MobileAssignModal({
  cardId,
  onClose,
}: {
  cardId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('partner');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const partners = useQuery({
    queryKey: ['admin-partner-search', debouncedQuery],
    queryFn: () =>
      api.get('/admin/partners/search', { params: { q: debouncedQuery } }).then(
        (r) => (r.data?.data as PartnerHit[]) ?? [],
      ),
    enabled: tab === 'partner' && debouncedQuery.length > 0,
  });

  const talents = useQuery({
    queryKey: ['admin-talent-search', debouncedQuery],
    queryFn: () =>
      api.get('/admin/talents/search', { params: { q: debouncedQuery } }).then(
        (r) => (r.data?.data as TalentHit[]) ?? [],
      ),
    enabled: tab === 'talent' && debouncedQuery.length > 0,
    retry: 0,
  });

  const assignPartner = useMutation({
    mutationFn: (partnerId: string) =>
      api.post(`/admin/subscription-cards/${cardId}/assign-partner`, { partner_id: partnerId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-card-recipients', cardId] });
      onClose();
    },
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
  });

  const isAssigning = assignPartner.isPending || assignTalent.isPending;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col sh-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-sh-warm-border)] bg-white px-4 py-3">
        <h3 className="text-base font-semibold text-[var(--color-sh-ink)]">
          Assign Recipient
        </h3>
        <button
          onClick={onClose}
          className="sh-btn-ghost sh-btn-ghost-sm"
        >
          Close
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-[var(--color-sh-warm-border)] bg-white px-4 py-3">
        <div className="sh-tab-bar">
          <button
            type="button"
            data-active={tab === 'partner'}
            onClick={() => setTab('partner')}
            className="sh-tab"
          >
            Partners
          </button>
          <button
            type="button"
            data-active={tab === 'talent'}
            onClick={() => setTab('talent')}
            className="sh-tab"
          >
            Talents
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-[var(--color-sh-warm-border)] bg-white px-4 py-3">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === 'partner' ? 'Search partners…' : 'Search talents…'}
          className="sh-input"
        />
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {debouncedQuery.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-[var(--color-sh-ink-faint)]">Start typing to search.</p>
          </div>
        ) : tab === 'partner' ? (
          <HitList
            loading={partners.isLoading}
            error={partners.error}
            items={(partners.data ?? []).map((p) => ({
              id: p.id,
              name: p.name,
              subtitle: p.email,
              badge: p.tier,
            }))}
            disabled={isAssigning}
            onPick={(id) => assignPartner.mutate(id)}
          />
        ) : (
          <HitList
            loading={talents.isLoading}
            error={talents.error}
            items={(talents.data ?? []).map((t) => ({
              id: t.id,
              name: t.name || 'Unnamed talent',
              subtitle: t.email,
              badge: t.tier,
            }))}
            disabled={isAssigning}
            onPick={(id) => {
              const t = talents.data?.find((x) => x.id === id);
              if (t) assignTalent.mutate(t);
            }}
          />
        )}
      </div>
    </div>
  );
}

function HitList({
  loading,
  error,
  items,
  disabled,
  onPick,
}: {
  loading: boolean;
  error: unknown;
  items: { id: string; name: string; subtitle: string | null; badge: string | null }[];
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  if (loading) return <p className="py-8 text-center text-sm text-[var(--color-sh-ink-faint)]">Searching…</p>;
  if (error) return <p className="py-8 text-center text-sm text-red-600">Search failed.</p>;
  if (items.length === 0) return <p className="py-8 text-center text-sm text-[var(--color-sh-ink-faint)]">No results found.</p>;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onPick(item.id)}
          disabled={disabled}
          className="sh-card sh-card-interactive flex w-full items-center justify-between gap-3 px-4 py-3 text-left disabled:opacity-50"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-sh-lime-soft)] text-[var(--color-sh-ink)] text-sm font-bold ring-1 ring-[var(--color-sh-warm-border)]">
              {item.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--color-sh-ink)]">{item.name}</p>
              {item.subtitle && (
                <p className="truncate text-xs text-[var(--color-sh-ink-faint)]">{item.subtitle}</p>
              )}
            </div>
          </div>
          {item.badge && (
            <span className="shrink-0 rounded-full border border-[var(--color-sh-warm-border)] bg-[var(--color-sh-cream)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--color-sh-ink-subtle)]">
              {item.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
