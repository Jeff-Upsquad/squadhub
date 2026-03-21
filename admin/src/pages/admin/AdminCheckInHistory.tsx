import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  on_time: { label: 'On Time', className: 'bg-emerald-50 text-emerald-600' },
  late: { label: 'Late', className: 'bg-yellow-50 text-yellow-600' },
  no_checkin: { label: 'Missed', className: 'bg-red-50 text-red-600' },
};

export default function AdminCheckInHistory() {
  const [filters, setFilters] = useState({
    user_id: '',
    role_id: '',
    status: '',
    start_date: '',
    end_date: '',
    page: 1,
  });

  // Build query params
  const params = new URLSearchParams();
  params.set('page', String(filters.page));
  params.set('limit', '50');
  if (filters.user_id) params.set('user_id', filters.user_id);
  if (filters.role_id) params.set('role_id', filters.role_id);
  if (filters.status) params.set('status', filters.status);
  if (filters.start_date) params.set('start_date', filters.start_date);
  if (filters.end_date) params.set('end_date', filters.end_date);

  const { data: historyRes, isLoading } = useQuery({
    queryKey: ['admin-checkin-history', filters],
    queryFn: () => api.get(`/admin/checkin/history?${params}`).then((r) => r.data),
  });

  const { data: usersRes } = useQuery({
    queryKey: ['admin-users-list'],
    queryFn: () => api.get('/admin/users?limit=100').then((r) => r.data),
  });

  const { data: rolesRes } = useQuery({
    queryKey: ['admin-roles-list'],
    queryFn: () => api.get('/admin/roles').then((r) => r.data),
  });

  const records = historyRes?.data || [];
  const total = historyRes?.total || 0;
  const users = usersRes?.data || [];
  const roles = rolesRes?.data || [];
  const totalPages = Math.ceil(total / 50);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">Check-In History</h1>
        <p className="mt-1 text-sm text-[#62748E]">View check-in records for all users</p>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-[#E2E8F0] bg-white p-4">
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[#90A1B9]">User</label>
          <select
            value={filters.user_id}
            onChange={(e) => setFilters((p) => ({ ...p, user_id: e.target.value, page: 1 }))}
            className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-sm"
          >
            <option value="">All Users</option>
            {users.map((u: any) => (
              <option key={u.id} value={u.id}>{u.display_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[#90A1B9]">Role</label>
          <select
            value={filters.role_id}
            onChange={(e) => setFilters((p) => ({ ...p, role_id: e.target.value, page: 1 }))}
            className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-sm"
          >
            <option value="">All Roles</option>
            {roles.map((r: any) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[#90A1B9]">Status</label>
          <select
            value={filters.status}
            onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value, page: 1 }))}
            className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-sm"
          >
            <option value="">All Statuses</option>
            <option value="on_time">On Time</option>
            <option value="late">Late</option>
            <option value="no_checkin">Missed</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[#90A1B9]">Start Date</label>
          <input
            type="date"
            value={filters.start_date}
            onChange={(e) => setFilters((p) => ({ ...p, start_date: e.target.value, page: 1 }))}
            className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[#90A1B9]">End Date</label>
          <input
            type="date"
            value={filters.end_date}
            onChange={(e) => setFilters((p) => ({ ...p, end_date: e.target.value, page: 1 }))}
            className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-sm"
          />
        </div>
        <button
          onClick={() => setFilters({ user_id: '', role_id: '', status: '', start_date: '', end_date: '', page: 1 })}
          className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs text-[#62748E] hover:bg-[#F8FAFC]"
        >
          Clear
        </button>
      </div>

      {/* Results */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-[#90A1B9]">Loading...</div>
        ) : records.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#90A1B9]">No check-in records found</div>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E2E8F0] text-left">
                  <th className="px-5 py-3 text-xs font-medium text-[#62748E]">User</th>
                  <th className="px-5 py-3 text-xs font-medium text-[#62748E]">Date</th>
                  <th className="px-5 py-3 text-xs font-medium text-[#62748E]">Status</th>
                  <th className="px-5 py-3 text-xs font-medium text-[#62748E]">Submitted At</th>
                  <th className="px-5 py-3 text-xs font-medium text-[#62748E]">Items</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r: any) => {
                  const badge = STATUS_BADGES[r.status] || { label: r.status, className: 'bg-gray-100 text-gray-600' };
                  return (
                    <tr key={r.id} className="border-b border-[#E2E8F0] last:border-0">
                      <td className="px-5 py-3">
                        <div>
                          <p className="text-sm font-medium text-[#0F172B]">{r.users?.display_name || 'Unknown'}</p>
                          <p className="text-xs text-[#90A1B9]">{r.users?.email}</p>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm text-[#62748E]">{r.date}</td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-[#62748E]">
                        {r.submitted_at
                          ? new Date(r.submitted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })
                          : '-'}
                      </td>
                      <td className="px-5 py-3 text-sm text-[#90A1B9]">
                        {Array.isArray(r.completed_items) ? r.completed_items.length : 0} items
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-[#E2E8F0] px-5 py-3">
                <p className="text-xs text-[#90A1B9]">{total} records total</p>
                <div className="flex gap-1">
                  <button
                    onClick={() => setFilters((p) => ({ ...p, page: Math.max(1, p.page - 1) }))}
                    disabled={filters.page === 1}
                    className="rounded border border-[#E2E8F0] px-2 py-1 text-xs disabled:opacity-30"
                  >
                    Prev
                  </button>
                  <span className="px-2 py-1 text-xs text-[#62748E]">{filters.page} / {totalPages}</span>
                  <button
                    onClick={() => setFilters((p) => ({ ...p, page: Math.min(totalPages, p.page + 1) }))}
                    disabled={filters.page >= totalPages}
                    className="rounded border border-[#E2E8F0] px-2 py-1 text-xs disabled:opacity-30"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
