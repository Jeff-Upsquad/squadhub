import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';

type Tab = 'entries' | 'checks' | 'team';

export default function ClientCashBook() {
  const [activeTab, setActiveTab] = useState<Tab>('entries');
  const [filterType, setFilterType] = useState('all');

  // Fetch profile to get role and client info
  const { data: profileRes, isLoading: profileLoading } = useQuery({
    queryKey: ['cashbook-profile'],
    queryFn: () => api.get('/cashbook/profile').then((r) => r.data),
  });

  const profile = profileRes?.data;
  const isAdmin = profile?.role === 'client_admin';
  const clientName = profile?.client?.business_name || '';

  // Dashboard stats
  const { data: dashRes } = useQuery({
    queryKey: ['cashbook-dashboard'],
    queryFn: () => api.get('/cashbook/dashboard').then((r) => r.data),
    enabled: !!profile,
  });
  const dash = dashRes?.data;

  // My entries (own_only for admin, staff already filtered server-side)
  const myEntriesParams = new URLSearchParams({ limit: '200' });
  if (isAdmin) myEntriesParams.set('own_only', 'true');
  if (filterType !== 'all' && activeTab === 'entries') myEntriesParams.set('type', filterType);

  const { data: entriesRes, isLoading: entriesLoading } = useQuery({
    queryKey: ['cashbook-my-entries', filterType],
    queryFn: () => api.get(`/cashbook/entries?${myEntriesParams}`).then((r) => r.data),
    enabled: !!profile && activeTab === 'entries',
  });

  // My checks
  const myChecksParams = new URLSearchParams({ limit: '200' });
  if (isAdmin) myChecksParams.set('own_only', 'true');

  const { data: checksRes, isLoading: checksLoading } = useQuery({
    queryKey: ['cashbook-my-checks'],
    queryFn: () => api.get(`/cashbook/checks?${myChecksParams}`).then((r) => r.data),
    enabled: !!profile && activeTab === 'checks',
  });

  // Team data (all entries, admin only)
  const teamParams = new URLSearchParams({ limit: '200' });
  if (filterType !== 'all' && activeTab === 'team') teamParams.set('type', filterType);

  const { data: teamRes, isLoading: teamLoading } = useQuery({
    queryKey: ['cashbook-team-entries', filterType],
    queryFn: () => api.get(`/cashbook/entries?${teamParams}`).then((r) => r.data),
    enabled: !!profile && isAdmin && activeTab === 'team',
  });

  const entries = entriesRes?.data || [];
  const checks = checksRes?.data || [];
  const teamEntries = teamRes?.data || [];

  const formatCurrency = (n: number) => Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });

  if (profileLoading) {
    return <div className="flex flex-1 items-center justify-center text-sm text-foreground-muted">Loading...</div>;
  }

  if (!profile) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <div className="rounded-lg border border-divider bg-surface-alt p-8 text-center">
          <svg className="mx-auto h-12 w-12 text-foreground-dim" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
          </svg>
          <p className="mt-3 text-sm text-foreground-muted">Cash Book access not granted. Contact your administrator.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
            <svg className="h-5 w-5 text-blue-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
          </div>
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Cash Book</h1>
            <p className="text-sm text-foreground-muted">{clientName}</p>
          </div>
          <span className="ml-auto rounded-full bg-blue-500/10 px-3 py-1 text-[11px] font-semibold text-blue-400 capitalize">
            {isAdmin ? 'Admin' : 'Staff'}
          </span>
        </div>

        {/* Today's summary */}
        {dash && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-divider bg-surface-alt p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Opening</p>
              <p className="mt-1 text-lg font-bold text-foreground">{formatCurrency(dash.opening_balance)}</p>
            </div>
            <div className="rounded-lg border border-divider bg-surface-alt p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Cash In</p>
              <p className="mt-1 text-lg font-bold text-green-400">{formatCurrency(dash.total_cash_in)}</p>
            </div>
            <div className="rounded-lg border border-divider bg-surface-alt p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Cash Out</p>
              <p className="mt-1 text-lg font-bold text-red-400">{formatCurrency(dash.total_cash_out)}</p>
            </div>
            <div className="rounded-lg border border-divider bg-surface-alt p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Closing</p>
              <p className={`mt-1 text-lg font-bold ${dash.closing_balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatCurrency(dash.closing_balance)}
              </p>
            </div>
          </div>
        )}

        {/* Tab toggle */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-1 rounded-lg bg-surface-alt p-1">
            <button
              onClick={() => { setActiveTab('entries'); setFilterType('all'); }}
              className={`rounded-md px-4 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'entries' ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted'
              }`}
            >
              My Entries
            </button>
            <button
              onClick={() => { setActiveTab('checks'); setFilterType('all'); }}
              className={`rounded-md px-4 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'checks' ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted'
              }`}
            >
              My Checks
            </button>
            {isAdmin && (
              <button
                onClick={() => { setActiveTab('team'); setFilterType('all'); }}
                className={`rounded-md px-4 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'team' ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted'
                }`}
              >
                Team Data
              </button>
            )}
          </div>

          {/* Type filter for entries/team */}
          {(activeTab === 'entries' || activeTab === 'team') && (
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="rounded-md border border-divider bg-surface-alt px-3 py-1.5 text-xs text-foreground focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Types</option>
              <option value="cash_in">Cash In</option>
              <option value="cash_out">Cash Out</option>
            </select>
          )}
        </div>

        {/* My Entries tab */}
        {activeTab === 'entries' && (
          <div className="overflow-hidden rounded-lg border border-divider bg-surface-alt">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-divider bg-surface">
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Date</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Type</th>
                  <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Amount</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Party</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Mode</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Category</th>
                  <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Status</th>
                </tr>
              </thead>
              <tbody>
                {entriesLoading ? (
                  <tr><td colSpan={7} className="py-12 text-center text-foreground-dim">Loading...</td></tr>
                ) : entries.length === 0 ? (
                  <tr><td colSpan={7} className="py-12 text-center text-foreground-dim">No entries yet</td></tr>
                ) : (
                  entries.map((entry: any) => (
                    <tr key={entry.id} className="border-b border-divider hover:bg-surface">
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

        {/* My Checks tab */}
        {activeTab === 'checks' && (
          <div className="overflow-hidden rounded-lg border border-divider bg-surface-alt">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-divider bg-surface">
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
                  <tr><td colSpan={8} className="py-12 text-center text-foreground-dim">Loading...</td></tr>
                ) : checks.length === 0 ? (
                  <tr><td colSpan={8} className="py-12 text-center text-foreground-dim">No checks yet</td></tr>
                ) : (
                  checks.map((check: any) => (
                    <tr key={check.id} className="border-b border-divider hover:bg-surface">
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

        {/* Team Data tab (admin only) */}
        {activeTab === 'team' && isAdmin && (
          <div>
            <p className="mb-3 text-xs text-foreground-dim">View-only overview of all staff entries</p>
            <div className="overflow-hidden rounded-lg border border-divider bg-surface-alt">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-divider bg-surface">
                    <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Date</th>
                    <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Staff</th>
                    <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Type</th>
                    <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Amount</th>
                    <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Party</th>
                    <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Mode</th>
                    <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Category</th>
                    <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Description</th>
                    <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {teamLoading ? (
                    <tr><td colSpan={9} className="py-12 text-center text-foreground-dim">Loading...</td></tr>
                  ) : teamEntries.length === 0 ? (
                    <tr><td colSpan={9} className="py-12 text-center text-foreground-dim">No team entries yet</td></tr>
                  ) : (
                    teamEntries.map((entry: any) => (
                      <tr key={entry.id} className="border-b border-divider hover:bg-surface">
                        <td className="px-4 py-2.5 text-foreground">{entry.entry_date}</td>
                        <td className="px-4 py-2.5 text-foreground">{entry.user?.display_name || '-'}</td>
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
                        <td className="px-4 py-2.5 text-foreground-muted max-w-[200px] truncate">{entry.description || '-'}</td>
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
          </div>
        )}
      </div>
    </div>
  );
}
