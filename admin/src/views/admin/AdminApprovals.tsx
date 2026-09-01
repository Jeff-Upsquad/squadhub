import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { User, Role, UserType, SystemRoleKey } from '@squadhub/shared';

function systemKeyForUserType(userType?: UserType | null): SystemRoleKey {
  if (userType === 'internal') return 'member';
  if (userType === 'client_staff') return 'guest';
  return 'user';
}

export default function AdminApprovals() {
  const queryClient = useQueryClient();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Record<string, string>>({});

  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-pending-users'],
    queryFn: () => api.get('/admin/pending-users').then((r) => r.data),
  });

  const { data: rolesRes } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api.get('/admin/roles').then((r) => r.data),
  });

  const roles: Role[] = rolesRes?.data || [];
  const roleForUser = (u: User): Role | undefined => {
    const key = systemKeyForUserType(u.user_type);
    return roles.find((r) => r.system_key === key) ?? roles.find((r) => r.is_default);
  };

  const approveMutation = useMutation({
    mutationFn: ({ id, role_id }: { id: string; role_id?: string }) =>
      api.put(`/admin/users/${id}/approve`, { role_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-pending-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      setActionLoading(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.put(`/admin/users/${id}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-pending-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      setActionLoading(null);
    },
  });

  const handleApprove = (id: string) => {
    setActionLoading(id + '-approve');
    approveMutation.mutate({ id, role_id: selectedRoles[id] || undefined });
  };

  const handleReject = (id: string) => {
    setActionLoading(id + '-reject');
    rejectMutation.mutate(id);
  };

  const pendingUsers: User[] = res?.data || [];

  return (
    <div>
      <h2 className="mb-6 font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">User Approvals</h2>

      {isLoading ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : pendingUsers.length === 0 ? (
        <div className="rounded-lg border border-divider bg-surface p-8 text-center">
          <svg className="mx-auto h-10 w-10 text-foreground-dim" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="mt-3 text-sm text-foreground-muted">No pending approvals</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-divider bg-surface">
          <table className="w-full">
            <thead>
              <tr className="border-b border-divider bg-canvas">
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Name</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Email</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Signed Up</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Role</th>
                <th className="px-4 py-3 text-right font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingUsers.map((user) => (
                <tr key={user.id} className="border-b border-divider last:border-b-0">
                  <td className="px-4 py-3 text-sm text-foreground">{user.display_name}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{user.email}</td>
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-xs text-foreground-muted">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={selectedRoles[user.id] || roleForUser(user)?.id || ''}
                      onChange={(e) =>
                        setSelectedRoles((prev) => ({ ...prev, [user.id]: e.target.value }))
                      }
                      className="rounded-md border border-divider-strong bg-surface px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent"
                    >
                      {roles
                        .filter((role) => user.user_type === 'internal' || (role.system_key !== 'admin' && role.system_key !== 'manager'))
                        .map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleApprove(user.id)}
                        disabled={actionLoading === user.id + '-approve'}
                        className="rounded-md bg-green-50 px-3 py-1.5 text-xs font-medium text-green-600 transition hover:bg-green-100 disabled:opacity-50"
                      >
                        {actionLoading === user.id + '-approve' ? 'Approving...' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleReject(user.id)}
                        disabled={actionLoading === user.id + '-reject'}
                        className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                      >
                        {actionLoading === user.id + '-reject' ? 'Rejecting...' : 'Reject'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
