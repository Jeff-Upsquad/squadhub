import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';

export default function ChecksModule() {
  const [filters, setFilters] = useState({
    client_id: '',
    check_type: '',
    status: '',
    date_from: '',
    date_to: '',
    page: 1,
  });

  const queryParams = new URLSearchParams();
  if (filters.client_id) queryParams.set('client_id', filters.client_id);
  if (filters.check_type) queryParams.set('check_type', filters.check_type);
  if (filters.status) queryParams.set('status', filters.status);
  if (filters.date_from) queryParams.set('date_from', filters.date_from);
  if (filters.date_to) queryParams.set('date_to', filters.date_to);
  queryParams.set('page', String(filters.page));
  queryParams.set('limit', '25');

  const { data: checksRes, isLoading } = useQuery({
    queryKey: ['admin-cashbook-checks', filters],
    queryFn: () => api.get(`/admin/cashbook/checks?${queryParams}`).then((r) => r.data),
  });

  const { data: clientsRes } = useQuery({
    queryKey: ['admin-cashbook-clients'],
    queryFn: () => api.get('/admin/cashbook/clients').then((r) => r.data),
  });

  const checks = checksRes?.data || [];
  const total = checksRes?.total || 0;
  const clients = (clientsRes?.data || []).filter((c: any) => c.cash_book?.is_enabled);

  const statusColors: Record<string, string> = {
    received: 'bg-[#FEF9C3] text-[#A16207]',
    deposited: 'bg-[#DBEAFE] text-accent-strong',
    cleared: 'bg-[#DCFCE7] text-[#16A34A]',
    bounced: 'bg-[#FEF2F2] text-[#DC2626]',
  };

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-foreground">Check Entries</h3>
        <p className="text-sm text-foreground-muted">View check collections and deposits across all clients</p>
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
          value={filters.check_type}
          onChange={(e) => setFilters({ ...filters, check_type: e.target.value, page: 1 })}
          className="rounded-md border border-divider px-3 py-1.5 text-xs text-foreground"
        >
          <option value="">All Types</option>
          <option value="collection">Collection</option>
          <option value="deposit">Deposit</option>
        </select>
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}
          className="rounded-md border border-divider px-3 py-1.5 text-xs text-foreground"
        >
          <option value="">All Status</option>
          <option value="received">Received</option>
          <option value="deposited">Deposited</option>
          <option value="cleared">Cleared</option>
          <option value="bounced">Bounced</option>
        </select>
        <input
          type="date"
          value={filters.date_from}
          onChange={(e) => setFilters({ ...filters, date_from: e.target.value, page: 1 })}
          className="rounded-md border border-divider px-3 py-1.5 text-xs text-foreground"
        />
        <input
          type="date"
          value={filters.date_to}
          onChange={(e) => setFilters({ ...filters, date_to: e.target.value, page: 1 })}
          className="rounded-md border border-divider px-3 py-1.5 text-xs text-foreground"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-divider bg-surface">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-divider bg-surface-alt">
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Date</th>
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Client</th>
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Type</th>
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Check #</th>
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Bank</th>
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Party</th>
              <th className="px-4 py-2.5 text-right font-medium text-foreground-muted">Amount</th>
              <th className="px-4 py-2.5 text-left font-medium text-foreground-muted">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-foreground-dim">Loading...</td>
              </tr>
            ) : checks.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-foreground-dim">No check entries found</td>
              </tr>
            ) : (
              checks.map((check: any) => (
                <tr key={check.id} className="border-b border-divider hover:bg-surface-alt">
                  <td className="px-4 py-2.5 text-foreground">{check.check_date}</td>
                  <td className="px-4 py-2.5 text-foreground-muted">{check.client?.business_name || '-'}</td>
                  <td className="px-4 py-2.5 capitalize text-foreground-muted">{check.check_type}</td>
                  <td className="px-4 py-2.5 font-mono text-foreground">{check.check_number}</td>
                  <td className="px-4 py-2.5 text-foreground-muted">{check.bank_name}</td>
                  <td className="px-4 py-2.5 text-foreground-muted">{check.party_name}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-foreground">
                    {Number(check.amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusColors[check.status] || ''}`}>
                      {check.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
