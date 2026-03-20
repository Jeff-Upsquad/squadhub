import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import type { User, Role } from '@squadhub/shared';

interface UserWithRole extends User {
  custom_role?: { id: string; name: string; color: string } | null;
}

/* ─────────────────────────── Edit Slider ─────────────────────────── */
function EditUserSlider({
  user,
  roles,
  onClose,
}: {
  user: UserWithRole;
  roles: Role[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(user.display_name);
  const [email, setEmail] = useState(user.email);
  const [roleId, setRoleId] = useState(user.custom_role?.id || '');
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);

  // Animate in
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const close = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  const profileMutation = useMutation({
    mutationFn: (data: { display_name?: string; email?: string }) =>
      api.put(`/admin/users/${user.id}/profile`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err: any) => {
      setError(err?.response?.data?.error || 'Failed to update profile');
    },
  });

  const customRoleMutation = useMutation({
    mutationFn: (role_id: string) =>
      api.put(`/admin/users/${user.id}/custom-role`, { role_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err: any) => {
      setError(err?.response?.data?.error || 'Failed to update role');
    },
  });

  const isSaving = profileMutation.isPending || customRoleMutation.isPending;

  const handleSave = async () => {
    setError('');
    const profileUpdates: { display_name?: string; email?: string } = {};
    if (name.trim() !== user.display_name) profileUpdates.display_name = name.trim();
    if (email.trim() !== user.email) profileUpdates.email = email.trim();

    try {
      // Update profile if changed
      if (Object.keys(profileUpdates).length > 0) {
        await profileMutation.mutateAsync(profileUpdates);
      }
      // Update custom role if changed
      if (roleId && roleId !== (user.custom_role?.id || '')) {
        await customRoleMutation.mutateAsync(roleId);
      }
      close();
    } catch {
      // Error is handled in onError
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={close}
      />

      {/* Slider panel */}
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-[#eaeaea] bg-white shadow-2xl transition-transform duration-200 ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#eaeaea] px-6 py-4">
          <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[#171717]">Edit User</h3>
          <button
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#999] transition hover:bg-[#f5f5f5] hover:text-[#171717]"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Avatar + Status */}
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#eaeaea] text-xl font-semibold text-[#171717]">
              {user.display_name[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <p className="text-base font-medium text-[#171717]">{user.display_name}</p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className={`inline-block rounded-full px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] font-medium ${
                  user.role === 'admin'
                    ? 'bg-amber-50 text-amber-600'
                    : user.role === 'banned'
                    ? 'bg-red-50 text-red-600'
                    : 'bg-[#f5f5f5] text-[#666]'
                }`}>
                  {user.role}
                </span>
                <span className="font-[family-name:var(--font-mono)] text-xs text-[#999]">
                  Joined {new Date(user.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            {/* Display Name */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#666]">Display Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                className="w-full rounded-md border border-[#d9d9d9] bg-white px-3 py-2.5 text-sm text-[#171717] placeholder-[#999] outline-none transition focus:border-[#0070F3] focus:ring-1 focus:ring-[#0070F3]"
              />
            </div>

            {/* Email */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#666]">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-[#d9d9d9] bg-white px-3 py-2.5 text-sm text-[#171717] placeholder-[#999] outline-none transition focus:border-[#0070F3] focus:ring-1 focus:ring-[#0070F3]"
              />
            </div>

            {/* Custom Role */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#666]">Role</label>
              {roles.length > 0 ? (
                <div className="space-y-1.5">
                  {roles.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => setRoleId(role.id)}
                      className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition ${
                        roleId === role.id
                          ? 'border-[#0070F3] bg-[#f5f5f5] text-[#171717]'
                          : 'border-[#eaeaea] bg-white text-[#666] hover:border-[#d9d9d9] hover:text-[#171717]'
                      }`}
                    >
                      <span
                        className="inline-block h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: role.color }}
                      />
                      <span className="font-medium">{role.name}</span>
                      {role.is_default && (
                        <span className="ml-auto rounded-full bg-[#f5f5f5] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[#999]">
                          Default
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#999]">
                  {user.status === 'pending' ? 'User is pending approval' : 'No roles available'}
                </p>
              )}
            </div>

            {/* Platform Role */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#666]">Platform Access</label>
              <div className="rounded-md border border-[#eaeaea] bg-[#fafafa] px-3 py-2.5">
                <span className={`inline-block rounded-full px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-xs font-medium ${
                  user.role === 'admin'
                    ? 'bg-amber-50 text-amber-600'
                    : user.role === 'banned'
                    ? 'bg-red-50 text-red-600'
                    : 'bg-[#f5f5f5] text-[#666]'
                }`}>
                  {user.role}
                </span>
                <p className="mt-1 text-[11px] text-[#999]">
                  Use the actions in the table to change platform role (admin/member) or ban/unban.
                </p>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[#eaeaea] px-6 py-4">
          <button
            onClick={close}
            className="rounded-md border border-[#d9d9d9] px-4 py-2 text-sm text-[#666] transition hover:border-[#999] hover:text-[#171717]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className="rounded-md bg-[#171717] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#333] disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────── User Row ─────────────────────────── */
function UserRow({
  user,
  currentUserId,
  roles,
  onAction,
  onEdit,
}: {
  user: UserWithRole;
  currentUserId: string;
  roles: Role[];
  onAction: () => void;
  onEdit: (user: UserWithRole) => void;
}) {
  const queryClient = useQueryClient();
  const isSelf = user.id === currentUserId;
  const isBanned = user.role === 'banned';

  const roleMutation = useMutation({
    mutationFn: (role: string) => api.put(`/admin/users/${user.id}/role`, { role }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-users'] }); onAction(); },
  });

  const banMutation = useMutation({
    mutationFn: (banned: boolean) => api.put(`/admin/users/${user.id}/ban`, { banned }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-users'] }); onAction(); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/admin/users/${user.id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-users'] }); onAction(); },
  });

  const handleDelete = () => {
    if (window.confirm(`Are you sure you want to permanently delete ${user.display_name}?`)) {
      deleteMutation.mutate();
    }
  };

  const date = new Date(user.created_at).toLocaleDateString();

  return (
    <tr className="border-t border-[#eaeaea] hover:bg-[#fafafa]">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#eaeaea] text-sm font-medium text-[#171717]">
            {user.display_name[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="text-sm font-medium text-[#171717]">{user.display_name}</p>
            <p className="text-xs text-[#999]">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-block rounded-full px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-xs font-medium ${
          user.role === 'admin'
            ? 'bg-amber-50 text-amber-600'
            : user.role === 'banned'
            ? 'bg-red-50 text-red-600'
            : 'bg-[#f5f5f5] text-[#666]'
        }`}>
          {user.role}
        </span>
      </td>
      <td className="px-4 py-3">
        {user.custom_role ? (
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: user.custom_role.color }}
            />
            <span className="text-xs text-[#171717]">{user.custom_role.name}</span>
          </div>
        ) : (
          <span className="text-xs text-[#999]">{user.status === 'pending' ? 'Pending' : '—'}</span>
        )}
      </td>
      <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-sm text-[#666]">{date}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(user)}
            className="rounded-md border border-[#d9d9d9] bg-transparent px-2.5 py-1 text-xs text-[#666] hover:border-[#999] hover:text-[#171717]"
          >
            Edit
          </button>
          {!isSelf && (
            <>
              {!isBanned && (
                <button
                  onClick={() => roleMutation.mutate(user.role === 'admin' ? 'member' : 'admin')}
                  disabled={roleMutation.isPending}
                  className="rounded-md border border-[#d9d9d9] bg-transparent px-2.5 py-1 text-xs text-[#666] hover:border-[#999] hover:text-[#171717] disabled:opacity-50"
                >
                  {user.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                </button>
              )}
              <button
                onClick={() => banMutation.mutate(!isBanned)}
                disabled={banMutation.isPending}
                className={`rounded-md px-2.5 py-1 text-xs disabled:opacity-50 ${
                  isBanned
                    ? 'bg-green-50 text-green-600 hover:bg-green-100'
                    : 'bg-red-50 text-red-600 hover:bg-red-100'
                }`}
              >
                {isBanned ? 'Unban' : 'Ban'}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="rounded-md bg-red-50 px-2.5 py-1 text-xs text-red-600 hover:bg-red-100 disabled:opacity-50"
              >
                Delete
              </button>
            </>
          )}
          {isSelf && <span className="text-xs text-[#999]">You</span>}
        </div>
      </td>
    </tr>
  );
}

/* ─────────────────────────── Main Page ─────────────────────────── */
export default function AdminUsers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editingUser, setEditingUser] = useState<UserWithRole | null>(null);

  const authState = JSON.parse(localStorage.getItem('squadhub-admin-auth') || '{}');
  const currentUserId = authState?.state?.user?.id || '';

  const { data: usersRes, isLoading } = useQuery({
    queryKey: ['admin-users', search, page],
    queryFn: () => api.get(`/admin/users?search=${search}&page=${page}&limit=20`).then((r) => r.data),
  });

  const { data: rolesRes } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api.get('/admin/roles').then((r) => r.data),
  });

  const users: UserWithRole[] = usersRes?.data || [];
  const roles: Role[] = rolesRes?.data || [];
  const total: number = usersRes?.total || 0;
  const totalPages = Math.ceil(total / 20);

  const refreshStats = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[#171717]">Users ({total})</h2>
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by name or email..."
          className="w-full rounded-md border border-[#d9d9d9] bg-white px-3 py-2 text-sm text-[#171717] placeholder-[#999] outline-none focus:border-[#0070F3] focus:ring-1 focus:ring-[#0070F3] sm:w-72"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-[#eaeaea] bg-white">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-[#999]">Loading users...</p>
        ) : users.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#999]">No users found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#eaeaea] bg-[#fafafa]">
                  <th className="px-4 py-3 font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#666]">User</th>
                  <th className="px-4 py-3 font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#666]">Platform</th>
                  <th className="px-4 py-3 font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#666]">Role</th>
                  <th className="px-4 py-3 font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#666]">Joined</th>
                  <th className="px-4 py-3 font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-[#666]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    currentUserId={currentUserId}
                    roles={roles}
                    onAction={refreshStats}
                    onEdit={setEditingUser}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2 border-t border-[#eaeaea] px-4 py-3">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="rounded-md border border-[#d9d9d9] bg-transparent px-3 py-1.5 text-sm text-[#666] hover:border-[#999] hover:text-[#171717] disabled:opacity-40"
            >
              Previous
            </button>
            <span className="font-[family-name:var(--font-mono)] text-sm text-[#666]">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-[#d9d9d9] bg-transparent px-3 py-1.5 text-sm text-[#666] hover:border-[#999] hover:text-[#171717] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Edit User Slider */}
      {editingUser && (
        <EditUserSlider
          key={editingUser.id}
          user={editingUser}
          roles={roles}
          onClose={() => setEditingUser(null)}
        />
      )}
    </div>
  );
}
