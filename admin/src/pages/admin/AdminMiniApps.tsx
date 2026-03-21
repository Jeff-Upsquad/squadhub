import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { MiniApp, Role, User } from '@squadhub/shared';

export default function AdminMiniApps() {
  const queryClient = useQueryClient();
  const [selectedApp, setSelectedApp] = useState<MiniApp | null>(null);

  const { data: miniApps, isLoading } = useQuery<MiniApp[]>({
    queryKey: ['admin-mini-apps'],
    queryFn: async () => {
      const res = await api.get('/admin/mini-apps');
      return res.data.data;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_enabled }: { id: string; is_enabled: boolean }) =>
      api.put(`/admin/mini-apps/${id}`, { is_enabled }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-mini-apps'] });
    },
  });

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">Mini Apps</h1>
        <p className="mt-1 text-sm text-[#62748E]">Manage mini app visibility and access control</p>
      </div>

      {/* App list */}
      {isLoading ? (
        <p className="py-8 text-center text-sm text-[#90A1B9]">Loading...</p>
      ) : !miniApps || miniApps.length === 0 ? (
        <div className="rounded-lg border border-[#E2E8F0] bg-white py-12 text-center">
          <p className="text-sm text-[#90A1B9]">No mini apps available yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {miniApps.map((app) => (
            <div
              key={app.id}
              className="flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-5 py-4 transition hover:shadow-sm"
            >
              <div className="flex items-center gap-4">
                {/* Icon */}
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F1F5F9]">
                  <svg className="h-5 w-5 text-[#62748E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                {/* Info */}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#0F172B]">{app.name}</span>
                    <button
                      onClick={() => toggleMutation.mutate({ id: app.id, is_enabled: !app.is_enabled })}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                        app.is_enabled
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'bg-red-50 text-red-600 hover:bg-red-100'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${app.is_enabled ? 'bg-emerald-500' : 'bg-red-400'}`} />
                      {app.is_enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                  {app.description && (
                    <p className="mt-0.5 text-xs text-[#90A1B9]">{app.description}</p>
                  )}
                  {/* Access summary */}
                  <div className="mt-1.5 flex items-center gap-3">
                    {(app.role_access || []).length > 0 && (
                      <div className="flex items-center gap-1">
                        {(app.role_access || []).map((ra) => (
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
                        ))}
                      </div>
                    )}
                    {(app.user_access || []).length > 0 && (
                      <span className="text-[10px] text-[#90A1B9]">
                        + {(app.user_access || []).length} direct user{(app.user_access || []).length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {(app.role_access || []).length === 0 && (app.user_access || []).length === 0 && (
                      <span className="text-[10px] text-[#90A1B9]">No access assigned</span>
                    )}
                  </div>
                </div>
              </div>
              {/* Share button */}
              <button
                onClick={() => setSelectedApp(app)}
                className="flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-medium text-[#62748E] transition hover:bg-[#F8FAFC] hover:text-[#0F172B]"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                </svg>
                Share
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Sharing slider */}
      {selectedApp && (
        <SharingSlider
          miniApp={selectedApp}
          onClose={() => setSelectedApp(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// Sharing Slider Panel
// ============================================================
function SharingSlider({ miniApp, onClose }: { miniApp: MiniApp; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'roles' | 'users'>('roles');
  const [userSearch, setUserSearch] = useState('');
  const [showRoleAdd, setShowRoleAdd] = useState(false);
  const [showUserAdd, setShowUserAdd] = useState(false);

  // Fetch fresh data for this mini app
  const { data: app } = useQuery<MiniApp>({
    queryKey: ['admin-mini-app', miniApp.id],
    queryFn: async () => {
      const res = await api.get(`/admin/mini-apps/${miniApp.id}`);
      return res.data.data;
    },
    initialData: miniApp,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-mini-app', miniApp.id] });
    queryClient.invalidateQueries({ queryKey: ['admin-mini-apps'] });
  };

  // All roles
  const { data: allRoles } = useQuery<Role[]>({
    queryKey: ['all-roles'],
    queryFn: async () => {
      const res = await api.get('/admin/roles');
      return res.data.data;
    },
  });

  // All users (only load when users tab is active and adding)
  const { data: allUsers } = useQuery<User[]>({
    queryKey: ['all-users-for-access'],
    queryFn: async () => {
      const res = await api.get('/admin/users');
      return res.data.data;
    },
    enabled: showUserAdd,
  });

  // Mutations
  const addRole = useMutation({
    mutationFn: (role_id: string) =>
      api.post(`/admin/mini-apps/${miniApp.id}/roles`, { role_id }),
    onSuccess: () => { invalidate(); setShowRoleAdd(false); },
  });

  const removeRole = useMutation({
    mutationFn: (roleId: string) =>
      api.delete(`/admin/mini-apps/${miniApp.id}/roles/${roleId}`),
    onSuccess: invalidate,
  });

  const addUser = useMutation({
    mutationFn: (user_id: string) =>
      api.post(`/admin/mini-apps/${miniApp.id}/users`, { user_id }),
    onSuccess: invalidate,
  });

  const removeUser = useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/admin/mini-apps/${miniApp.id}/users/${userId}`),
    onSuccess: invalidate,
  });

  // Close on Escape
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const assignedRoleIds = new Set((app?.role_access || []).map((ra) => ra.role_id));
  const availableRoles = (allRoles || []).filter((r) => !assignedRoleIds.has(r.id));

  const assignedUserIds = new Set((app?.user_access || []).map((ua) => ua.user_id));
  const filteredUsers = (allUsers || [])
    .filter((u) => !assignedUserIds.has(u.id))
    .filter((u) =>
      !userSearch ||
      u.display_name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase())
    );

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Slider panel */}
      <div className="fixed right-0 top-0 z-50 flex h-full w-[400px] flex-col bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
          <div>
            <h3 className="font-[family-name:var(--font-display)] text-base font-semibold text-[#0F172B]">
              Share {app?.name}
            </h3>
            <p className="mt-0.5 text-xs text-[#90A1B9]">Control who can see this app</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-[#90A1B9] transition hover:bg-[#F1F5F9] hover:text-[#0F172B]"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#E2E8F0]">
          {(['roles', 'users'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-center text-xs font-medium transition border-b-2 ${
                tab === t
                  ? 'border-[#0F172B] text-[#0F172B]'
                  : 'border-transparent text-[#62748E] hover:text-[#0F172B]'
              }`}
            >
              {t === 'roles'
                ? `Roles (${(app?.role_access || []).length})`
                : `Users (${(app?.user_access || []).length})`}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'roles' ? (
            <div>
              {/* Add role button */}
              {!showRoleAdd ? (
                <button
                  onClick={() => setShowRoleAdd(true)}
                  className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#CBD5E1] py-2 text-xs font-medium text-[#62748E] transition hover:border-[#0F172B] hover:text-[#0F172B]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Role
                </button>
              ) : (
                <div className="mb-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <p className="mb-2 text-xs font-medium text-[#62748E]">Select a role:</p>
                  {availableRoles.length === 0 ? (
                    <p className="text-xs text-[#90A1B9]">All roles already have access.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {availableRoles.map((role) => (
                        <button
                          key={role.id}
                          onClick={() => addRole.mutate(role.id)}
                          disabled={addRole.isPending}
                          className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1 text-xs font-medium text-[#62748E] transition hover:bg-[#F1F5F9] hover:text-[#0F172B] disabled:opacity-50"
                        >
                          <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: role.color || '#90A1B9' }} />
                          {role.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => setShowRoleAdd(false)} className="mt-2 text-[10px] text-[#90A1B9] hover:text-[#0F172B]">
                    Cancel
                  </button>
                </div>
              )}

              {/* Current roles */}
              {(app?.role_access || []).length === 0 ? (
                <p className="py-6 text-center text-xs text-[#90A1B9]">No roles assigned yet</p>
              ) : (
                <div className="space-y-1.5">
                  {(app?.role_access || []).map((ra) => (
                    <div key={ra.id} className="flex items-center justify-between rounded-lg border border-[#E2E8F0] px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: ra.role?.color || '#90A1B9' }} />
                        <span className="text-sm font-medium text-[#0F172B]">{ra.role?.name || 'Unknown'}</span>
                      </div>
                      <button
                        onClick={() => removeRole.mutate(ra.role_id)}
                        disabled={removeRole.isPending}
                        className="rounded p-1 text-[#90A1B9] transition hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              {/* Add user */}
              {!showUserAdd ? (
                <button
                  onClick={() => setShowUserAdd(true)}
                  className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#CBD5E1] py-2 text-xs font-medium text-[#62748E] transition hover:border-[#0F172B] hover:text-[#0F172B]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add User
                </button>
              ) : (
                <div className="mb-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search by name or email..."
                    className="mb-2 w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs focus:border-[#0F172B] focus:outline-none"
                  />
                  <div className="max-h-36 space-y-1 overflow-y-auto">
                    {filteredUsers.length === 0 ? (
                      <p className="py-2 text-xs text-[#90A1B9]">No users found</p>
                    ) : (
                      filteredUsers.slice(0, 15).map((user) => (
                        <button
                          key={user.id}
                          onClick={() => addUser.mutate(user.id)}
                          disabled={addUser.isPending}
                          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition hover:bg-white disabled:opacity-50"
                        >
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#62748E]">
                            {user.display_name?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <div className="text-xs font-medium text-[#0F172B]">{user.display_name}</div>
                            <div className="text-[10px] text-[#90A1B9]">{user.email}</div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                  <button onClick={() => { setShowUserAdd(false); setUserSearch(''); }} className="mt-2 text-[10px] text-[#90A1B9] hover:text-[#0F172B]">
                    Cancel
                  </button>
                </div>
              )}

              {/* Current users */}
              {(app?.user_access || []).length === 0 ? (
                <p className="py-6 text-center text-xs text-[#90A1B9]">No direct user access yet</p>
              ) : (
                <div className="space-y-1.5">
                  {(app?.user_access || []).map((ua) => (
                    <div key={ua.id} className="flex items-center justify-between rounded-lg border border-[#E2E8F0] px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#62748E]">
                          {ua.user?.display_name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-[#0F172B]">{ua.user?.display_name || 'Unknown'}</div>
                          <div className="text-[10px] text-[#90A1B9]">{ua.user?.email || ''}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeUser.mutate(ua.user_id)}
                        disabled={removeUser.isPending}
                        className="rounded p-1 text-[#90A1B9] transition hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
