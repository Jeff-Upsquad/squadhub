import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { MiniApp } from '@squadhub/shared';
import AdminMiniAppDetail from './AdminMiniAppDetail';

export default function AdminMiniApps() {
  const queryClient = useQueryClient();
  const [selectedApp, setSelectedApp] = useState<MiniApp | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ slug: '', name: '', description: '', icon: 'puzzle' });
  const [createError, setCreateError] = useState('');

  const { data: miniApps, isLoading } = useQuery<MiniApp[]>({
    queryKey: ['admin-mini-apps'],
    queryFn: async () => {
      const res = await api.get('/admin/mini-apps');
      return res.data.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof createForm) => api.post('/admin/mini-apps', body).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-mini-apps'] });
      setShowCreate(false);
      setCreateForm({ slug: '', name: '', description: '', icon: 'puzzle' });
      setCreateError('');
    },
    onError: (err: any) => {
      setCreateError(err?.response?.data?.error || 'Failed to create mini app');
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_enabled }: { id: string; is_enabled: boolean }) =>
      api.put(`/admin/mini-apps/${id}`, { is_enabled }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-mini-apps'] });
    },
  });

  if (selectedApp) {
    return (
      <AdminMiniAppDetail
        miniAppId={selectedApp.id}
        onBack={() => setSelectedApp(null)}
      />
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">Mini Apps</h1>
          <p className="mt-1 text-sm text-[#62748E]">Manage mini app visibility and access control</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-[#0F172B] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D293D]"
        >
          + Add Mini App
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 rounded-lg border border-[#E2E8F0] bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold text-[#0F172B]">Create New Mini App</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-[#62748E]">Name</label>
              <input
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Daily Check-In"
                className="w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#62748E]">Slug</label>
              <input
                value={createForm.slug}
                onChange={(e) => setCreateForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                placeholder="daily-checkin"
                className="w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm font-mono focus:border-[#0F172B] focus:outline-none"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-[#62748E]">Description</label>
              <input
                value={createForm.description}
                onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Short description of the mini app"
                className="w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
              />
            </div>
          </div>
          {createError && <p className="mt-2 text-xs text-red-500">{createError}</p>}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => createMutation.mutate(createForm)}
              disabled={!createForm.slug || !createForm.name || createMutation.isPending}
              className="rounded-lg bg-[#0F172B] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D293D] disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => { setShowCreate(false); setCreateError(''); }}
              className="rounded-lg border border-[#E2E8F0] px-4 py-2 text-sm text-[#62748E] hover:bg-[#F8FAFC]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <p className="py-8 text-center text-sm text-[#90A1B9]">Loading...</p>
      ) : !miniApps || miniApps.length === 0 ? (
        <div className="rounded-lg border border-[#E2E8F0] bg-white py-12 text-center">
          <p className="text-sm text-[#90A1B9]">No mini apps registered yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#62748E]">Mini App</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#62748E]">Status</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#62748E]">Roles</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#62748E]">Users</th>
                <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wider text-[#62748E]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {miniApps.map((app) => (
                <tr key={app.id} className="hover:bg-[#F8FAFC] transition">
                  <td className="px-5 py-3">
                    <button
                      onClick={() => setSelectedApp(app)}
                      className="text-left"
                    >
                      <div className="text-sm font-medium text-[#0F172B] hover:underline">{app.name}</div>
                      <div className="text-xs text-[#90A1B9] font-mono">{app.slug}</div>
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => toggleMutation.mutate({ id: app.id, is_enabled: !app.is_enabled })}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                        app.is_enabled
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'bg-red-50 text-red-600 hover:bg-red-100'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${app.is_enabled ? 'bg-emerald-500' : 'bg-red-400'}`} />
                      {app.is_enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(app.role_access || []).length === 0 ? (
                        <span className="text-xs text-[#90A1B9]">None</span>
                      ) : (
                        (app.role_access || []).map((ra) => (
                          <span
                            key={ra.id}
                            className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: ra.role?.color ? `${ra.role.color}15` : '#F1F5F9',
                              color: ra.role?.color || '#62748E',
                            }}
                          >
                            {ra.role?.name || 'Unknown'}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs text-[#62748E]">
                      {(app.user_access || []).length} direct
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => setSelectedApp(app)}
                      className="text-xs text-[#62748E] hover:text-[#0F172B]"
                    >
                      Manage Access
                    </button>
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
