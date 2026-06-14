import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { CustomProfile, Role, User } from '@squadhub/shared';

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  design: { bg: 'bg-purple-50', text: 'text-purple-700' },
  video: { bg: 'bg-pink-50', text: 'text-pink-700' },
  development: { bg: 'bg-blue-50', text: 'text-blue-700' },
  marketing: { bg: 'bg-orange-50', text: 'text-orange-700' },
  general: { bg: 'bg-surface-alt', text: 'text-foreground-muted' },
};

export default function AdminCustomProfiles() {
  const queryClient = useQueryClient();
  const [selectedProfile, setSelectedProfile] = useState<CustomProfile | null>(null);

  const { data: profiles, isLoading } = useQuery<CustomProfile[]>({
    queryKey: ['admin-custom-profiles'],
    queryFn: async () => {
      const res = await api.get('/admin/custom-profiles');
      return res.data.data;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_enabled }: { id: string; is_enabled: boolean }) =>
      api.put(`/admin/custom-profiles/${id}`, { is_enabled }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-custom-profiles'] });
    },
  });

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Custom Lists</h1>
        <p className="mt-1 text-sm text-foreground-muted">Enable or disable predefined folder and list templates, and control who can access them</p>
      </div>

      {/* Profile list */}
      {isLoading ? (
        <p className="py-8 text-center text-sm text-foreground-dim">Loading...</p>
      ) : !profiles || profiles.length === 0 ? (
        <div className="rounded-lg border border-divider bg-surface py-12 text-center">
          <p className="text-sm text-foreground-dim">No custom list types found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.map((profile) => {
            const cat = CATEGORY_COLORS[profile.category] || CATEGORY_COLORS.general;
            return (
              <div
                key={profile.id}
                className="flex items-center justify-between rounded-lg border border-divider bg-surface px-5 py-4 transition hover:shadow-sm"
              >
                <div className="flex items-center gap-4">
                  {/* Icon */}
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-canvas">
                    <svg className="h-5 w-5 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {profile.target_type === 'folder' ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                      )}
                    </svg>
                  </div>
                  {/* Info */}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{profile.name}</span>
                      <button
                        onClick={() => toggleMutation.mutate({ id: profile.id, is_enabled: !profile.is_enabled })}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                          profile.is_enabled
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'bg-red-50 text-red-600 hover:bg-red-100'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${profile.is_enabled ? 'bg-emerald-500' : 'bg-red-400'}`} />
                        {profile.is_enabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cat.bg} ${cat.text}`}>
                        {profile.category}
                      </span>
                      <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-foreground-muted">
                        {profile.target_type}
                      </span>
                      <span className="text-[10px] text-foreground-dim">v{profile.version}</span>
                    </div>
                    {profile.description && (
                      <p className="mt-0.5 text-xs text-foreground-dim">{profile.description}</p>
                    )}
                    {/* Access + instance summary */}
                    <div className="mt-1.5 flex items-center gap-3">
                      {(profile.role_access || []).length > 0 && (
                        <div className="flex items-center gap-1">
                          {(profile.role_access || []).map((ra) => (
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
                      {(profile.user_access || []).length > 0 && (
                        <span className="text-[10px] text-foreground-dim">
                          + {(profile.user_access || []).length} direct user{(profile.user_access || []).length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {(profile.role_access || []).length === 0 && (profile.user_access || []).length === 0 && (
                        <span className="text-[10px] text-foreground-dim">No access assigned</span>
                      )}
                      {(profile.instance_count || 0) > 0 && (
                        <span className="text-[10px] text-foreground-dim">
                          {profile.instance_count} instance{profile.instance_count !== 1 ? 's' : ''}
                          {(profile.outdated_instance_count || 0) > 0 && (
                            <span className="ml-1 text-amber-600">({profile.outdated_instance_count} outdated)</span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedProfile(profile)}
                    className="flex items-center gap-1.5 rounded-lg border border-divider px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:bg-surface-alt hover:text-foreground"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                    </svg>
                    Share
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sharing slider */}
      {selectedProfile && (
        <SharingSlider
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// Sharing Slider Panel (reuses mini-app pattern)
// ============================================================
function SharingSlider({ profile, onClose }: { profile: CustomProfile; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'roles' | 'users'>('roles');
  const [userSearch, setUserSearch] = useState('');
  const [showRoleAdd, setShowRoleAdd] = useState(false);
  const [showUserAdd, setShowUserAdd] = useState(false);

  const { data: app } = useQuery<CustomProfile>({
    queryKey: ['admin-custom-profile', profile.id],
    queryFn: async () => {
      const res = await api.get(`/admin/custom-profiles/${profile.id}`);
      return res.data.data;
    },
    initialData: profile,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-custom-profile', profile.id] });
    queryClient.invalidateQueries({ queryKey: ['admin-custom-profiles'] });
  };

  const { data: allRoles } = useQuery<Role[]>({
    queryKey: ['all-roles'],
    queryFn: async () => {
      const res = await api.get('/admin/roles');
      return res.data.data;
    },
  });

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ['all-users-for-access'],
    queryFn: async () => {
      const res = await api.get('/admin/users');
      return res.data.data;
    },
    enabled: showUserAdd,
  });

  const addRole = useMutation({
    mutationFn: (role_id: string) =>
      api.post(`/admin/custom-profiles/${profile.id}/roles`, { role_id }),
    onSuccess: () => { invalidate(); setShowRoleAdd(false); },
  });

  const removeRole = useMutation({
    mutationFn: (roleId: string) =>
      api.delete(`/admin/custom-profiles/${profile.id}/roles/${roleId}`),
    onSuccess: invalidate,
  });

  const addUser = useMutation({
    mutationFn: (user_id: string) =>
      api.post(`/admin/custom-profiles/${profile.id}/users`, { user_id }),
    onSuccess: invalidate,
  });

  const removeUser = useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/admin/custom-profiles/${profile.id}/users/${userId}`),
    onSuccess: invalidate,
  });

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
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[400px] flex-col bg-surface shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <div>
            <h3 className="font-[family-name:var(--font-display)] text-base font-semibold text-foreground">
              Share {app?.name}
            </h3>
            <p className="mt-0.5 text-xs text-foreground-dim">Control who can use this template</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-foreground-dim transition hover:bg-canvas hover:text-foreground"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-divider">
          {(['roles', 'users'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-center text-xs font-medium transition border-b-2 ${
                tab === t
                  ? 'border-ink text-foreground'
                  : 'border-transparent text-foreground-muted hover:text-foreground'
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
              {!showRoleAdd ? (
                <button
                  onClick={() => setShowRoleAdd(true)}
                  className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-divider-strong py-2 text-xs font-medium text-foreground-muted transition hover:border-ink hover:text-foreground"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Role
                </button>
              ) : (
                <div className="mb-3 rounded-lg border border-divider bg-surface-alt p-3">
                  <p className="mb-2 text-xs font-medium text-foreground-muted">Select a role:</p>
                  {availableRoles.length === 0 ? (
                    <p className="text-xs text-foreground-dim">All roles already have access.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {availableRoles.map((role) => (
                        <button
                          key={role.id}
                          onClick={() => addRole.mutate(role.id)}
                          disabled={addRole.isPending}
                          className="rounded-full border border-divider bg-surface px-3 py-1 text-xs font-medium text-foreground-muted transition hover:bg-canvas hover:text-foreground disabled:opacity-50"
                        >
                          <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: role.color || '#90A1B9' }} />
                          {role.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => setShowRoleAdd(false)} className="mt-2 text-[10px] text-foreground-dim hover:text-foreground">
                    Cancel
                  </button>
                </div>
              )}

              {(app?.role_access || []).length === 0 ? (
                <p className="py-6 text-center text-xs text-foreground-dim">No roles assigned yet</p>
              ) : (
                <div className="space-y-1.5">
                  {(app?.role_access || []).map((ra) => (
                    <div key={ra.id} className="flex items-center justify-between rounded-lg border border-divider px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: ra.role?.color || '#90A1B9' }} />
                        <span className="text-sm font-medium text-foreground">{ra.role?.name || 'Unknown'}</span>
                      </div>
                      <button
                        onClick={() => removeRole.mutate(ra.role_id)}
                        disabled={removeRole.isPending}
                        className="rounded p-1 text-foreground-dim transition hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
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
              {!showUserAdd ? (
                <button
                  onClick={() => setShowUserAdd(true)}
                  className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-divider-strong py-2 text-xs font-medium text-foreground-muted transition hover:border-ink hover:text-foreground"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add User
                </button>
              ) : (
                <div className="mb-3 rounded-lg border border-divider bg-surface-alt p-3">
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search by name or email..."
                    className="mb-2 w-full rounded-md border border-divider bg-surface px-3 py-1.5 text-xs focus:border-ink focus:outline-none"
                  />
                  <div className="max-h-36 space-y-1 overflow-y-auto">
                    {filteredUsers.length === 0 ? (
                      <p className="py-2 text-xs text-foreground-dim">No users found</p>
                    ) : (
                      filteredUsers.slice(0, 15).map((user) => (
                        <button
                          key={user.id}
                          onClick={() => addUser.mutate(user.id)}
                          disabled={addUser.isPending}
                          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition hover:bg-surface disabled:opacity-50"
                        >
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-well text-[10px] font-medium text-foreground-muted">
                            {user.display_name?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <div className="text-xs font-medium text-foreground">{user.display_name}</div>
                            <div className="text-[10px] text-foreground-dim">{user.email}</div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                  <button onClick={() => { setShowUserAdd(false); setUserSearch(''); }} className="mt-2 text-[10px] text-foreground-dim hover:text-foreground">
                    Cancel
                  </button>
                </div>
              )}

              {(app?.user_access || []).length === 0 ? (
                <p className="py-6 text-center text-xs text-foreground-dim">No direct user access yet</p>
              ) : (
                <div className="space-y-1.5">
                  {(app?.user_access || []).map((ua) => (
                    <div key={ua.id} className="flex items-center justify-between rounded-lg border border-divider px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-well text-[10px] font-medium text-foreground-muted">
                          {ua.user?.display_name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-foreground">{ua.user?.display_name || 'Unknown'}</div>
                          <div className="text-[10px] text-foreground-dim">{ua.user?.email || ''}</div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeUser.mutate(ua.user_id)}
                        disabled={removeUser.isPending}
                        className="rounded p-1 text-foreground-dim transition hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
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
