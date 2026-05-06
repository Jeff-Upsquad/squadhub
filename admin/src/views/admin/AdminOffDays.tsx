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
      <h2 className="mb-6 font-[family-name:var(--font-display)] text-2xl font-bold text-[#0F172B]">
        Off Day Requests
      </h2>

      {/* Filter bar */}
      <div className="mb-4 flex items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-xs text-[#0F172B] outline-none focus:border-[#2962FF]"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="text-sm text-[#62748E]">Loading...</p>
      ) : requests.length === 0 ? (
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-8 text-center">
          <svg className="mx-auto h-10 w-10 text-[#90A1B9]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          <p className="mt-3 text-sm text-[#62748E]">No off-day requests found</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F1F5F9]">
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">User</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Type</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Date(s)</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Reason</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Status</th>
                <th className="px-4 py-3 text-right font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r: any) => (
                <tr key={r.id} className="border-b border-[#E2E8F0] last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {r.user?.avatar_url ? (
                        <img src={r.user.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F1F5F9] text-[10px] font-medium text-[#62748E]">
                          {(r.user?.display_name || '?').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="text-sm text-[#0F172B]">{r.user?.display_name || 'Unknown'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-medium text-[#62748E]">
                      {TYPE_LABELS[r.request_type] || r.request_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-xs text-[#62748E]">
                    {r.request_type === 'long_term'
                      ? `${r.start_date} — ${r.end_date}`
                      : r.date}
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-xs text-[#62748E]">
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
                      <span className="text-xs text-[#90A1B9]">—</span>
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
          <p className="text-xs text-[#90A1B9]">
            Page {page} of {totalPages} ({total} total)
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-[#E2E8F0] px-3 py-1.5 text-xs text-[#62748E] transition hover:bg-[#F1F5F9] disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-[#E2E8F0] px-3 py-1.5 text-xs text-[#62748E] transition hover:bg-[#F1F5F9] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
