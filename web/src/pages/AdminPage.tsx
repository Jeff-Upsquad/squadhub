import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import type { User } from '@squadhub/shared';

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

function UserRow({ user, currentUserId, onAction }: {
  user: User;
  currentUserId: string;
  onAction: () => void;
}) {
  const queryClient = useQueryClient();
  const isSelf = user.id === currentUserId;
  const isBanned = user.role === 'banned';

  const roleMutation = useMutation({
    mutationFn: (role: string) => api.put(`/admin/users/${user.id}/role`, { role }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-users'] }); onAction(); },
  });

  const banMutation = useMutation({
    mutationFn: (banned: boolean) => api.put(`/admin/users/${user.id}/ban`, { banned }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-users'] }); onAction(); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/admin/users/${user.id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-users'] }); onAction(); },
  });

  const handleDelete = () => {
    if (window.confirm(`Are you sure you want to permanently delete ${user.display_name}?`)) {
      deleteMutation.mutate();
    }
  };

  const date = new Date(user.created_at).toLocaleDateString();

  return (
    <tr className="border-t border-gray-800 hover:bg-gray-900/50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">
            {user.display_name[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="text-sm font-medium text-white">{user.display_name}</p>
            <p className="text-xs text-gray-500">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
          user.role === 'admin'
            ? 'bg-yellow-500/20 text-yellow-400'
            : user.role === 'banned'
            ? 'bg-red-500/20 text-red-400'
            : 'bg-gray-700 text-gray-300'
        }`}>
          {user.role}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-gray-400">{date}</td>
      <td className="px-4 py-3">
        {!isSelf && (
          <div className="flex gap-2">
            {/* Toggle role */}
            {!isBanned && (
              <button
                onClick={() => roleMutation.mutate(user.role === 'admin' ? 'member' : 'admin')}
                disabled={roleMutation.isPending}
                className="rounded-md bg-gray-800 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
              >
                {user.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
              </button>
            )}

            {/* Ban/Unban */}
            <button
              onClick={() => banMutation.mutate(!isBanned)}
              disabled={banMutation.isPending}
              className={`rounded-md px-2.5 py-1 text-xs disabled:opacity-50 ${
                isBanned
                  ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                  : 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
              }`}
            >
              {isBanned ? 'Unban' : 'Ban'}
            </button>

            {/* Delete */}
            <button
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="rounded-md bg-red-600/20 px-2.5 py-1 text-xs text-red-400 hover:bg-red-600/30 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        )}
        {isSelf && <span className="text-xs text-gray-600">You</span>}
      </td>
    </tr>
  );
}

export default function AdminPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Get current user id from auth store
  const authState = JSON.parse(localStorage.getItem('squadhub-auth') || '{}');
  const currentUserId = authState?.state?.user?.id || '';

  // Fetch stats
  const { data: statsRes } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get('/admin/stats').then((r) => r.data),
  });
  const stats: Stats = statsRes?.data || { total_users: 0, total_workspaces: 0, total_channels: 0, total_messages: 0 };

  // Fetch users
  const { data: usersRes, isLoading } = useQuery({
    queryKey: ['admin-users', search, page],
    queryFn: () => api.get(`/admin/users?search=${search}&page=${page}&limit=20`).then((r) => r.data),
  });
  const users: User[] = usersRes?.data || [];
  const total: number = usersRes?.total || 0;
  const totalPages = Math.ceil(total / 20);

  const refreshStats = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-white">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">SquadHub Admin</h1>
          <span className="rounded-full bg-yellow-500/20 px-2.5 py-0.5 text-xs font-medium text-yellow-400">Admin Panel</span>
        </div>
        <button
          onClick={() => navigate('/')}
          className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
        >
          Back to App
        </button>
      </header>

      <main className="flex-1 p-6">
        {/* Stats */}
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Total Users" value={stats.total_users} />
          <StatCard label="Workspaces" value={stats.total_workspaces} />
          <StatCard label="Channels" value={stats.total_channels} />
          <StatCard label="Messages" value={stats.total_messages} />
        </div>

        {/* Users section */}
        <div className="rounded-xl bg-gray-900 p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">Users ({total})</h2>
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by name or email..."
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none sm:w-72"
            />
          </div>

          {isLoading ? (
            <p className="py-8 text-center text-gray-500">Loading users...</p>
          ) : users.length === 0 ? (
            <p className="py-8 text-center text-gray-500">No users found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-xs uppercase text-gray-500">
                    <th className="px-4 py-2">User</th>
                    <th className="px-4 py-2">Role</th>
                    <th className="px-4 py-2">Joined</th>
                    <th className="px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      currentUserId={currentUserId}
                      onAction={refreshStats}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-sm text-gray-400">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="rounded-md bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
