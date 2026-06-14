import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { MiniApp, Role, User } from '@squadhub/shared';

interface Props {
  miniAppId: string;
  onBack: () => void;
}

type Tab = 'roles' | 'users';

export default function AdminMiniAppDetail({ miniAppId, onBack }: Props) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('roles');

  const { data: app, isLoading } = useQuery<MiniApp>({
    queryKey: ['admin-mini-app', miniAppId],
    queryFn: async () => {
      const res = await api.get(`/admin/mini-apps/${miniAppId}`);
      return res.data.data;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-mini-app', miniAppId] });
    queryClient.invalidateQueries({ queryKey: ['admin-mini-apps'] });
  };

  if (isLoading || !app) {
    return <p className="py-8 text-center text-sm text-foreground-dim">Loading...</p>;
  }

  return (
    <div>
      {/* Back button + header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="mb-3 flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Mini Apps
        </button>
        <div className="flex items-center gap-3">
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">{app.name}</h1>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
            app.is_enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${app.is_enabled ? 'bg-emerald-500' : 'bg-red-400'}`} />
            {app.is_enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        {app.description && (
          <p className="mt-1 text-sm text-foreground-muted">{app.description}</p>
        )}
        <p className="mt-1 font-mono text-xs text-foreground-dim">slug: {app.slug}</p>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-divider">
        {(['roles', 'users'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition border-b-2 ${
              tab === t
                ? 'border-ink text-foreground'
                : 'border-transparent text-foreground-muted hover:text-foreground'
            }`}
          >
            {t === 'roles' ? `Roles (${(app.role_access || []).length})` : `Users (${(app.user_access || []).length})`}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'roles' ? (
        <RoleAccessTab app={app} onUpdate={invalidate} />
      ) : (
        <UserAccessTab app={app} onUpdate={invalidate} />
      )}
    </div>
  );
}

// ---- Role Access Tab ----
function RoleAccessTab({ app, onUpdate }: { app: MiniApp; onUpdate: () => void }) {
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
      api.post(`/admin/mini-apps/${app.id}/roles`, { role_id }).then((r) => r.data),
    onSuccess: () => {
      onUpdate();
      setShowAdd(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (roleId: string) =>
      api.delete(`/admin/mini-apps/${app.id}/roles/${roleId}`).then((r) => r.data),
    onSuccess: () => onUpdate(),
  });

  const assignedRoleIds = new Set((app.role_access || []).map((ra) => ra.role_id));
  const availableRoles = (allRoles || []).filter((r) => !assignedRoleIds.has(r.id));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-foreground-muted">
          Users with these roles will see this mini app in their sidebar.
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-hover"
        >
          + Add Role
        </button>
      </div>

      {/* Add role dropdown */}
      {showAdd && (
        <div className="mb-4 rounded-lg border border-divider bg-surface p-4">
          {availableRoles.length === 0 ? (
            <p className="text-sm text-foreground-dim">All roles already have access.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground-muted">Select a role to grant access:</p>
              <div className="flex flex-wrap gap-2">
                {availableRoles.map((role) => (
                  <button
                    key={role.id}
                    onClick={() => addMutation.mutate(role.id)}
                    disabled={addMutation.isPending}
                    className="rounded-full border border-divider px-3 py-1 text-xs font-medium text-foreground-muted hover:bg-surface-alt hover:text-foreground disabled:opacity-50"
                    style={{ borderColor: role.color || '#E2E8F0' }}
                  >
                    {role.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            onClick={() => setShowAdd(false)}
            className="mt-3 text-xs text-foreground-dim hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Current roles */}
      {(app.role_access || []).length === 0 ? (
        <div className="rounded-lg border border-divider bg-surface py-8 text-center">
          <p className="text-sm text-foreground-dim">No roles assigned. Click "Add Role" to grant access.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(app.role_access || []).map((ra) => (
            <div
              key={ra.id}
              className="flex items-center justify-between rounded-lg border border-divider bg-surface px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: ra.role?.color || '#90A1B9' }}
                />
                <span className="text-sm font-medium text-foreground">{ra.role?.name || 'Unknown Role'}</span>
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
function UserAccessTab({ app, onUpdate }: { app: MiniApp; onUpdate: () => void }) {
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
      api.post(`/admin/mini-apps/${app.id}/users`, { user_id }).then((r) => r.data),
    onSuccess: () => {
      onUpdate();
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/admin/mini-apps/${app.id}/users/${userId}`).then((r) => r.data),
    onSuccess: () => onUpdate(),
  });

  const assignedUserIds = new Set((app.user_access || []).map((ua) => ua.user_id));
  const availableUsers = (allUsers || [])
    .filter((u) => !assignedUserIds.has(u.id))
    .filter((u) =>
      !search || u.display_name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
    );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-foreground-muted">
          Grant direct access to individual users (supplements role-based access).
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-hover"
        >
          + Add User
        </button>
      </div>

      {/* Add user panel */}
      {showAdd && (
        <div className="mb-4 rounded-lg border border-divider bg-surface p-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users by name or email..."
            className="mb-3 w-full rounded-md border border-divider px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {availableUsers.length === 0 ? (
              <p className="text-sm text-foreground-dim">No matching users found.</p>
            ) : (
              availableUsers.slice(0, 20).map((user) => (
                <button
                  key={user.id}
                  onClick={() => addMutation.mutate(user.id)}
                  disabled={addMutation.isPending}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-surface-alt disabled:opacity-50"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-well text-xs font-medium text-foreground-muted">
                    {user.display_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <div className="text-sm text-foreground">{user.display_name}</div>
                    <div className="text-xs text-foreground-dim">{user.email}</div>
                  </div>
                </button>
              ))
            )}
          </div>
          <button
            onClick={() => { setShowAdd(false); setSearch(''); }}
            className="mt-3 text-xs text-foreground-dim hover:text-foreground"
          >
            Close
          </button>
        </div>
      )}

      {/* Current users */}
      {(app.user_access || []).length === 0 ? (
        <div className="rounded-lg border border-divider bg-surface py-8 text-center">
          <p className="text-sm text-foreground-dim">No direct user grants. Click "Add User" to grant access.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(app.user_access || []).map((ua) => (
            <div
              key={ua.id}
              className="flex items-center justify-between rounded-lg border border-divider bg-surface px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-well text-xs font-medium text-foreground-muted">
                  {ua.user?.display_name?.[0]?.toUpperCase() || '?'}
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{ua.user?.display_name || 'Unknown'}</div>
                  <div className="text-xs text-foreground-dim">{ua.user?.email || ''}</div>
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
