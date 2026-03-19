import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { User, Role } from '@squadhub/shared';

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
  const defaultRole = roles.find((r) => r.is_default);

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
      <h2 className="mb-6 text-2xl font-semibold text-[#ededed]">User Approvals</h2>

      {isLoading ? (
        <p className="text-sm text-[#888]">Loading...</p>
      ) : pendingUsers.length === 0 ? (
        <div className="rounded-lg border border-[#222] bg-[#111] p-8 text-center">
          <svg className="mx-auto h-10 w-10 text-[#555]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="mt-3 text-sm text-[#888]">No pending approvals</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#222]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#222] bg-[#111]">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#888]">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#888]">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#888]">Signed Up</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#888]">Role</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-[#888]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingUsers.map((user) => (
                <tr key={user.id} className="border-b border-[#222] last:border-b-0">
                  <td className="px-4 py-3 text-sm text-[#ededed]">{user.display_name}</td>
                  <td className="px-4 py-3 text-sm text-[#888]">{user.email}</td>
                  <td className="px-4 py-3 text-sm text-[#888]">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={selectedRoles[user.id] || defaultRole?.id || ''}
                      onChange={(e) =>
                        setSelectedRoles((prev) => ({ ...prev, [user.id]: e.target.value }))
                      }
                      className="rounded-md border border-[#333] bg-[#0a0a0a] px-2 py-1.5 text-xs text-[#ededed] outline-none focus:border-[#ededed]"
                    >
                      {roles.map((role) => (
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
                        className="rounded-md bg-green-500/15 px-3 py-1.5 text-xs font-medium text-green-400 transition hover:bg-green-500/25 disabled:opacity-50"
                      >
                        {actionLoading === user.id + '-approve' ? 'Approving...' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleReject(user.id)}
                        disabled={actionLoading === user.id + '-reject'}
                        className="rounded-md bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/25 disabled:opacity-50"
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
