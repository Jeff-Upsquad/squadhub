'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type {
  Role,
  User,
  TaskTag,
  LabelGroupWithAccess,
  LabelCreateAccess,
  LabelRequest,
} from '@squadhub/shared';

type Tab = 'labels' | 'create' | 'requests';

const DEFAULT_COLOR = '#6b7280';

export default function AdminLabels() {
  const [tab, setTab] = useState<Tab>('labels');

  const { data: pendingRequests } = useQuery<LabelRequest[]>({
    queryKey: ['admin-label-requests', 'pending'],
    queryFn: async () => (await api.get('/admin/labels/requests', { params: { status: 'pending' } })).data.data,
  });
  const pendingCount = (pendingRequests || []).length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground">Labels</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Manage task labels, organise them into groups, control who can see and create them.
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex gap-1 border-b border-divider">
        {([
          ['labels', 'Groups & Labels'],
          ['create', 'Who can create'],
          ['requests', `Requests${pendingCount ? ` (${pendingCount})` : ''}`],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition border-b-2 ${
              tab === t ? 'border-ink text-foreground' : 'border-transparent text-foreground-muted hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'labels' && <GroupsAndLabels />}
      {tab === 'create' && <CreateAccessPanel />}
      {tab === 'requests' && <RequestsInbox />}
    </div>
  );
}

// ============================================================
// Groups & Labels
// ============================================================
function GroupsAndLabels() {
  const qc = useQueryClient();
  const [newGroup, setNewGroup] = useState('');
  const [accessGroup, setAccessGroup] = useState<LabelGroupWithAccess | null>(null);

  const { data: groups, isLoading } = useQuery<LabelGroupWithAccess[]>({
    queryKey: ['admin-label-groups'],
    queryFn: async () => (await api.get('/admin/labels/groups')).data.data,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-label-groups'] });

  const createGroup = useMutation({
    mutationFn: (name: string) => api.post('/admin/labels/groups', { name }),
    onSuccess: () => { invalidate(); setNewGroup(''); },
  });
  const deleteGroup = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/labels/groups/${id}`),
    onSuccess: invalidate,
  });

  if (isLoading) return <p className="py-8 text-center text-sm text-foreground-dim">Loading…</p>;

  return (
    <div>
      {/* New group */}
      <form
        onSubmit={(e) => { e.preventDefault(); if (newGroup.trim()) createGroup.mutate(newGroup.trim()); }}
        className="mb-5 flex gap-2"
      >
        <input
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value)}
          placeholder="New group name…"
          className="w-64 rounded-lg border border-divider px-3 py-2 text-sm focus:border-ink focus:outline-none"
        />
        <button
          type="submit"
          disabled={!newGroup.trim() || createGroup.isPending}
          className="rounded-lg bg-ink px-4 py-2 text-xs font-medium text-white hover:bg-ink-hover disabled:opacity-50"
        >
          + New group
        </button>
      </form>

      <div className="space-y-4">
        {(groups || []).map((group) => (
          <GroupCard
            key={group.id}
            group={group}
            onChanged={invalidate}
            onManageAccess={() => setAccessGroup(group)}
            onDelete={() => {
              if (confirm(`Delete group "${group.name}"? Its labels will move to General.`)) deleteGroup.mutate(group.id);
            }}
          />
        ))}
      </div>

      {accessGroup && (
        <GroupAccessSlider group={accessGroup} onClose={() => { setAccessGroup(null); invalidate(); }} />
      )}
    </div>
  );
}

function GroupCard({
  group, onChanged, onManageAccess, onDelete,
}: {
  group: LabelGroupWithAccess;
  onChanged: () => void;
  onManageAccess: () => void;
  onDelete: () => void;
}) {
  const [newLabel, setNewLabel] = useState('');
  const addLabel = useMutation({
    mutationFn: (name: string) => api.post('/admin/labels', { name, group_id: group.id }),
    onSuccess: () => { onChanged(); setNewLabel(''); },
    onError: (e: any) => alert(e?.response?.data?.error || 'Failed to add label'),
  });

  const restricted = !group.is_default && (group.role_access.length > 0 || group.user_access.length > 0);

  return (
    <div className="rounded-lg border border-divider bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{group.name}</span>
          {group.is_default ? (
            <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-foreground-muted">
              Default · visible to everyone
            </span>
          ) : restricted ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              Private · {group.role_access.length} role{group.role_access.length !== 1 ? 's' : ''}, {group.user_access.length} user{group.user_access.length !== 1 ? 's' : ''}
            </span>
          ) : (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600">
              Private · admins only (no one assigned)
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!group.is_default && (
            <button onClick={onManageAccess} className="text-xs font-medium text-foreground-muted hover:text-foreground">
              Manage access
            </button>
          )}
          {!group.is_default && (
            <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-700">Delete group</button>
          )}
        </div>
      </div>

      {/* Labels */}
      <div className="flex flex-wrap items-center gap-2">
        {group.labels.map((label) => (
          <LabelChip key={label.id} label={label} onChanged={onChanged} groupId={group.id} />
        ))}
        {group.labels.length === 0 && (
          <span className="text-xs text-foreground-dim">No labels yet.</span>
        )}
      </div>

      {/* Add label */}
      <form
        onSubmit={(e) => { e.preventDefault(); if (newLabel.trim()) addLabel.mutate(newLabel.trim()); }}
        className="mt-3 flex gap-2"
      >
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Add a label…"
          className="w-52 rounded-md border border-divider px-3 py-1.5 text-xs focus:border-ink focus:outline-none"
        />
        <button
          type="submit"
          disabled={!newLabel.trim() || addLabel.isPending}
          className="rounded-md border border-divider px-3 py-1.5 text-xs font-medium text-foreground-muted hover:bg-surface-alt hover:text-foreground disabled:opacity-50"
        >
          + Add
        </button>
      </form>
    </div>
  );
}

function LabelChip({ label, groupId, onChanged }: { label: TaskTag; groupId: string; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color || DEFAULT_COLOR);

  const update = useMutation({
    mutationFn: (body: Partial<Pick<TaskTag, 'name' | 'color' | 'group_id'>>) =>
      api.put(`/admin/labels/${label.id}`, body),
    onSuccess: () => { onChanged(); setEditing(false); },
    onError: (e: any) => alert(e?.response?.data?.error || 'Failed to update label'),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/admin/labels/${label.id}`),
    onSuccess: onChanged,
  });

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-divider bg-surface-alt px-2 py-1">
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-28 bg-transparent text-xs outline-none"
          autoFocus
        />
        <button
          onClick={() => update.mutate({ name: name.trim(), color })}
          disabled={!name.trim() || update.isPending}
          className="text-[11px] font-medium text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
        >Save</button>
        <button onClick={() => remove.mutate()} className="text-[11px] text-red-500 hover:text-red-700">Delete</button>
        <button onClick={() => { setEditing(false); setName(label.name); setColor(label.color || DEFAULT_COLOR); }} className="text-[11px] text-foreground-dim hover:text-foreground">✕</button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-1.5 rounded-full border border-divider px-2.5 py-1 text-xs text-foreground hover:bg-surface-alt"
      title="Edit label"
    >
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: label.color || DEFAULT_COLOR }} />
      {label.name}
    </button>
  );
}

// ============================================================
// Group visibility access (right-side slider)
// ============================================================
function GroupAccessSlider({ group, onClose }: { group: LabelGroupWithAccess; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: fresh } = useQuery<LabelGroupWithAccess>({
    queryKey: ['admin-label-group', group.id],
    queryFn: async () => (await api.get(`/admin/labels/groups/${group.id}`)).data.data,
    initialData: group,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-label-group', group.id] });
    qc.invalidateQueries({ queryKey: ['admin-label-groups'] });
  };

  const addRole = useMutation({ mutationFn: (role_id: string) => api.post(`/admin/labels/groups/${group.id}/roles`, { role_id }), onSuccess: invalidate });
  const removeRole = useMutation({ mutationFn: (roleId: string) => api.delete(`/admin/labels/groups/${group.id}/roles/${roleId}`), onSuccess: invalidate });
  const addUser = useMutation({ mutationFn: (user_id: string) => api.post(`/admin/labels/groups/${group.id}/users`, { user_id }), onSuccess: invalidate });
  const removeUser = useMutation({ mutationFn: (userId: string) => api.delete(`/admin/labels/groups/${group.id}/users/${userId}`), onSuccess: invalidate });

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[400px] flex-col bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <div>
            <h3 className="font-[family-name:var(--font-display)] text-base font-semibold text-foreground">{fresh?.name} access</h3>
            <p className="mt-0.5 text-xs text-foreground-dim">Only assigned roles/users can see this group's labels</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-foreground-dim hover:bg-canvas hover:text-foreground">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <AccessManager
            roleRows={(fresh?.role_access || []).map((r) => ({ id: r.id, role_id: r.role_id, role: r.role }))}
            userRows={(fresh?.user_access || []).map((u) => ({ id: u.id, user_id: u.user_id, user: u.user }))}
            onAddRole={(id) => addRole.mutate(id)}
            onRemoveRole={(id) => removeRole.mutate(id)}
            onAddUser={(id) => addUser.mutate(id)}
            onRemoveUser={(id) => removeUser.mutate(id)}
          />
        </div>
      </div>
    </>
  );
}

// ============================================================
// Who can create labels
// ============================================================
function CreateAccessPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<LabelCreateAccess>({
    queryKey: ['admin-label-create-access'],
    queryFn: async () => (await api.get('/admin/labels/create-access')).data.data,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-label-create-access'] });

  const addRole = useMutation({ mutationFn: (role_id: string) => api.post('/admin/labels/create-access/roles', { role_id }), onSuccess: invalidate });
  const removeRole = useMutation({ mutationFn: (roleId: string) => api.delete(`/admin/labels/create-access/roles/${roleId}`), onSuccess: invalidate });
  const addUser = useMutation({ mutationFn: (user_id: string) => api.post('/admin/labels/create-access/users', { user_id }), onSuccess: invalidate });
  const removeUser = useMutation({ mutationFn: (userId: string) => api.delete(`/admin/labels/create-access/users/${userId}`), onSuccess: invalidate });

  if (isLoading) return <p className="py-8 text-center text-sm text-foreground-dim">Loading…</p>;

  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-sm text-foreground-muted">
        Admins can always create labels. Grant these roles or users permission to create labels inline from a task too.
      </p>
      <AccessManager
        roleRows={(data?.roles || []).map((r) => ({ id: r.id, role_id: r.role_id, role: r.role }))}
        userRows={(data?.users || []).map((u) => ({ id: u.id, user_id: u.user_id, user: u.user }))}
        onAddRole={(id) => addRole.mutate(id)}
        onRemoveRole={(id) => removeRole.mutate(id)}
        onAddUser={(id) => addUser.mutate(id)}
        onRemoveUser={(id) => removeUser.mutate(id)}
      />
    </div>
  );
}

// ============================================================
// Reusable roles/users access manager (presentational)
// ============================================================
type RoleRow = { id: string; role_id: string; role?: Pick<Role, 'id' | 'name' | 'color'> | null };
type UserRow = { id: string; user_id: string; user?: Pick<User, 'id' | 'display_name' | 'email'> | null };

function AccessManager({
  roleRows, userRows, onAddRole, onRemoveRole, onAddUser, onRemoveUser,
}: {
  roleRows: RoleRow[];
  userRows: UserRow[];
  onAddRole: (roleId: string) => void;
  onRemoveRole: (roleId: string) => void;
  onAddUser: (userId: string) => void;
  onRemoveUser: (userId: string) => void;
}) {
  const [showRoleAdd, setShowRoleAdd] = useState(false);
  const [showUserAdd, setShowUserAdd] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const { data: allRoles } = useQuery<Role[]>({
    queryKey: ['all-roles'],
    queryFn: async () => (await api.get('/admin/roles')).data.data,
    enabled: showRoleAdd,
  });
  const { data: allUsers } = useQuery<User[]>({
    queryKey: ['all-users-for-access'],
    queryFn: async () => (await api.get('/admin/users')).data.data,
    enabled: showUserAdd,
  });

  const assignedRoleIds = new Set(roleRows.map((r) => r.role_id));
  const availableRoles = (allRoles || []).filter((r) => !assignedRoleIds.has(r.id));
  const assignedUserIds = new Set(userRows.map((u) => u.user_id));
  const availableUsers = (allUsers || [])
    .filter((u) => !assignedUserIds.has(u.id))
    .filter((u) => !userSearch || u.display_name.toLowerCase().includes(userSearch.toLowerCase()) || u.email.toLowerCase().includes(userSearch.toLowerCase()));

  return (
    <div className="space-y-5">
      {/* Roles */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-dim">Roles ({roleRows.length})</p>
          <button onClick={() => setShowRoleAdd((v) => !v)} className="text-xs font-medium text-foreground-muted hover:text-foreground">
            {showRoleAdd ? 'Cancel' : '+ Add role'}
          </button>
        </div>
        {showRoleAdd && (
          <div className="mb-2 rounded-lg border border-divider bg-surface-alt p-3">
            {availableRoles.length === 0 ? (
              <p className="text-xs text-foreground-dim">All roles already added.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {availableRoles.map((role) => (
                  <button key={role.id} onClick={() => onAddRole(role.id)} className="rounded-full border border-divider bg-surface px-3 py-1 text-xs font-medium text-foreground-muted hover:bg-canvas hover:text-foreground">
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: role.color || '#90A1B9' }} />
                    {role.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {roleRows.length === 0 ? (
          <p className="text-xs text-foreground-dim">No roles assigned.</p>
        ) : (
          <div className="space-y-1.5">
            {roleRows.map((ra) => (
              <div key={ra.id} className="flex items-center justify-between rounded-lg border border-divider px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: ra.role?.color || '#90A1B9' }} />
                  <span className="text-sm text-foreground">{ra.role?.name || 'Unknown role'}</span>
                </div>
                <button onClick={() => onRemoveRole(ra.role_id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Users */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-dim">Users ({userRows.length})</p>
          <button onClick={() => setShowUserAdd((v) => !v)} className="text-xs font-medium text-foreground-muted hover:text-foreground">
            {showUserAdd ? 'Cancel' : '+ Add user'}
          </button>
        </div>
        {showUserAdd && (
          <div className="mb-2 rounded-lg border border-divider bg-surface-alt p-3">
            <input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="mb-2 w-full rounded-md border border-divider bg-surface px-3 py-1.5 text-xs focus:border-ink focus:outline-none"
            />
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {availableUsers.length === 0 ? (
                <p className="py-2 text-xs text-foreground-dim">No users found.</p>
              ) : (
                availableUsers.slice(0, 15).map((user) => (
                  <button key={user.id} onClick={() => onAddUser(user.id)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface">
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
          </div>
        )}
        {userRows.length === 0 ? (
          <p className="text-xs text-foreground-dim">No users assigned.</p>
        ) : (
          <div className="space-y-1.5">
            {userRows.map((ua) => (
              <div key={ua.id} className="flex items-center justify-between rounded-lg border border-divider px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-well text-[10px] font-medium text-foreground-muted">
                    {ua.user?.display_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <div className="text-sm text-foreground">{ua.user?.display_name || 'Unknown'}</div>
                    <div className="text-[10px] text-foreground-dim">{ua.user?.email || ''}</div>
                  </div>
                </div>
                <button onClick={() => onRemoveUser(ua.user_id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Requests inbox
// ============================================================
function RequestsInbox() {
  const qc = useQueryClient();
  const { data: requests, isLoading } = useQuery<LabelRequest[]>({
    queryKey: ['admin-label-requests', 'pending'],
    queryFn: async () => (await api.get('/admin/labels/requests', { params: { status: 'pending' } })).data.data,
  });
  const { data: groups } = useQuery<LabelGroupWithAccess[]>({
    queryKey: ['admin-label-groups'],
    queryFn: async () => (await api.get('/admin/labels/groups')).data.data,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-label-requests'] });
    qc.invalidateQueries({ queryKey: ['admin-label-groups'] });
  };
  const approve = useMutation({
    mutationFn: ({ id, group_id }: { id: string; group_id?: string }) => api.post(`/admin/labels/requests/${id}/approve`, { group_id }),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: (id: string) => api.post(`/admin/labels/requests/${id}/reject`),
    onSuccess: invalidate,
  });

  if (isLoading) return <p className="py-8 text-center text-sm text-foreground-dim">Loading…</p>;
  if (!requests || requests.length === 0) {
    return (
      <div className="rounded-lg border border-divider bg-surface py-12 text-center">
        <p className="text-sm text-foreground-dim">No pending label requests.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-3">
      {requests.map((req) => (
        <RequestRow key={req.id} req={req} groups={groups || []} onApprove={(group_id) => approve.mutate({ id: req.id, group_id })} onReject={() => reject.mutate(req.id)} />
      ))}
    </div>
  );
}

function RequestRow({
  req, groups, onApprove, onReject,
}: {
  req: LabelRequest;
  groups: LabelGroupWithAccess[];
  onApprove: (groupId: string) => void;
  onReject: () => void;
}) {
  const defaultGroup = groups.find((g) => g.is_default);
  const [groupId, setGroupId] = useState<string>(req.suggested_group_id || defaultGroup?.id || '');

  return (
    <div className="rounded-lg border border-divider bg-surface px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{req.name}</span>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">pending</span>
          </div>
          <p className="mt-0.5 text-xs text-foreground-dim">
            Requested by {req.requester?.display_name || 'Unknown'}
            {req.suggested_group ? ` · suggested group: ${req.suggested_group.name}` : ''}
          </p>
          {req.note && <p className="mt-1 text-xs text-foreground-muted">“{req.note}”</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="rounded-md border border-divider px-2 py-1.5 text-xs focus:border-ink focus:outline-none"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}{g.is_default ? ' (default)' : ''}</option>
            ))}
          </select>
          <button onClick={() => onApprove(groupId || undefined as any)} className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-hover">
            Approve
          </button>
          <button onClick={onReject} className="rounded-lg border border-divider px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50">
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}
