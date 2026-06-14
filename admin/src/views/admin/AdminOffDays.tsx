import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-600',
  approved: 'bg-emerald-50 text-emerald-600',
  rejected: 'bg-red-50 text-red-600',
};

const TYPE_LABELS: Record<string, string> = {
  half_day: 'Half Day',
  full_day: 'Full Day',
  long_term: 'Long Term',
};

export default function AdminOffDays() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const limit = 25;

  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-off-day-requests', statusFilter, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('limit', String(limit));
      return api.get(`/admin/off-days?${params}`).then((r) => r.data);
    },
  });

  const requests = res?.data || [];
  const total = res?.total || 0;
  const totalPages = Math.ceil(total / limit);

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.put(`/admin/off-days/${id}/approve`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-off-day-requests'] }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.put(`/admin/off-days/${id}/reject`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-off-day-requests'] }),
  });

  return (
    <div>
      <h2 className="mb-6 font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">
        Off Day Requests
      </h2>

      {/* Filter bar */}
      <div className="mb-4 flex items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-md border border-divider-strong bg-surface px-3 py-2 text-xs text-foreground outline-none focus:border-accent"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : requests.length === 0 ? (
        <div className="rounded-lg border border-divider bg-surface p-8 text-center">
          <svg className="mx-auto h-10 w-10 text-foreground-dim" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          <p className="mt-3 text-sm text-foreground-muted">No off-day requests found</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-divider bg-surface">
          <table className="w-full">
            <thead>
              <tr className="border-b border-divider bg-canvas">
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">User</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Type</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Date(s)</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Reason</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Status</th>
                <th className="px-4 py-3 text-right font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r: any) => (
                <tr key={r.id} className="border-b border-divider last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {r.user?.avatar_url ? (
                        <img src={r.user.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-canvas text-[10px] font-medium text-foreground-muted">
                          {(r.user?.display_name || '?').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-sm text-foreground">{r.user?.display_name || 'Unknown'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-foreground-muted">
                      {TYPE_LABELS[r.request_type] || r.request_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-xs text-foreground-muted">
                    {r.request_type === 'long_term'
                      ? `${r.start_date} — ${r.end_date}`
                      : r.date}
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-xs text-foreground-muted">
                    {r.reason || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[r.status] || ''}`}>
                      {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.status === 'pending' ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => approveMutation.mutate(r.id)}
                          disabled={approveMutation.isPending}
                          className="rounded-md bg-green-50 px-3 py-1.5 text-xs font-medium text-green-600 transition hover:bg-green-100 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => rejectMutation.mutate(r.id)}
                          disabled={rejectMutation.isPending}
                          className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-foreground-dim">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-foreground-dim">
            Page {page} of {totalPages} ({total} total)
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-divider px-3 py-1.5 text-xs text-foreground-muted transition hover:bg-canvas disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-divider px-3 py-1.5 text-xs text-foreground-muted transition hover:bg-canvas disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
