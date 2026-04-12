import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { CustomProfile, Role, User } from '@squadhub/shared';

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  design: { bg: 'bg-purple-50', text: 'text-purple-700' },
  video: { bg: 'bg-pink-50', text: 'text-pink-700' },
  development: { bg: 'bg-blue-50', text: 'text-blue-700' },
  marketing: { bg: 'bg-orange-50', text: 'text-orange-700' },
  general: { bg: 'bg-gray-50', text: 'text-gray-600' },
};

export default function AdminCustomProfiles() {
  const queryClient = useQueryClient();
  const [selectedProfile, setSelectedProfile] = useState<CustomProfile | null>(null);
  const [showCreate, setShowCreate] = useState(false);

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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/custom-profiles/${id}`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-custom-profiles'] });
    },
  });

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">Custom Profiles</h1>
          <p className="mt-1 text-sm text-[#62748E]">Manage folder and list templates for different workflows</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-[#0F172B] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D293D]"
        >
          + New Profile
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateProfileForm
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['admin-custom-profiles'] });
          }}
        />
      )}

      {/* Profile list */}
      {isLoading ? (
        <p className="py-8 text-center text-sm text-[#90A1B9]">Loading...</p>
      ) : !profiles || profiles.length === 0 ? (
        <div className="rounded-lg border border-[#E2E8F0] bg-white py-12 text-center">
          <p className="text-sm text-[#90A1B9]">No custom profiles yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.map((profile) => {
            const cat = CATEGORY_COLORS[profile.category] || CATEGORY_COLORS.general;
            return (
              <div
                key={profile.id}
                className="flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-5 py-4 transition hover:shadow-sm"
              >
                <div className="flex items-center gap-4">
                  {/* Icon */}
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F1F5F9]">
                    <svg className="h-5 w-5 text-[#62748E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                      <span className="text-sm font-semibold text-[#0F172B]">{profile.name}</span>
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
                      <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-medium text-[#62748E]">
                        {profile.target_type}
                      </span>
                      <span className="text-[10px] text-[#90A1B9]">v{profile.version}</span>
                    </div>
                    {profile.description && (
                      <p className="mt-0.5 text-xs text-[#90A1B9]">{profile.description}</p>
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
                        <span className="text-[10px] text-[#90A1B9]">
                          + {(profile.user_access || []).length} direct user{(profile.user_access || []).length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {(profile.role_access || []).length === 0 && (profile.user_access || []).length === 0 && (
                        <span className="text-[10px] text-[#90A1B9]">No access assigned</span>
                      )}
                      {(profile.instance_count || 0) > 0 && (
                        <span className="text-[10px] text-[#90A1B9]">
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
                    className="flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-medium text-[#62748E] transition hover:bg-[#F8FAFC] hover:text-[#0F172B]"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                    </svg>
                    Share
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${profile.name}"? This cannot be undone.`)) {
                        deleteMutation.mutate(profile.id);
                      }
                    }}
                    className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-medium text-red-500 transition hover:bg-red-50"
                  >
                    Delete
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
// Create Profile Form
// ============================================================
function CreateProfileForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [targetType, setTargetType] = useState<'folder' | 'list'>('folder');
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post('/admin/custom-profiles', body).then((r) => r.data),
    onSuccess: onCreated,
    onError: (err: any) => {
      setError(err?.response?.data?.error || err.message);
    },
  });

  const handleNameChange = (val: string) => {
    setName(val);
    // Auto-generate slug from name
    setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  };

  return (
    <div className="mb-6 rounded-lg border border-[#E2E8F0] bg-white p-5">
      <h3 className="mb-4 text-sm font-semibold text-[#0F172B]">New Custom Profile</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-[#62748E]">Name</label>
          <input
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. Design Workflow"
            className="w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[#62748E]">Slug</label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="design-workflow"
            className="w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm font-mono focus:border-[#0F172B] focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[#62748E]">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
          >
            <option value="general">General</option>
            <option value="design">Design</option>
            <option value="video">Video</option>
            <option value="development">Development</option>
            <option value="marketing">Marketing</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[#62748E]">Type</label>
          <select
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as 'folder' | 'list')}
            className="w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
          >
            <option value="folder">Folder</option>
            <option value="list">List</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-[#62748E]">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of what this profile is for"
            className="w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
          />
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-[#E2E8F0] px-4 py-2 text-sm text-[#62748E] hover:bg-[#F8FAFC]"
        >
          Cancel
        </button>
        <button
          onClick={() => createMutation.mutate({ name, slug, description, category, target_type: targetType })}
          disabled={!name.trim() || !slug.trim() || createMutation.isPending}
          className="rounded-lg bg-[#0F172B] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D293D] disabled:opacity-50"
        >
          {createMutation.isPending ? 'Creating...' : 'Create'}
        </button>
      </div>
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
      <div className="fixed right-0 top-0 z-50 flex h-full w-[400px] flex-col bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
          <div>
            <h3 className="font-[family-name:var(--font-display)] text-base font-semibold text-[#0F172B]">
              Share {app?.name}
            </h3>
            <p className="mt-0.5 text-xs text-[#90A1B9]">Control who can use this profile</p>
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
