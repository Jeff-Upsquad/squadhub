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
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#F7F6F3]">
      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-black bg-white px-4 py-3">
        <h3 className="font-[family-name:var(--font-jakarta)] text-base font-bold text-[#0a0a0a]">
          Assign Recipient
        </h3>
        <button
          onClick={onClose}
          className="rounded-lg border-2 border-black bg-white px-3 py-1.5 text-xs font-bold text-[#0a0a0a] active:scale-[0.97] transition-transform"
        >
          Close
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b-2 border-black bg-white">
        {(['partner', 'talent'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-bold transition-colors ${
              tab === t
                ? 'border-b-3 border-[#d4ff4d] bg-[#0a0a0a] text-white'
                : 'text-[#525252]'
            }`}
          >
            {t === 'partner' ? 'Partners' : 'Talents'}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="border-b-2 border-black/10 bg-white px-4 py-3">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === 'partner' ? 'Search partners...' : 'Search talents...'}
          className="w-full rounded-xl border-2 border-black bg-white px-4 py-3 text-base text-[#0a0a0a] placeholder-[#a3a3a3] outline-none transition-shadow focus:shadow-[3px_3px_0_0_#000]"
        />
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {debouncedQuery.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-[#a3a3a3]">Start typing to search.</p>
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
              extra: t,
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
  if (loading) return <p className="py-8 text-center text-sm text-[#a3a3a3]">Searching...</p>;
  if (error) return <p className="py-8 text-center text-sm text-red-600">Search failed.</p>;
  if (items.length === 0) return <p className="py-8 text-center text-sm text-[#a3a3a3]">No results found.</p>;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onPick(item.id)}
          disabled={disabled}
          className="flex w-full items-center justify-between gap-3 rounded-xl border-2 border-black bg-white px-4 py-3.5 text-left shadow-[2px_2px_0_0_#000] transition-transform active:scale-[0.98] active:shadow-[1px_1px_0_0_#000] disabled:opacity-50"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-[#0a0a0a]">{item.name}</p>
            {item.subtitle && (
              <p className="truncate text-xs text-[#a3a3a3]">{item.subtitle}</p>
            )}
          </div>
          {item.badge && (
            <span className="shrink-0 rounded-full border border-black/20 bg-[#F7F6F3] px-2.5 py-0.5 text-[10px] font-bold text-[#525252]">
              {item.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
