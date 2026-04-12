import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';

interface Props {
  clientId: string;
  clientName: string;
  onBack: () => void;
}

export default function PartnerCashBookDetail({ clientId, clientName, onBack }: Props) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'entries' | 'checks'>('entries');
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [selectedChecks, setSelectedChecks] = useState<Set<string>>(new Set());
  const [filterPosted, setFilterPosted] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');

  // Stats
  const { data: statsRes } = useQuery({
    queryKey: ['partner-cashbook-stats', clientId],
    queryFn: () => api.get(`/partner/cashbook/clients/${clientId}/stats`).then((r) => r.data),
  });
  const stats = statsRes?.data || { total_cash_in: 0, total_cash_out: 0, balance: 0, unposted_entries: 0, unposted_checks: 0 };

  // Entries
  const entriesQueryParams = new URLSearchParams({ limit: '100' });
  if (filterPosted !== 'all') entriesQueryParams.set('is_posted', filterPosted === 'posted' ? 'true' : 'false');
  if (filterType !== 'all') entriesQueryParams.set('type', filterType);

  const { data: entriesRes, isLoading: entriesLoading } = useQuery({
    queryKey: ['partner-cashbook-entries', clientId, filterPosted, filterType],
    queryFn: () => api.get(`/partner/cashbook/clients/${clientId}/entries?${entriesQueryParams}`).then((r) => r.data),
    enabled: activeTab === 'entries',
  });

  // Checks
  const { data: checksRes, isLoading: checksLoading } = useQuery({
    queryKey: ['partner-cashbook-checks', clientId],
    queryFn: () => api.get(`/partner/cashbook/clients/${clientId}/checks?limit=100`).then((r) => r.data),
    enabled: activeTab === 'checks',
  });

  const entries = entriesRes?.data || [];
  const checks = checksRes?.data || [];

  // Mutations
  const postEntriesMutation = useMutation({
    mutationFn: (ids: string[]) => api.post('/partner/cashbook/entries/post', { entry_ids: ids }),
    onSuccess: () => {
      setSelectedEntries(new Set());
      queryClient.invalidateQueries({ queryKey: ['partner-cashbook-entries', clientId] });
      queryClient.invalidateQueries({ queryKey: ['partner-cashbook-stats', clientId] });
      queryClient.invalidateQueries({ queryKey: ['partner-cashbook-clients'] });
    },
  });

  const unpostEntriesMutation = useMutation({
    mutationFn: (ids: string[]) => api.post('/partner/cashbook/entries/unpost', { entry_ids: ids }),
    onSuccess: () => {
      setSelectedEntries(new Set());
      queryClient.invalidateQueries({ queryKey: ['partner-cashbook-entries', clientId] });
      queryClient.invalidateQueries({ queryKey: ['partner-cashbook-stats', clientId] });
      queryClient.invalidateQueries({ queryKey: ['partner-cashbook-clients'] });
    },
  });

  const postChecksMutation = useMutation({
    mutationFn: (ids: string[]) => api.post('/partner/cashbook/checks/post', { check_ids: ids }),
    onSuccess: () => {
      setSelectedChecks(new Set());
      queryClient.invalidateQueries({ queryKey: ['partner-cashbook-checks', clientId] });
      queryClient.invalidateQueries({ queryKey: ['partner-cashbook-stats', clientId] });
      queryClient.invalidateQueries({ queryKey: ['partner-cashbook-clients'] });
    },
  });

  const unpostChecksMutation = useMutation({
    mutationFn: (ids: string[]) => api.post('/partner/cashbook/checks/unpost', { check_ids: ids }),
    onSuccess: () => {
      setSelectedChecks(new Set());
      queryClient.invalidateQueries({ queryKey: ['partner-cashbook-checks', clientId] });
      queryClient.invalidateQueries({ queryKey: ['partner-cashbook-stats', clientId] });
      queryClient.invalidateQueries({ queryKey: ['partner-cashbook-clients'] });
    },
  });

  const toggleEntry = (id: string) => {
    const next = new Set(selectedEntries);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedEntries(next);
  };

  const toggleCheck = (id: string) => {
    const next = new Set(selectedChecks);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedChecks(next);
  };

  const selectAllEntries = () => {
    if (selectedEntries.size === entries.length) setSelectedEntries(new Set());
    else setSelectedEntries(new Set(entries.map((e: any) => e.id)));
  };

  const selectAllChecks = () => {
    if (selectedChecks.size === checks.length) setSelectedChecks(new Set());
    else setSelectedChecks(new Set(checks.map((c: any) => c.id)));
  };

  // Check if all selected entries are posted or unposted
  const selectedEntriesPosted = entries.filter((e: any) => selectedEntries.has(e.id) && e.is_posted);
  const selectedEntriesUnposted = entries.filter((e: any) => selectedEntries.has(e.id) && !e.is_posted);
  const selectedChecksPosted = checks.filter((c: any) => selectedChecks.has(c.id) && c.is_posted);
  const selectedChecksUnposted = checks.filter((c: any) => selectedChecks.has(c.id) && !c.is_posted);

  const formatCurrency = (n: number) => Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-6xl">
        {/* Breadcrumb */}
        <div className="mb-4 flex items-center gap-2 text-sm">
          <button onClick={onBack} className="text-blue-400 hover:underline">Cash Book</button>
          <span className="text-foreground-dim">/</span>
          <span className="text-foreground">{clientName}</span>
        </div>

        {/* Stats cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-divider bg-surface-alt p-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Total Cash In</p>
            <p className="mt-1 text-lg font-bold text-green-400">{formatCurrency(stats.total_cash_in)}</p>
          </div>
          <div className="rounded-lg border border-divider bg-surface-alt p-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Total Cash Out</p>
            <p className="mt-1 text-lg font-bold text-red-400">{formatCurrency(stats.total_cash_out)}</p>
          </div>
          <div className="rounded-lg border border-divider bg-surface-alt p-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Balance</p>
            <p className={`mt-1 text-lg font-bold ${stats.balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatCurrency(stats.balance)}
            </p>
          </div>
          <div className="rounded-lg border border-divider bg-surface-alt p-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Pending Review</p>
            <p className="mt-1 text-lg font-bold text-amber-400">{stats.unposted_entries + stats.unposted_checks}</p>
          </div>
        </div>

        {/* Tab toggle + actions */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-1 rounded-lg bg-surface-alt p-1">
            <button
              onClick={() => { setActiveTab('entries'); setSelectedChecks(new Set()); }}
              className={`rounded-md px-4 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'entries' ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted'
              }`}
            >
              Entries ({entries.length})
            </button>
            <button
              onClick={() => { setActiveTab('checks'); setSelectedEntries(new Set()); }}
              className={`rounded-md px-4 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'checks' ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted'
              }`}
            >
              Checks ({checks.length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'entries' && selectedEntriesUnposted.length > 0 && (
              <button
                onClick={() => postEntriesMutation.mutate(selectedEntriesUnposted.map((e: any) => e.id))}
                disabled={postEntriesMutation.isPending}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Mark {selectedEntriesUnposted.length} as Posted
              </button>
            )}
            {activeTab === 'entries' && selectedEntriesPosted.length > 0 && (
              <button
                onClick={() => unpostEntriesMutation.mutate(selectedEntriesPosted.map((e: any) => e.id))}
                disabled={unpostEntriesMutation.isPending}
                className="rounded-md border border-amber-500/30 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
              >
                Unmark {selectedEntriesPosted.length}
              </button>
            )}
            {activeTab === 'checks' && selectedChecksUnposted.length > 0 && (
              <button
                onClick={() => postChecksMutation.mutate(selectedChecksUnposted.map((c: any) => c.id))}
                disabled={postChecksMutation.isPending}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Mark {selectedChecksUnposted.length} as Posted
              </button>
            )}
            {activeTab === 'checks' && selectedChecksPosted.length > 0 && (
              <button
                onClick={() => unpostChecksMutation.mutate(selectedChecksPosted.map((c: any) => c.id))}
                disabled={unpostChecksMutation.isPending}
                className="rounded-md border border-amber-500/30 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
              >
                Unmark {selectedChecksPosted.length}
              </button>
            )}
          </div>
        </div>

        {/* Filters for entries */}
        {activeTab === 'entries' && (
          <div className="mb-3 flex gap-2">
            <select
              value={filterPosted}
              onChange={(e) => setFilterPosted(e.target.value)}
              className="rounded-md border border-divider bg-surface-alt px-3 py-1.5 text-xs text-foreground focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="unposted">Unposted</option>
              <option value="posted">Posted</option>
            </select>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="rounded-md border border-divider bg-surface-alt px-3 py-1.5 text-xs text-foreground focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Types</option>
              <option value="cash_in">Cash In</option>
              <option value="cash_out">Cash Out</option>
            </select>
          </div>
        )}

        {/* Entries table */}
        {activeTab === 'entries' && (
          <div className="overflow-hidden rounded-lg border border-divider bg-surface-alt">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-divider bg-surface">
                  <th className="px-4 py-2.5 text-left">
                    <input type="checkbox" checked={entries.length > 0 && selectedEntries.size === entries.length} onChange={selectAllEntries} className="rounded border-divider" />
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Date</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Type</th>
                  <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Amount</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Party</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Mode</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Category</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Staff</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Posted</th>
                </tr>
              </thead>
              <tbody>
                {entriesLoading ? (
                  <tr><td colSpan={9} className="py-12 text-center text-foreground-dim">Loading...</td></tr>
                ) : entries.length === 0 ? (
                  <tr><td colSpan={9} className="py-12 text-center text-foreground-dim">No entries found</td></tr>
                ) : (
                  entries.map((entry: any) => (
                    <tr key={entry.id} className={`border-b border-divider ${selectedEntries.has(entry.id) ? 'bg-blue-500/5' : 'hover:bg-surface'}`}>
                      <td className="px-4 py-2.5">
                        <input type="checkbox" checked={selectedEntries.has(entry.id)} onChange={() => toggleEntry(entry.id)} className="rounded border-divider" />
                      </td>
                      <td className="px-4 py-2.5 text-foreground">{entry.entry_date}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          entry.entry_type === 'cash_in' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                        }`}>
                          {entry.entry_type === 'cash_in' ? 'In' : 'Out'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-foreground">{formatCurrency(entry.amount)}</td>
                      <td className="px-4 py-2.5 text-foreground-muted">{entry.party_name || '-'}</td>
                      <td className="px-4 py-2.5 capitalize text-foreground-muted">{(entry.payment_mode || '').replace('_', ' ')}</td>
                      <td className="px-4 py-2.5 text-foreground-muted">{entry.category?.name || '-'}</td>
                      <td className="px-4 py-2.5 text-foreground-muted">{entry.user?.display_name || '-'}</td>
                      <td className="px-4 py-2.5">
                        {entry.is_posted ? (
                          <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold text-green-400">Posted</span>
                        ) : (
                          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">Pending</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Checks table */}
        {activeTab === 'checks' && (
          <div className="overflow-hidden rounded-lg border border-divider bg-surface-alt">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-divider bg-surface">
                  <th className="px-4 py-2.5 text-left">
                    <input type="checkbox" checked={checks.length > 0 && selectedChecks.size === checks.length} onChange={selectAllChecks} className="rounded border-divider" />
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Date</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Type</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Check #</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Bank</th>
                  <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Amount</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Party</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Status</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Posted</th>
                </tr>
              </thead>
              <tbody>
                {checksLoading ? (
                  <tr><td colSpan={9} className="py-12 text-center text-foreground-dim">Loading...</td></tr>
                ) : checks.length === 0 ? (
                  <tr><td colSpan={9} className="py-12 text-center text-foreground-dim">No checks found</td></tr>
                ) : (
                  checks.map((check: any) => (
                    <tr key={check.id} className={`border-b border-divider ${selectedChecks.has(check.id) ? 'bg-blue-500/5' : 'hover:bg-surface'}`}>
                      <td className="px-4 py-2.5">
                        <input type="checkbox" checked={selectedChecks.has(check.id)} onChange={() => toggleCheck(check.id)} className="rounded border-divider" />
                      </td>
                      <td className="px-4 py-2.5 text-foreground">{check.check_date}</td>
                      <td className="px-4 py-2.5 capitalize text-foreground-muted">{check.check_type}</td>
                      <td className="px-4 py-2.5 font-mono text-foreground">{check.check_number}</td>
                      <td className="px-4 py-2.5 text-foreground-muted">{check.bank_name}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-foreground">{formatCurrency(check.amount)}</td>
                      <td className="px-4 py-2.5 text-foreground-muted">{check.party_name}</td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                          check.status === 'cleared' ? 'bg-green-500/10 text-green-400' :
                          check.status === 'bounced' ? 'bg-red-500/10 text-red-400' :
                          check.status === 'deposited' ? 'bg-blue-500/10 text-blue-400' :
                          'bg-amber-500/10 text-amber-400'
                        }`}>
                          {check.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {check.is_posted ? (
                          <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold text-green-400">Posted</span>
                        ) : (
                          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">Pending</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
