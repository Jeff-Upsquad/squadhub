import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import SliderPanel from '../clients/SliderPanel';

interface CashBookUser {
  id: string;
  user_id: string;
  client_id: string;
  role: 'client_admin' | 'staff';
  is_active: boolean;
  created_at: string;
  user?: { id: string; display_name: string; email: string } | null;
}

interface ClientUsersSliderProps {
  clientId: string | null;
  clientName: string;
  onClose: () => void;
}

export default function ClientUsersSlider({ clientId, clientName, onClose }: ClientUsersSliderProps) {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({ display_name: '', email: '', password: '', role: 'staff' as 'client_admin' | 'staff' });
  const [formError, setFormError] = useState<string | null>(null);

  const { data: usersRes, isLoading } = useQuery({
    queryKey: ['admin-cashbook-client-users', clientId],
    queryFn: () => api.get(`/admin/cashbook/clients/${clientId}/users`).then((r) => r.data),
    enabled: !!clientId,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-cashbook-client-users', clientId] });
    queryClient.invalidateQueries({ queryKey: ['admin-cashbook-stats'] });
  };

  const createMutation = useMutation({
    mutationFn: (body: typeof formData) => api.post(`/admin/cashbook/clients/${clientId}/users`, body),
    onSuccess: () => {
      invalidateAll();
      setShowAddForm(false);
      setFormData({ display_name: '', email: '', password: '', role: 'staff' });
      setFormError(null);
    },
    onError: (err: any) => {
      setFormError(err.response?.data?.error || 'Failed to create user');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (userId: string) => api.put(`/admin/cashbook/clients/${clientId}/users/${userId}/toggle`),
    onSuccess: () => invalidateAll(),
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.put(`/admin/cashbook/clients/${clientId}/users/${userId}/role`, { role }),
    onSuccess: () => invalidateAll(),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/admin/cashbook/clients/${clientId}/users/${userId}`),
    onSuccess: () => invalidateAll(),
  });

  const users: CashBookUser[] = usersRes?.data || [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.display_name.trim() || !formData.email.trim() || !formData.password.trim()) return;
    setFormError(null);
    createMutation.mutate(formData);
  };

  return (
    <SliderPanel open={!!clientId} onClose={onClose} title={`${clientName} — Users`} width="w-[480px]">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-foreground-muted">{users.length} user{users.length !== 1 ? 's' : ''}</p>
        <button
          onClick={() => { setShowAddForm(!showAddForm); setFormError(null); }}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong transition-colors"
        >
          {showAddForm ? 'Cancel' : 'Add User'}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleSubmit} className="mb-6 rounded-lg border border-divider bg-surface-alt p-4">
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Full Name</label>
            <input
              type="text"
              value={formData.display_name}
              onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
              placeholder="John Doe"
              className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="user@example.com"
              className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Password</label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="Min 8 characters"
              className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Role</label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as 'client_admin' | 'staff' })}
              className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="staff">Staff</option>
              <option value="client_admin">Client Admin</option>
            </select>
          </div>
          {formError && (
            <p className="mb-3 text-xs text-[#DC2626]">{formError}</p>
          )}
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-strong transition-colors disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating...' : 'Create User'}
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="py-8 text-center text-sm text-foreground-muted">Loading users...</div>
      ) : users.length === 0 && !showAddForm ? (
        <div className="rounded-lg border border-dashed border-divider-strong py-8 text-center text-sm text-foreground-dim">
          No users yet. Click &quot;Add User&quot; to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between rounded-lg border border-divider bg-surface px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#EEF2FF] text-xs font-semibold text-accent">
                  {(u.user?.display_name || '?')[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{u.user?.display_name || 'Unknown'}</p>
                  <p className="text-[10px] text-foreground-dim">{u.user?.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={u.role}
                  onChange={(e) => roleMutation.mutate({ userId: u.id, role: e.target.value })}
                  disabled={roleMutation.isPending}
                  className="rounded-md border border-divider bg-surface-alt px-1.5 py-0.5 text-[11px] font-medium text-foreground-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                >
                  <option value="staff">Staff</option>
                  <option value="client_admin">Admin</option>
                </select>
                {u.is_active ? (
                  <span className="rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[10px] font-semibold text-[#16A34A]">Active</span>
                ) : (
                  <span className="rounded-full bg-[#FEF2F2] px-2 py-0.5 text-[10px] font-semibold text-[#DC2626]">Suspended</span>
                )}
                <button
                  onClick={() => toggleMutation.mutate(u.id)}
                  disabled={toggleMutation.isPending}
                  className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                    u.is_active
                      ? 'border border-[#FCA5A5] text-[#DC2626] hover:bg-[#FEF2F2]'
                      : 'border border-[#BBF7D0] text-[#16A34A] hover:bg-[#F0FDF4]'
                  }`}
                >
                  {u.is_active ? 'Suspend' : 'Activate'}
                </button>
                <button
                  onClick={() => {
                    if (confirm('Remove this user? Their entries will be preserved.')) removeMutation.mutate(u.id);
                  }}
                  disabled={removeMutation.isPending}
                  className="rounded-md p-1 text-foreground-dim hover:bg-[#FEF2F2] hover:text-[#DC2626] transition-colors"
                  title="Remove user"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SliderPanel>
  );
}
