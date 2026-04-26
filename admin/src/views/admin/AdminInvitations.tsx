import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { Invitation, Role, UserType } from '@squadhub/shared';

export default function AdminInvitations() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [userType, setUserType] = useState<UserType>('internal');
  const [clientId, setClientId] = useState('');
  const [formError, setFormError] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'accepted' | 'expired'>('all');

  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-invitations', filter],
    queryFn: () =>
      api
        .get('/admin/invitations', { params: filter !== 'all' ? { status: filter } : {} })
        .then((r) => r.data),
  });

  const { data: rolesRes } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api.get('/admin/roles').then((r) => r.data),
  });

  const { data: clientsRes } = useQuery({
    queryKey: ['admin-clients-list'],
    queryFn: () => api.get('/admin/clients').then((r) => r.data),
  });

  const roles: Role[] = rolesRes?.data || [];
  const clients: { id: string; business_name: string }[] = clientsRes?.data || [];
  const invitations: Invitation[] = res?.data || [];

  const createMutation = useMutation({
    mutationFn: (body: { email: string; role_id?: string; user_type: UserType; client_id?: string }) =>
      api.post('/admin/invitations', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
      setEmail('');
      setRoleId('');
      setUserType('internal');
      setClientId('');
      setFormError('');
    },
    onError: (err: any) => {
      setFormError(err.response?.data?.error || 'Failed to send invitation');
    },
  });

  const resendMutation = useMutation({
    mutationFn: (id: string) => api.put(`/admin/invitations/${id}/resend`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/invitations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-invitations'] });
    },
  });

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    createMutation.mutate({
      email,
      role_id: roleId || undefined,
      user_type: userType,
      client_id: clientId || undefined,
    });
  };

  const isExpired = (inv: Invitation) =>
    inv.status === 'pending' && new Date(inv.expires_at) < new Date();

  const getStatusBadge = (inv: Invitation) => {
    if (inv.status === 'accepted') {
      return (
        <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-600">
          Accepted
        </span>
      );
    }
    if (inv.status === 'expired' || isExpired(inv)) {
      return (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
          Expired
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
        Pending
      </span>
    );
  };

  return (
    <div>
      <h2 className="mb-6 font-[family-name:var(--font-display)] text-2xl font-bold text-[#0F172B]">
        Invite Users
      </h2>

      {/* Invite Form */}
      <div className="mb-6 rounded-lg border border-[#E2E8F0] bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">Send Invitation</h3>
        <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1.5 block text-xs font-medium text-[#62748E]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="user@example.com"
              className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm text-[#0F172B] placeholder-[#90A1B9] outline-none transition focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
            />
          </div>
          <div className="min-w-[140px]">
            <label className="mb-1.5 block text-xs font-medium text-[#62748E]">User Type</label>
            <select
              value={userType}
              onChange={(e) => { setUserType(e.target.value as UserType); setClientId(''); }}
              className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm text-[#0F172B] outline-none focus:border-[#2962FF]"
            >
              <option value="internal">Internal</option>
              <option value="client">Client</option>
              <option value="client_staff">Client Staff</option>
              <option value="partner">Partner</option>
              <option value="partner_employee">Partner Employee</option>
            </select>
          </div>
          <div className="min-w-[160px]">
            <label className="mb-1.5 block text-xs font-medium text-[#62748E]">Role</label>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm text-[#0F172B] outline-none focus:border-[#2962FF]"
            >
              <option value="">Default Role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
          {(userType === 'client' || userType === 'client_staff' || userType === 'partner' || userType === 'partner_employee') && (
            <div className="min-w-[160px]">
              <label className="mb-1.5 block text-xs font-medium text-[#62748E]">Client</label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm text-[#0F172B] outline-none focus:border-[#2962FF]"
              >
                <option value="">None</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.business_name}</option>
                ))}
              </select>
            </div>
          )}
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-[#0F172B] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1D293D] disabled:opacity-50"
          >
            {createMutation.isPending ? 'Sending...' : 'Send Invite'}
          </button>
        </form>
        {formError && (
          <p className="mt-2 text-xs text-red-500">{formError}</p>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="mb-4 flex gap-1">
        {(['all', 'pending', 'accepted', 'expired'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              filter === tab
                ? 'bg-[#0F172B] text-white'
                : 'bg-white text-[#62748E] hover:bg-[#F1F5F9]'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Invitations Table */}
      {isLoading ? (
        <p className="text-sm text-[#62748E]">Loading...</p>
      ) : invitations.length === 0 ? (
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-8 text-center">
          <svg className="mx-auto h-10 w-10 text-[#90A1B9]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
          <p className="mt-3 text-sm text-[#62748E]">No invitations found</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F1F5F9]">
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Email</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Type</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Role</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Invited By</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Status</th>
                <th className="px-4 py-3 text-left font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Expires</th>
                <th className="px-4 py-3 text-right font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#62748E]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id} className="border-b border-[#E2E8F0] last:border-b-0">
                  <td className="px-4 py-3 text-sm text-[#0F172B]">{inv.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      inv.user_type === 'internal' ? 'bg-blue-50 text-blue-600' :
                      inv.user_type === 'client' ? 'bg-emerald-50 text-emerald-600' :
                      inv.user_type === 'client_staff' ? 'bg-teal-50 text-teal-600' :
                      inv.user_type === 'partner_employee' ? 'bg-violet-50 text-violet-600' :
                      'bg-purple-50 text-purple-600'
                    }`}>
                      {inv.user_type === 'client_staff' ? 'Client Staff' :
                        inv.user_type === 'partner_employee' ? 'Partner Employee' :
                        (inv.user_type?.charAt(0).toUpperCase() + inv.user_type?.slice(1) || 'Internal')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {inv.role ? (
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{
                          backgroundColor: inv.role.color + '15',
                          color: inv.role.color,
                        }}
                      >
                        {inv.role.name}
                      </span>
                    ) : (
                      <span className="text-xs text-[#90A1B9]">Default</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-[#62748E]">
                    {inv.invited_by_user?.display_name || '—'}
                  </td>
                  <td className="px-4 py-3">{getStatusBadge(inv)}</td>
                  <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-xs text-[#62748E]">
                    {inv.status === 'accepted'
                      ? new Date(inv.accepted_at!).toLocaleDateString()
                      : new Date(inv.expires_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {(inv.status === 'expired' || isExpired(inv)) && (
                        <button
                          onClick={() => resendMutation.mutate(inv.id)}
                          disabled={resendMutation.isPending}
                          className="rounded-md bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 transition hover:bg-blue-100 disabled:opacity-50"
                        >
                          Re-invite
                        </button>
                      )}
                      {inv.status === 'pending' && !isExpired(inv) && (
                        <button
                          onClick={() => revokeMutation.mutate(inv.id)}
                          disabled={revokeMutation.isPending}
                          className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-50"
                        >
                          Revoke
                        </button>
                      )}
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
