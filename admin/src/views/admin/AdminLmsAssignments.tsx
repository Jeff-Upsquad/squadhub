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
        <Link href={`/admin/learning/${itemId}`} className="inline-flex items-center gap-1 text-[12px] text-foreground-muted hover:text-foreground">← {item?.title || 'Back'}</Link>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Roster</h1>
        <p className="mt-1 text-sm text-foreground-muted">Who's been assigned and where they are in the material.</p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label="Completed" value={byStatus.completed.length} tone="emerald" />
        <StatCard label="In progress" value={byStatus.in_progress.length} tone="sky" />
        <StatCard label="Not started" value={byStatus.not_started.length} tone="slate" />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-divider-strong bg-surface p-10 text-center text-sm text-foreground-dim">
          No assignments yet. Publish this item (or resync audience) to create assignments.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-divider bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt">
              <tr>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-foreground-dim">User</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Type</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Status</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Progress</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Assigned</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-foreground-dim">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{row.user?.display_name || row.user?.email || '—'}</div>
                    <div className="text-[11px] text-foreground-dim">{row.user?.email}</div>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{row.user?.user_type}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-well">
                        <div className="h-full bg-emerald-500" style={{ width: `${row.progress_percent}%` }} />
                      </div>
                      <span className="text-[12px] text-foreground-muted">{row.progress_percent}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-foreground-muted">{new Date(row.assigned_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-[12px] text-foreground-muted">{row.completed_at ? new Date(row.completed_at).toLocaleDateString() : '—'}</td>
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
  const bg = tone === 'emerald' ? 'bg-emerald-50' : tone === 'sky' ? 'bg-sky-50' : 'bg-surface-alt';
  const text = tone === 'emerald' ? 'text-emerald-700' : tone === 'sky' ? 'text-sky-700' : 'text-foreground-muted';
  return (
    <div className={`rounded-xl border border-divider ${bg} p-4`}>
      <p className={`text-[11px] font-medium uppercase tracking-wider ${text}`}>{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'completed' ? 'bg-emerald-50 text-emerald-700'
    : status === 'in_progress' ? 'bg-sky-50 text-sky-700'
    : 'bg-canvas text-foreground-muted';
  const label = status === 'not_started' ? 'Not started' : status === 'in_progress' ? 'In progress' : 'Completed';
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}
