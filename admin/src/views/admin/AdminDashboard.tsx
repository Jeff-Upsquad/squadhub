import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';

interface Stats {
  total_users: number;
  total_workspaces: number;
  total_channels: number;
  total_messages: number;
  pending_approvals: number;
  unreviewed_assigned_cards?: number;
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-white p-5">
      <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[#62748E]">{label}</p>
      <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold text-[#0F172B]">{value}</p>
    </div>
  );
}

export default function AdminDashboard() {
  const { data: statsRes } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get('/admin/stats').then((r) => r.data),
  });
  const stats: Stats = statsRes?.data || { total_users: 0, total_workspaces: 0, total_channels: 0, total_messages: 0, pending_approvals: 0, unreviewed_assigned_cards: 0 };
  const unreviewed = stats.unreviewed_assigned_cards ?? 0;

  return (
    <div>
      <h2 className="mb-6 font-[family-name:var(--font-display)] text-2xl font-bold text-[#0F172B]">Dashboard</h2>
      {unreviewed > 0 && (
        <Link
          href="/admin/published-cards"
          className="mb-4 flex items-center justify-between rounded-lg border-2 border-emerald-200 bg-emerald-50 px-5 py-4 transition hover:bg-emerald-100"
        >
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-[family-name:var(--font-display)] text-sm font-bold text-emerald-900">
                {unreviewed} assigned card{unreviewed === 1 ? '' : 's'} to review
              </p>
              <p className="mt-0.5 text-xs text-emerald-700">
                Talents were assigned but you haven&apos;t reviewed yet.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">
            Review
            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </Link>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total Users" value={stats.total_users} />
        <StatCard label="Pending Approvals" value={stats.pending_approvals} />
        <StatCard label="Workspaces" value={stats.total_workspaces} />
        <StatCard label="Channels" value={stats.total_channels} />
        <StatCard label="Messages" value={stats.total_messages} />
      </div>
    </div>
  );
}
