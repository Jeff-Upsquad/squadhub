import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { User, Role } from '@squadhub/shared';

interface UserWithRole extends User {
  custom_role?: { id: string; name: string; color: string } | null;
}

function UserRow({ user, currentUserId, roles, onAction }: {
  user: UserWithRole;
  currentUserId: string;
  roles: Role[];
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

  const customRoleMutation = useMutation({
    mutationFn: (role_id: string) => api.put(`/admin/users/${user.id}/custom-role`, { role_id }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-users'] }); },
  });

  const handleDelete = () => {
    if (window.confirm(`Are you sure you want to permanently delete ${user.display_name}?`)) {
      deleteMutation.mutate();
    }
  };

  const date = new Date(user.created_at).toLocaleDateString();

  return (
    <tr className="border-t border-[#222] hover:bg-[#111]/50">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#222] text-sm font-medium text-[#ededed]">
            {user.display_name[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="text-sm font-medium text-[#ededed]">{user.display_name}</p>
            <p className="text-xs text-[#555]">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
          user.role === 'admin'
            ? 'bg-yellow-500/15 text-yellow-400'
            : user.role === 'banned'
            ? 'bg-red-500/15 text-red-400'
            : 'bg-[#222] text-[#888]'
        }`}>
          {user.role}
        </span>
      </td>
      <td className="px-4 py-3">
        {user.custom_role ? (
          <select
            value={user.custom_role.id}
            onChange={(e) => customRoleMutation.mutate(e.target.value)}
            disabled={customRoleMutation.isPending || isBanned}
            className="rounded-md border border-[#333] bg-[#0a0a0a] px-2 py-1 text-xs text-[#ededed] outline-none focus:border-[#ededed] disabled:opacity-50"
          >
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-[#555]">{user.status === 'pending' ? 'Pending' : '—'}</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-[#888]">{date}</td>
      <td className="px-4 py-3">
        {!isSelf && (
          <div className="flex gap-2">
            {!isBanned && (
              <button
                onClick={() => roleMutation.mutate(user.role === 'admin' ? 'member' : 'admin')}
                disabled={roleMutation.isPending}
                className="rounded-md border border-[#333] bg-transparent px-2.5 py-1 text-xs text-[#888] hover:border-[#555] hover:text-[#ededed] disabled:opacity-50"
              >
                {user.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
              </button>
            )}
            <button
              onClick={() => banMutation.mutate(!isBanned)}
              disabled={banMutation.isPending}
              className={`rounded-md px-2.5 py-1 text-xs disabled:opacity-50 ${
                isBanned
                  ? 'bg-green-600/15 text-green-400 hover:bg-green-600/25'
                  : 'bg-red-600/15 text-red-400 hover:bg-red-600/25'
              }`}
            >
              {isBanned ? 'Unban' : 'Ban'}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="rounded-md bg-red-600/15 px-2.5 py-1 text-xs text-red-400 hover:bg-red-600/25 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        )}
        {isSelf && <span className="text-xs text-[#555]">You</span>}
      </td>
    </tr>
  );
}

export default function AdminUsers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const authState = JSON.parse(localStorage.getItem('squadhub-admin-auth') || '{}');
  const currentUserId = authState?.state?.user?.id || '';

  const { data: usersRes, isLoading } = useQuery({
    queryKey: ['admin-users', search, page],
    queryFn: () => api.get(`/admin/users?search=${search}&page=${page}&limit=20`).then((r) => r.data),
  });

  const { data: rolesRes } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api.get('/admin/roles').then((r) => r.data),
  });

  const users: UserWithRole[] = usersRes?.data || [];
  const roles: Role[] = rolesRes?.data || [];
  const total: number = usersRes?.total || 0;
  const totalPages = Math.ceil(total / 20);

  const refreshStats = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-semibold text-[#ededed]">Users ({total})</h2>
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by name or email..."
          className="w-full rounded-md border border-[#333] bg-[#0a0a0a] px-3 py-2 text-sm text-[#ededed] placeholder-[#555] focus:border-[#ededed] focus:outline-none sm:w-72"
        />
      </div>

      <div className="rounded-lg border border-[#222] bg-[#111] p-5">
        {isLoading ? (
          <p className="py-8 text-center text-[#555]">Loading users...</p>
        ) : users.length === 0 ? (
          <p className="py-8 text-center text-[#555]">No users found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-[#555]">
                  <th className="px-4 py-2">User</th>
                  <th className="px-4 py-2">Platform</th>
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
                    roles={roles}
                    onAction={refreshStats}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="rounded-md border border-[#333] bg-transparent px-3 py-1.5 text-sm text-[#888] hover:border-[#555] hover:text-[#ededed] disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-[#888]">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-[#333] bg-transparent px-3 py-1.5 text-sm text-[#888] hover:border-[#555] hover:text-[#ededed] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
