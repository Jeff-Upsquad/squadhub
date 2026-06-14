import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';

export default function EntriesModule() {
  const [filters, setFilters] = useState({
    client_id: '',
    date_from: '',
    date_to: '',
    type: '',
    is_posted: '',
    page: 1,
  });

  const queryParams = new URLSearchParams();
  if (filters.client_id) queryParams.set('client_id', filters.client_id);
  if (filters.date_from) queryParams.set('date_from', filters.date_from);
  if (filters.date_to) queryParams.set('date_to', filters.date_to);
  if (filters.type) queryParams.set('type', filters.type);
  if (filters.is_posted) queryParams.set('is_posted', filters.is_posted);
  queryParams.set('page', String(filters.page));
  queryParams.set('limit', '25');

  const { data: entriesRes, isLoading } = useQuery({
    queryKey: ['admin-cashbook-entries', filters],
    queryFn: () => api.get(`/admin/cashbook/entries?${queryParams}`).then((r) => r.data),
  });

  const { data: clientsRes } = useQuery({
    queryKey: ['admin-cashbook-clients'],
    queryFn: () => api.get('/admin/cashbook/clients').then((r) => r.data),
  });

  const entries = entriesRes?.data || [];
  const total = entriesRes?.total || 0;
  const clients = (clientsRes?.data || []).filter((c: any) => c.cash_book?.is_enabled);

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-foreground">All Entries</h3>
        <p className="text-sm text-foreground-muted">View cash in/out entries across all clients</p>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={filters.client_id}
          onChange={(e) => setFilters({ ...filters, client_id: e.target.value, page: 1 })}
          className="rounded-md border border-divider px-3 py-1.5 text-xs text-foreground"
        >
          <option value="">All Clients</option>
          {clients.map((c: any) => (
            <option key={c.id} value={c.id}>{c.business_name}</option>
          ))}
        </select>
        <select
          value={filters.type}
          onChange={(e) => setFilters({ ...filters, type: e.target.value, page: 1 })}
          className="rounded-md border border-divider px-3 py-1.5 text-xs text-foreground"
        >
          <option value="">All Types</option>
          <option value="cash_in">Cash In</option>
          <option value="cash_out">Cash Out</option>
        </select>
        <select
          value={filters.is_posted}
          onChange={(e) => setFilters({ ...filters, is_posted: e.target.value, page: 1 })}
          className="rounded-md border border-divider px-3 py-1.5 text-xs text-foreground"
        >
          <option value="">All Status</option>
          <option value="false">Unposted</option>
          <option value="true">Posted</option>
        </select>
        <input
          type="date"
          value={filters.date_from}
          onChange={(e) => setFilters({ ...filters, date_from: e.target.value, page: 1 })}
          className="rounded-md border border-divider px-3 py-1.5 text-xs text-foreground"
          placeholder="From"
        />
        <input
          type="date"
          value={filters.date_to}
          onChange={(e) => setFilters({ ...filters, date_to: e.target.value, page: 1 })}
          className="rounded-md border border-divider px-3 py-1.5 text-xs text-foreground"
          placeholder="To"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-divider bg-surface">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-divider bg-surface-alt">
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Date</th>
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Client</th>
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Staff</th>
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Type</th>
              <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Amount</th>
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Party</th>
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Mode</th>
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-foreground-dim">Loading...</td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-foreground-dim">No entries found</td>
              </tr>
            ) : (
              entries.map((entry: any) => (
                <tr key={entry.id} className="border-b border-divider hover:bg-surface-alt">
                  <td className="px-4 py-2.5 text-foreground">{entry.entry_date}</td>
                  <td className="px-4 py-2.5 text-foreground-muted">{entry.client?.business_name || '-'}</td>
                  <td className="px-4 py-2.5 text-foreground-muted">{entry.user?.display_name || '-'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      entry.entry_type === 'cash_in'
                        ? 'bg-[#DCFCE7] text-[#16A34A]'
                        : 'bg-[#FEF2F2] text-[#DC2626]'
                    }`}>
                      {entry.entry_type === 'cash_in' ? 'Cash In' : 'Cash Out'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-foreground">
                    {Number(entry.amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                  </td>
                  <td className="px-4 py-2.5 text-foreground-muted">{entry.party_name || '-'}</td>
                  <td className="px-4 py-2.5 text-foreground-muted capitalize">{entry.payment_mode?.replace('_', ' ')}</td>
                  <td className="px-4 py-2.5">
                    {entry.is_posted ? (
                      <span className="rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[10px] font-semibold text-accent">Posted</span>
                    ) : (
                      <span className="rounded-full bg-[#FEF9C3] px-2 py-0.5 text-[10px] font-semibold text-[#A16207]">Pending</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 25 && (
        <div className="mt-3 flex items-center justify-between text-xs text-foreground-muted">
          <span>Showing {(filters.page - 1) * 25 + 1}-{Math.min(filters.page * 25, total)} of {total}</span>
          <div className="flex gap-1">
            <button
              onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
              disabled={filters.page === 1}
              className="rounded-md border border-divider px-3 py-1 disabled:opacity-50"
            >
              Prev
            </button>
            <button
              onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
              disabled={filters.page * 25 >= total}
              className="rounded-md border border-divider px-3 py-1 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
