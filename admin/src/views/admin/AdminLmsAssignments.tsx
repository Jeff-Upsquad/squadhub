'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import type { LmsAssignment, User } from '@squadhub/shared';

interface Props {
  itemId: string;
}

type AssignmentRow = LmsAssignment & { user?: User };

export default function AdminLmsAssignments({ itemId }: Props) {
  const { data: itemRes } = useQuery({
    queryKey: ['lms-item', itemId],
    queryFn: () => api.get(`/admin/lms/items/${itemId}`).then((r) => r.data),
  });
  const item = itemRes?.data;

  const { data: rosterRes } = useQuery({
    queryKey: ['lms-assignments', itemId],
    queryFn: () => api.get(`/admin/lms/items/${itemId}/assignments`).then((r) => r.data),
  });
  const rows: AssignmentRow[] = rosterRes?.data || [];

  const byStatus = {
    completed: rows.filter((r) => r.status === 'completed'),
    in_progress: rows.filter((r) => r.status === 'in_progress'),
    not_started: rows.filter((r) => r.status === 'not_started'),
  };

  return (
    <div>
      <div className="mb-6">
        <Link href={`/admin/learning/${itemId}`} className="inline-flex items-center gap-1 text-[12px] text-[#62748E] hover:text-[#0F172B]">← {item?.title || 'Back'}</Link>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">Roster</h1>
        <p className="mt-1 text-sm text-[#62748E]">Who's been assigned and where they are in the material.</p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label="Completed" value={byStatus.completed.length} tone="emerald" />
        <StatCard label="In progress" value={byStatus.in_progress.length} tone="sky" />
        <StatCard label="Not started" value={byStatus.not_started.length} tone="slate" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#CBD5E1] bg-white p-10 text-center text-sm text-[#90A1B9]">
          No assignments yet. Publish this item (or resync audience) to create assignments.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white">
          <table className="w-full text-sm">
            <thead className="bg-[#F8FAFC]">
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#90A1B9]">User</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#90A1B9]">Type</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#90A1B9]">Status</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#90A1B9]">Progress</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#90A1B9]">Assigned</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#90A1B9]">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-[#0F172B]">{row.user?.display_name || row.user?.email || '—'}</div>
                    <div className="text-[11px] text-[#90A1B9]">{row.user?.email}</div>
                  </td>
                  <td className="px-4 py-3 text-[#62748E]">{row.user?.user_type}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[#E2E8F0]">
                        <div className="h-full bg-emerald-500" style={{ width: `${row.progress_percent}%` }} />
                      </div>
                      <span className="text-[12px] text-[#62748E]">{row.progress_percent}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-[#62748E]">{new Date(row.assigned_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-[12px] text-[#62748E]">{row.completed_at ? new Date(row.completed_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'sky' | 'slate' }) {
  const bg = tone === 'emerald' ? 'bg-emerald-50' : tone === 'sky' ? 'bg-sky-50' : 'bg-slate-50';
  const text = tone === 'emerald' ? 'text-emerald-700' : tone === 'sky' ? 'text-sky-700' : 'text-slate-600';
  return (
    <div className={`rounded-xl border border-[#E2E8F0] ${bg} p-4`}>
      <p className={`text-[11px] font-medium uppercase tracking-wider ${text}`}>{label}</p>
      <p className="mt-1 text-2xl font-bold text-[#0F172B]">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'completed' ? 'bg-emerald-50 text-emerald-700'
    : status === 'in_progress' ? 'bg-sky-50 text-sky-700'
    : 'bg-slate-100 text-slate-700';
  const label = status === 'not_started' ? 'Not started' : status === 'in_progress' ? 'In progress' : 'Completed';
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}
