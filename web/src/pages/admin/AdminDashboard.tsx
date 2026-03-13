import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';

interface Stats {
  total_users: number;
  total_workspaces: number;
  total_channels: number;
  total_messages: number;
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-gray-900 p-5">
      <p className="text-sm text-gray-400">{label}</p>
      <p className="mt-1 text-3xl font-bold text-white">{value}</p>
    </div>
  );
}

export default function AdminDashboard() {
  const { data: statsRes } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get('/admin/stats').then((r) => r.data),
  });
  const stats: Stats = statsRes?.data || { total_users: 0, total_workspaces: 0, total_channels: 0, total_messages: 0 };

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold">Dashboard</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Users" value={stats.total_users} />
        <StatCard label="Workspaces" value={stats.total_workspaces} />
        <StatCard label="Channels" value={stats.total_channels} />
        <StatCard label="Messages" value={stats.total_messages} />
      </div>
    </div>
  );
}
