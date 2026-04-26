'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

type Tab = 'partner' | 'talent';

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
  const [tab, setTab] = useState<Tab>('partner');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the search input on open. Switching tabs preserves the query so a
  // partner-not-found admin can flip to Talents and try the same name.
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

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-[520px] w-[480px] max-w-[95vw] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-4 py-3">
          <h3 className="text-sm font-semibold text-[#0F172B]">Assign partner or talent</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-[#62748E] hover:bg-[#F8FAFC]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex border-b border-[#E2E8F0]">
          <TabButton active={tab === 'partner'} onClick={() => setTab('partner')}>
            Partners
          </TabButton>
          <TabButton active={tab === 'talent'} onClick={() => setTab('talent')}>
            Talents
          </TabButton>
        </div>

        <div className="border-b border-[#E2E8F0] px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tab === 'partner' ? 'Search partners by name or email…' : 'Search talents by name or email…'
            }
            className="w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-sm text-[#0F172B] placeholder:text-[#90A1B9] focus:border-[#0F172B] focus:outline-none"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {debouncedQuery.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#90A1B9]">
              Start typing to search.
            </div>
          ) : tab === 'partner' ? (
            <PartnerList
              loading={partners.isLoading}
              error={partners.error as any}
              hits={partners.data ?? []}
              disabled={isAssigning}
              onPick={(p) => assignPartner.mutate(p.id)}
            />
          ) : (
            <TalentList
              loading={talents.isLoading}
              error={talents.error as any}
              hits={talents.data ?? []}
              disabled={isAssigning}
              onPick={(t) => assignTalent.mutate(t)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-4 py-2 text-xs font-medium ${
        active
          ? 'border-b-2 border-[#0F172B] text-[#0F172B]'
          : 'text-[#62748E] hover:text-[#0F172B]'
      }`}
    >
      {children}
    </button>
  );
}

function PartnerList({
  loading,
  error,
  hits,
  disabled,
  onPick,
}: {
  loading: boolean;
  error: { message?: string } | null;
  hits: PartnerHit[];
  disabled: boolean;
  onPick: (p: PartnerHit) => void;
}) {
  if (loading) {
    return <div className="p-6 text-center text-xs text-[#90A1B9]">Searching…</div>;
  }
  if (error) {
    return (
      <div className="p-6 text-center text-xs text-red-600">
        {error.message || 'Search failed.'}
      </div>
    );
  }
  if (hits.length === 0) {
    return <div className="p-6 text-center text-xs text-[#90A1B9]">No partners found.</div>;
  }
  return (
    <ul className="divide-y divide-[#E2E8F0]">
      {hits.map((p) => (
        <li key={p.id}>
          <button
            disabled={disabled}
            onClick={() => onPick(p)}
            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-[#F8FAFC] disabled:opacity-50"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-[#0F172B]">{p.name}</p>
              {p.email && <p className="truncate text-[11px] text-[#90A1B9]">{p.email}</p>}
            </div>
            {p.tier && (
              <span className="shrink-0 rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-medium text-[#62748E]">
                {p.tier}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function TalentList({
  loading,
  error,
  hits,
  disabled,
  onPick,
}: {
  loading: boolean;
  error: { message?: string } | null;
  hits: TalentHit[];
  disabled: boolean;
  onPick: (t: TalentHit) => void;
}) {
  if (loading) {
    return <div className="p-6 text-center text-xs text-[#90A1B9]">Searching SquadHire…</div>;
  }
  if (error) {
    return (
      <div className="p-6 text-center text-xs text-red-600">
        Couldn&apos;t reach SquadHire.
      </div>
    );
  }
  if (hits.length === 0) {
    return <div className="p-6 text-center text-xs text-[#90A1B9]">No talents found.</div>;
  }
  return (
    <ul className="divide-y divide-[#E2E8F0]">
      {hits.map((t) => (
        <li key={t.id}>
          <button
            disabled={disabled}
            onClick={() => onPick(t)}
            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-[#F8FAFC] disabled:opacity-50"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-[#0F172B]">{t.name || 'Unnamed talent'}</p>
              {t.email && <p className="truncate text-[11px] text-[#90A1B9]">{t.email}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {t.tier && (
                <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-medium text-[#62748E]">
                  {t.tier}
                </span>
              )}
              {t.country && (
                <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-medium text-[#62748E]">
                  {t.country}
                </span>
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
