'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSquadhireConfig } from '@/hooks/useSquadhireConfig';
import SaasShell, { KindBadge, SaasError, SaasNotConnected, SeatUsage, StatusBadge } from './SaasShell';
import {
  errorMessage,
  isSaasNotConnected,
  planIdOf,
  planNameOf,
  useSaasAccounts,
  useSaasPlans,
  type SaasAccount,
} from './saasApi';

const KINDS = [
  { value: '', label: 'All kinds' },
  { value: 'business', label: 'Business' },
  { value: 'talent', label: 'Talent' },
  { value: 'shared', label: 'Shared' },
];
const STATUSES = [
  { value: '', label: 'Any status' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

const SELECT = 'rounded-lg border border-divider bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none';

export function squadhireLinkFor(a: SaasAccount, adminUrl: string | null): string | null {
  if (!adminUrl) return null;
  const id = a.squadhire_talent_id || a.squadhire_business_id;
  return id ? `${adminUrl}/admin/users/${encodeURIComponent(id)}` : null;
}

export default function SaasAccountsList() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [planId, setPlanId] = useState('');
  const [page, setPage] = useState(1);
  const { adminUrl } = useSquadhireConfig();

  // Debounce the search box into the query.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isFetching, error, refetch } = useSaasAccounts({ q, kind, status, page });
  const { data: plans } = useSaasPlans();

  // The bridge list has no plan filter — narrow the current page client-side.
  const rows = useMemo(
    () => (data?.items || []).filter((a) => !planId || planIdOf(a) === planId),
    [data, planId],
  );
  const pageSize = data?.page_size || data?.items.length || 0;
  const hasNext = data?.total != null ? page * (data.page_size || pageSize || 1) < data.total : (data?.items.length || 0) >= 25;

  return (
    <SaasShell title="SaaS Accounts">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-dim" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, owner email…"
            className="w-full rounded-lg border border-divider bg-surface py-1.5 pl-9 pr-3 text-sm text-foreground placeholder:text-foreground-dim focus:outline-none"
          />
        </div>
        <select value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} className={SELECT}>
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={SELECT}>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={planId} onChange={(e) => setPlanId(e.target.value)} className={SELECT}>
          <option value="">Any plan</option>
          {(plans || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {isFetching && !isLoading && <span className="text-xs text-foreground-dim">Refreshing…</span>}
      </div>

      {error && isSaasNotConnected(error) ? (
        <SaasNotConnected />
      ) : error ? (
        <SaasError message={errorMessage(error, 'Could not load SaaS accounts')} onRetry={() => refetch()} />
      ) : isLoading ? (
        <p className="py-8 text-center text-sm text-foreground-dim">Loading...</p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-divider bg-surface py-12 text-center">
          <p className="text-sm text-foreground-dim">No accounts match these filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-divider bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left text-[11px] uppercase tracking-wide text-foreground-dim">
                <th className="px-4 py-2.5 font-medium">Account</th>
                <th className="px-4 py-2.5 font-medium">Kind</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Plan</th>
                <th className="px-4 py-2.5 font-medium">Seats</th>
                <th className="px-4 py-2.5 font-medium">SquadHire</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const shLink = squadhireLinkFor(a, adminUrl);
                return (
                  <tr
                    key={a.id}
                    onClick={() => router.push(`/admin/saas-accounts/${encodeURIComponent(a.id)}`)}
                    className="cursor-pointer border-b border-divider last:border-0 hover:bg-surface-alt"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{a.name || 'Untitled account'}</div>
                      {a.owner && (
                        <div className="text-xs text-foreground-dim">{a.owner.name || a.owner.email}{a.owner.name && a.owner.email ? ` · ${a.owner.email}` : ''}</div>
                      )}
                    </td>
                    <td className="px-4 py-3"><KindBadge kind={a.kind} /></td>
                    <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    <td className="px-4 py-3 text-foreground-muted">{planNameOf(a) || '—'}</td>
                    <td className="px-4 py-3"><SeatUsage used={a.seats_used} limit={a.seat_limit} /></td>
                    <td className="px-4 py-3">
                      {shLink ? (
                        <a
                          href={shLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs font-medium text-accent hover:underline"
                        >
                          Open ↗
                        </a>
                      ) : a.squadhire_talent_id || a.squadhire_business_id ? (
                        <span className="text-xs text-foreground-dim">Linked</span>
                      ) : (
                        <span className="text-xs text-foreground-dim">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!error && !isLoading && (page > 1 || hasNext) && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-foreground-muted">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-divider px-3 py-1 hover:bg-surface-alt disabled:opacity-40"
          >
            Previous
          </button>
          <span>Page {page}{data?.total != null ? ` · ${data.total} accounts` : ''}</span>
          <button
            disabled={!hasNext}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-divider px-3 py-1 hover:bg-surface-alt disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </SaasShell>
  );
}
