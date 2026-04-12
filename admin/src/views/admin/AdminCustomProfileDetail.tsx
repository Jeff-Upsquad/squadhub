import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { CustomProfile, Role, User } from '@squadhub/shared';

interface Props {
  profileId: string;
  onBack: () => void;
}

type Tab = 'template' | 'roles' | 'users';

export default function AdminCustomProfileDetail({ profileId, onBack }: Props) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('template');

  const { data: profile, isLoading } = useQuery<CustomProfile>({
    queryKey: ['admin-custom-profile', profileId],
    queryFn: async () => {
      const res = await api.get(`/admin/custom-profiles/${profileId}`);
      return res.data.data;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-custom-profile', profileId] });
    queryClient.invalidateQueries({ queryKey: ['admin-custom-profiles'] });
  };

  if (isLoading || !profile) {
    return <p className="py-8 text-center text-sm text-[#90A1B9]">Loading...</p>;
  }

  return (
    <div>
      {/* Back button + header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="mb-3 flex items-center gap-1 text-sm text-[#62748E] hover:text-[#0F172B]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Custom Profiles
        </button>
        <div className="flex items-center gap-3">
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">{profile.name}</h1>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            profile.is_enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${profile.is_enabled ? 'bg-emerald-500' : 'bg-red-400'}`} />
            {profile.is_enabled ? 'Enabled' : 'Disabled'}
          </span>
          <span className="rounded-full bg-[#F1F5F9] px-2.5 py-1 text-xs font-medium text-[#62748E]">
            {profile.target_type}
          </span>
          <span className="text-xs text-[#90A1B9]">v{profile.version}</span>
        </div>
        {profile.description && (
          <p className="mt-1 text-sm text-[#62748E]">{profile.description}</p>
        )}
        <p className="mt-1 font-mono text-xs text-[#90A1B9]">slug: {profile.slug}</p>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-[#E2E8F0]">
        {(['template', 'roles', 'users'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition border-b-2 ${
              tab === t
                ? 'border-[#0F172B] text-[#0F172B]'
                : 'border-transparent text-[#62748E] hover:text-[#0F172B]'
            }`}
          >
            {t === 'template'
              ? 'Template'
              : t === 'roles'
                ? `Roles (${(profile.role_access || []).length})`
                : `Users (${(profile.user_access || []).length})`}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'template' ? (
        <TemplateTab profile={profile} onUpdate={invalidate} />
      ) : tab === 'roles' ? (
        <RoleAccessTab profile={profile} onUpdate={invalidate} />
      ) : (
        <UserAccessTab profile={profile} onUpdate={invalidate} />
      )}
    </div>
  );
}

// ---- Template Tab ----
function TemplateTab({ profile, onUpdate }: { profile: CustomProfile; onUpdate: () => void }) {
  const [name, setName] = useState(profile.name);
  const [description, setDescription] = useState(profile.description);
  const [category, setCategory] = useState(profile.category);
  const [icon, setIcon] = useState(profile.icon);
  const [templateJson, setTemplateJson] = useState(JSON.stringify(profile.template, null, 2));
  const [jsonError, setJsonError] = useState('');
  const [saved, setSaved] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (body: any) =>
      api.put(`/admin/custom-profiles/${profile.id}`, body).then((r) => r.data),
    onSuccess: () => {
      onUpdate();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const propagateMutation = useMutation({
    mutationFn: () =>
      api.post(`/admin/custom-profiles/${profile.id}/propagate`).then((r) => r.data),
    onSuccess: (data) => {
      onUpdate();
      alert(`Propagated to ${data.data.updated_count} instance(s).`);
    },
  });

  const handleSave = () => {
    setJsonError('');
    let parsedTemplate;
    try {
      parsedTemplate = JSON.parse(templateJson);
    } catch {
      setJsonError('Invalid JSON');
      return;
    }

    const updates: Record<string, unknown> = {};
    if (name !== profile.name) updates.name = name;
    if (description !== profile.description) updates.description = description;
    if (category !== profile.category) updates.category = category;
    if (icon !== profile.icon) updates.icon = icon;

    const templateChanged = JSON.stringify(parsedTemplate) !== JSON.stringify(profile.template);
    if (templateChanged) updates.template = parsedTemplate;

    if (Object.keys(updates).length === 0) return;
    updateMutation.mutate(updates);
  };

  return (
    <div>
      {/* Propagation banner */}
      {(profile.outdated_instance_count || 0) > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-amber-800">
              {profile.outdated_instance_count} instance{profile.outdated_instance_count !== 1 ? 's are' : ' is'} outdated
            </p>
            <p className="text-xs text-amber-600">
              These {profile.target_type === 'folder' ? 'folders' : 'lists'} were created from an older version of this template.
            </p>
          </div>
          <button
            onClick={() => propagateMutation.mutate()}
            disabled={propagateMutation.isPending}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {propagateMutation.isPending ? 'Propagating...' : 'Propagate Changes'}
          </button>
        </div>
      )}

      {/* Metadata fields */}
      <div className="rounded-lg border border-[#E2E8F0] bg-white p-5">
        <h3 className="mb-4 text-sm font-semibold text-[#0F172B]">Profile Details</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Icon</label>
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              className="w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
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
            <label className="mb-1 block text-xs font-medium text-[#62748E]">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
            />
          </div>
        </div>

        {/* Template JSON editor */}
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-[#62748E]">
            Template (JSON)
            {profile.target_type === 'folder'
              ? ' — define child lists to auto-create'
              : ' — define default view and settings'}
          </label>
          <textarea
            value={templateJson}
            onChange={(e) => { setTemplateJson(e.target.value); setJsonError(''); }}
            rows={8}
            className="w-full rounded-md border border-[#E2E8F0] px-3 py-2 font-mono text-xs focus:border-[#0F172B] focus:outline-none"
          />
          {jsonError && <p className="mt-1 text-xs text-red-600">{jsonError}</p>}
        </div>

        <div className="mt-4 flex items-center justify-end gap-3">
          {saved && <span className="text-xs text-emerald-600">Saved!</span>}
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="rounded-lg bg-[#0F172B] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D293D] disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Instance info */}
      {(profile.instance_count || 0) > 0 && (
        <div className="mt-4 rounded-lg border border-[#E2E8F0] bg-white p-4">
          <p className="text-sm text-[#62748E]">
            This profile has been used to create <span className="font-medium text-[#0F172B]">{profile.instance_count}</span> {profile.target_type === 'folder' ? 'folder' : 'list'}{profile.instance_count !== 1 ? 's' : ''} across the workspace.
          </p>
        </div>
      )}
    </div>
  );
}

// ---- Role Access Tab ----
function RoleAccessTab({ profile, onUpdate }: { profile: CustomProfile; onUpdate: () => void }) {
  const [showAdd, setShowAdd] = useState(false);

  const { data: allRoles } = useQuery<Role[]>({
    queryKey: ['all-roles'],
    queryFn: async () => {
      const res = await api.get('/admin/roles');
      return res.data.data;
    },
  });

  const addMutation = useMutation({
    mutationFn: (role_id: string) =>
      api.post(`/admin/custom-profiles/${profile.id}/roles`, { role_id }).then((r) => r.data),
    onSuccess: () => { onUpdate(); setShowAdd(false); },
  });

  const removeMutation = useMutation({
    mutationFn: (roleId: string) =>
      api.delete(`/admin/custom-profiles/${profile.id}/roles/${roleId}`).then((r) => r.data),
    onSuccess: () => onUpdate(),
  });

  const assignedRoleIds = new Set((profile.role_access || []).map((ra) => ra.role_id));
  const availableRoles = (allRoles || []).filter((r) => !assignedRoleIds.has(r.id));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#62748E]">
          Users with these roles will see this profile when creating {profile.target_type === 'folder' ? 'folders' : 'lists'}.
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-lg bg-[#0F172B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1D293D]"
        >
          + Add Role
        </button>
      </div>

      {showAdd && (
        <div className="mb-4 rounded-lg border border-[#E2E8F0] bg-white p-4">
          {availableRoles.length === 0 ? (
            <p className="text-sm text-[#90A1B9]">All roles already have access.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#62748E]">Select a role to grant access:</p>
              <div className="flex flex-wrap gap-2">
                {availableRoles.map((role) => (
                  <button
                    key={role.id}
                    onClick={() => addMutation.mutate(role.id)}
                    disabled={addMutation.isPending}
                    className="rounded-full border border-[#E2E8F0] px-3 py-1 text-xs font-medium text-[#62748E] hover:bg-[#F8FAFC] hover:text-[#0F172B] disabled:opacity-50"
                    style={{ borderColor: role.color || '#E2E8F0' }}
                  >
                    {role.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button onClick={() => setShowAdd(false)} className="mt-3 text-xs text-[#90A1B9] hover:text-[#0F172B]">
            Cancel
          </button>
        </div>
      )}

      {(profile.role_access || []).length === 0 ? (
        <div className="rounded-lg border border-[#E2E8F0] bg-white py-8 text-center">
          <p className="text-sm text-[#90A1B9]">No roles assigned. Click "Add Role" to grant access.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(profile.role_access || []).map((ra) => (
            <div
              key={ra.id}
              className="flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: ra.role?.color || '#90A1B9' }} />
                <span className="text-sm font-medium text-[#0F172B]">{ra.role?.name || 'Unknown Role'}</span>
              </div>
              <button
                onClick={() => removeMutation.mutate(ra.role_id)}
                disabled={removeMutation.isPending}
                className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- User Access Tab ----
function UserAccessTab({ profile, onUpdate }: { profile: CustomProfile; onUpdate: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ['all-users-for-access'],
    queryFn: async () => {
      const res = await api.get('/admin/users');
      return res.data.data;
    },
    enabled: showAdd,
  });

  const addMutation = useMutation({
    mutationFn: (user_id: string) =>
      api.post(`/admin/custom-profiles/${profile.id}/users`, { user_id }).then((r) => r.data),
    onSuccess: () => onUpdate(),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/admin/custom-profiles/${profile.id}/users/${userId}`).then((r) => r.data),
    onSuccess: () => onUpdate(),
  });

  const assignedUserIds = new Set((profile.user_access || []).map((ua) => ua.user_id));
  const availableUsers = (allUsers || [])
    .filter((u) => !assignedUserIds.has(u.id))
    .filter((u) =>
      !search || u.display_name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
    );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#62748E]">
          Grant direct access to individual users (supplements role-based access).
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-lg bg-[#0F172B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1D293D]"
        >
          + Add User
        </button>
      </div>

      {showAdd && (
        <div className="mb-4 rounded-lg border border-[#E2E8F0] bg-white p-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users by name or email..."
            className="mb-3 w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm focus:border-[#0F172B] focus:outline-none"
          />
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {availableUsers.length === 0 ? (
              <p className="text-sm text-[#90A1B9]">No matching users found.</p>
            ) : (
              availableUsers.slice(0, 20).map((user) => (
                <button
                  key={user.id}
                  onClick={() => addMutation.mutate(user.id)}
                  disabled={addMutation.isPending}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-[#F8FAFC] disabled:opacity-50"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#E2E8F0] text-xs font-medium text-[#62748E]">
                    {user.display_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <div className="text-sm text-[#0F172B]">{user.display_name}</div>
                    <div className="text-xs text-[#90A1B9]">{user.email}</div>
                  </div>
                </button>
              ))
            )}
          </div>
          <button
            onClick={() => { setShowAdd(false); setSearch(''); }}
            className="mt-3 text-xs text-[#90A1B9] hover:text-[#0F172B]"
          >
            Close
          </button>
        </div>
      )}

      {(profile.user_access || []).length === 0 ? (
        <div className="rounded-lg border border-[#E2E8F0] bg-white py-8 text-center">
          <p className="text-sm text-[#90A1B9]">No direct user grants. Click "Add User" to grant access.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(profile.user_access || []).map((ua) => (
            <div
              key={ua.id}
              className="flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E2E8F0] text-xs font-medium text-[#62748E]">
                  {ua.user?.display_name?.[0]?.toUpperCase() || '?'}
                </div>
                <div>
                  <div className="text-sm font-medium text-[#0F172B]">{ua.user?.display_name || 'Unknown'}</div>
                  <div className="text-xs text-[#90A1B9]">{ua.user?.email || ''}</div>
                </div>
              </div>
              <button
                onClick={() => removeMutation.mutate(ua.user_id)}
                disabled={removeMutation.isPending}
                className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
