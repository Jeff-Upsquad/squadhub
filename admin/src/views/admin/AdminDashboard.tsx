import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';

interface Stats {
  total_users: number;
  total_workspaces: number;
  total_channels: number;
  total_messages: number;
  pending_approvals: number;
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
  const stats: Stats = statsRes?.data || { total_users: 0, total_workspaces: 0, total_channels: 0, total_messages: 0, pending_approvals: 0 };

  return (
    <div>
      <h2 className="mb-6 font-[family-name:var(--font-display)] text-2xl font-bold text-[#0F172B]">Dashboard</h2>
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
