import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';

type AppScope = 'clients' | 'team';

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  app_scope: AppScope;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  member_count: number;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  user_type: 'internal' | 'client' | 'client_staff' | 'partner';
  is_admin: boolean;
}

export default function SquadChatGroupsModule() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<AppScope | 'all'>('all');

  const { data: groupsRes, isLoading } = useQuery({
    queryKey: ['admin-chat-groups'],
    queryFn: () => api.get('/admin/chat/groups').then((r) => r.data),
  });

  const groups: GroupRow[] = groupsRes?.data || [];
  const filtered = scopeFilter === 'all' ? groups : groups.filter((g) => g.app_scope === scopeFilter);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[#0F172B]">Groups</h1>
          <p className="mt-1 text-sm text-[#62748E]">WhatsApp-style group chats used by Squad Chat apps.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="rounded-md bg-[#0F172B] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1D293D]"
        >
          + New group
        </button>
      </div>

      <div className="mb-4 flex gap-2">
        {(['all', 'clients', 'team'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScopeFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              scopeFilter === s
                ? 'bg-[#0F172B] text-white'
                : 'bg-white text-[#62748E] border border-[#E2E8F0] hover:text-[#0F172B]'
            }`}
          >
            {s === 'all' ? 'All apps' : s === 'clients' ? 'Clients app' : 'Team app'}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-[#E2E8F0] bg-white overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-[#62748E]">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#62748E]">No groups yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-[#62748E]">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">App</th>
                <th className="px-4 py-3 text-left font-medium">Members</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr key={g.id} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAFC]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[#0F172B]">{g.name}</div>
                    {g.description && <div className="text-xs text-[#62748E]">{g.description}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      g.app_scope === 'clients' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
                    }`}>
                      {g.app_scope === 'clients' ? 'Clients' : 'Team'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#62748E]">{g.member_count}</td>
                  <td className="px-4 py-3">
                    {g.archived_at ? (
                      <span className="text-xs text-[#62748E]">Archived</span>
                    ) : (
                      <span className="text-xs text-emerald-600">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEditingGroupId(g.id)}
                      className="text-xs font-medium text-[#2962FF] hover:underline"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <CreateGroupDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            qc.invalidateQueries({ queryKey: ['admin-chat-groups'] });
          }}
        />
      )}
      {editingGroupId && (
        <EditGroupDialog
          groupId={editingGroupId}
          onClose={() => setEditingGroupId(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: ['admin-chat-groups'] })}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Create dialog
// -------------------------------------------------------------
function CreateGroupDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<AppScope>('team');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [groupAdmins, setGroupAdmins] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const { data: usersRes } = useQuery({
    queryKey: ['admin-users', scope],
    queryFn: () => api.get('/admin/users?limit=100').then((r) => r.data),
  });
  const users: UserRow[] = usersRes?.data || [];
  const allowedUsers = users.filter((u) =>
    scope === 'clients'
      ? u.user_type === 'client' || u.user_type === 'client_staff' || u.user_type === 'internal' || u.is_admin
      : u.user_type === 'partner' || u.user_type === 'internal' || u.is_admin,
  );
  const filteredUsers = search
    ? allowedUsers.filter((u) =>
        u.display_name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase()))
    : allowedUsers;

  const create = useMutation({
    mutationFn: () =>
      api.post('/admin/chat/groups', {
        name,
        description: description || null,
        app_scope: scope,
        member_ids: Array.from(selectedMembers),
        group_admin_ids: Array.from(groupAdmins),
      }),
    onSuccess: onCreated,
  });

  const toggleMember = (id: string) => {
    const next = new Set(selectedMembers);
    if (next.has(id)) {
      next.delete(id);
      const adminsNext = new Set(groupAdmins);
      adminsNext.delete(id);
      setGroupAdmins(adminsNext);
    } else next.add(id);
    setSelectedMembers(next);
  };

  const toggleAdmin = (id: string) => {
    if (!selectedMembers.has(id)) return;
    const next = new Set(groupAdmins);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setGroupAdmins(next);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
          <h2 className="text-lg font-semibold">New group</h2>
          <button onClick={onClose} className="text-[#62748E] hover:text-[#0F172B]">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-[#62748E] mb-1">App</label>
            <div className="flex gap-2">
              {(['clients', 'team'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setScope(s); setSelectedMembers(new Set()); setGroupAdmins(new Set()); }}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm transition ${
                    scope === s
                      ? 'border-[#0F172B] bg-[#0F172B] text-white'
                      : 'border-[#E2E8F0] bg-white text-[#62748E] hover:text-[#0F172B]'
                  }`}
                >
                  {s === 'clients' ? 'Clients app' : 'Team app'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-[#62748E] mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Co. Account Team"
              className="w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-[#62748E] mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-[#E2E8F0] px-3 py-2 text-sm"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium uppercase tracking-wider text-[#62748E]">
                Members · {selectedMembers.size} selected
              </label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="rounded-md border border-[#E2E8F0] px-2 py-1 text-xs w-40"
              />
            </div>
            <div className="border border-[#E2E8F0] rounded-md max-h-72 overflow-y-auto divide-y divide-[#F1F5F9]">
              {filteredUsers.map((u) => {
                const picked = selectedMembers.has(u.id);
                return (
                  <div
                    key={u.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-[#F8FAFC]"
                  >
                    <input
                      type="checkbox"
                      checked={picked}
                      onChange={() => toggleMember(u.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{u.display_name}</div>
                      <div className="text-[11px] text-[#62748E]">{u.email} · {u.is_admin ? 'Admin' : u.user_type}</div>
                    </div>
                    <label className="flex items-center gap-1 text-[11px] text-[#62748E]">
                      <input
                        type="checkbox"
                        checked={groupAdmins.has(u.id)}
                        disabled={!picked}
                        onChange={() => toggleAdmin(u.id)}
                      />
                      Group admin
                    </label>
                  </div>
                );
              })}
              {filteredUsers.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-[#62748E]">No users match.</div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#E2E8F0] px-5 py-3">
          <button onClick={onClose} className="rounded-md px-3 py-2 text-sm text-[#62748E] hover:bg-[#F1F5F9]">
            Cancel
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={!name.trim() || create.isPending}
            className="rounded-md bg-[#0F172B] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D293D] disabled:opacity-50"
          >
            {create.isPending ? 'Creating…' : 'Create group'}
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Edit dialog — manage existing group members
// -------------------------------------------------------------
function EditGroupDialog({ groupId, onClose, onChanged }: { groupId: string; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();

  const { data: groupRes } = useQuery({
    queryKey: ['admin-chat-group', groupId],
    queryFn: () => api.get(`/admin/chat/groups`).then((r) => r.data),
  });
  const group = (groupRes?.data || []).find((g: GroupRow) => g.id === groupId);

  const { data: membersRes } = useQuery({
    queryKey: ['admin-chat-group-members', groupId],
    queryFn: () => api.get(`/admin/chat/groups/${groupId}/members`).then((r) => r.data),
  });
  const members = membersRes?.data || [];

  const { data: usersRes } = useQuery({
    queryKey: ['admin-users-for-group', group?.app_scope],
    queryFn: () => api.get('/admin/users?limit=100').then((r) => r.data),
    enabled: !!group,
  });
  const users: UserRow[] = usersRes?.data || [];

  const addMember = useMutation({
    mutationFn: (user_id: string) => api.post(`/admin/chat/groups/${groupId}/members`, { user_ids: [user_id] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-chat-group-members', groupId] });
      onChanged();
    },
  });
  const removeMember = useMutation({
    mutationFn: (user_id: string) => api.delete(`/admin/chat/groups/${groupId}/members/${user_id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-chat-group-members', groupId] });
      onChanged();
    },
  });
  const setGroupAdmin = useMutation({
    mutationFn: ({ user_id, is }: { user_id: string; is: boolean }) =>
      api.patch(`/admin/chat/groups/${groupId}/members/${user_id}`, { is_group_admin: is }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-chat-group-members', groupId] }),
  });
  const archive = useMutation({
    mutationFn: () => api.patch(`/admin/chat/groups/${groupId}`, { archived_at: new Date().toISOString() }),
    onSuccess: () => { onChanged(); onClose(); },
  });

  if (!group) return null;

  const memberIds = new Set(members.map((m: { user_id: string }) => m.user_id));
  const addable = users.filter((u) => {
    if (memberIds.has(u.id)) return false;
    return group.app_scope === 'clients'
      ? u.user_type === 'client' || u.user_type === 'client_staff' || u.user_type === 'internal' || u.is_admin
      : u.user_type === 'partner' || u.user_type === 'internal' || u.is_admin;
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">{group.name}</h2>
            <div className="text-xs text-[#62748E]">{group.app_scope === 'clients' ? 'Clients app' : 'Team app'} · {members.length} members</div>
          </div>
          <button onClick={onClose} className="text-[#62748E] hover:text-[#0F172B]">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-[#62748E] mb-2">Current members</h3>
            <div className="border border-[#E2E8F0] rounded-md divide-y divide-[#F1F5F9]">
              {members.map((m: { id: string; user_id: string; is_group_admin: boolean; user: UserRow }) => (
                <div key={m.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{m.user.display_name}</div>
                    <div className="text-[11px] text-[#62748E]">{m.user.email} · {m.user.is_admin ? 'Admin' : m.user.user_type}</div>
                  </div>
                  <label className="flex items-center gap-1 text-[11px] text-[#62748E]">
                    <input
                      type="checkbox"
                      checked={m.is_group_admin}
                      onChange={(e) => setGroupAdmin.mutate({ user_id: m.user_id, is: e.target.checked })}
                    />
                    Group admin
                  </label>
                  <button
                    onClick={() => removeMember.mutate(m.user_id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-[#62748E] mb-2">Add members</h3>
            <div className="border border-[#E2E8F0] rounded-md divide-y divide-[#F1F5F9] max-h-64 overflow-y-auto">
              {addable.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-[#62748E]">No eligible users to add.</div>
              ) : (
                addable.map((u) => (
                  <div key={u.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{u.display_name}</div>
                      <div className="text-[11px] text-[#62748E]">{u.email}</div>
                    </div>
                    <button
                      onClick={() => addMember.mutate(u.id)}
                      className="text-xs font-medium text-[#2962FF] hover:underline"
                    >
                      Add
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {!group.archived_at && (
            <button
              onClick={() => archive.mutate()}
              className="text-xs text-red-600 hover:underline"
            >
              Archive group
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
