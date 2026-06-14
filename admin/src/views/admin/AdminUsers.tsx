import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { useSquadhireConfig, useSquadhireUserLookup } from '../../hooks/useSquadhireConfig';
import type { User, Role } from '@squadhub/shared';

interface UserWithRole extends User {
  custom_role?: { id: string; name: string; color: string } | null;
  secondary_roles?: { id: string; name: string; color: string }[];
}

type AccessLabel = 'admin' | 'active' | 'banned' | 'suspended';

function accessLabelFor(user: Pick<User, 'is_admin' | 'status'>): AccessLabel {
  if (user.status === 'banned') return 'banned';
  if (user.status === 'suspended') return 'suspended';
  if (user.is_admin) return 'admin';
  return 'active';
}

function accessLabelClass(label: AccessLabel): string {
  if (label === 'admin') return 'bg-amber-50 text-amber-600';
  if (label === 'banned') return 'bg-red-50 text-red-600';
  if (label === 'suspended') return 'bg-orange-50 text-orange-700';
  return 'bg-surface-alt text-foreground-muted';
}

function userTypeLabel(userType: string): string {
  if (userType === 'client_staff') return 'Client Staff';
  if (userType === 'partner_employee') return 'Partner Employee';
  return userType.charAt(0).toUpperCase() + userType.slice(1);
}

/* ─────────────────────────── Edit Slider ─────────────────────────── */
function EditUserSlider({
  user,
  roles,
  onClose,
  squadhireMatch,
  squadhireAdminUrl,
}: {
  user: UserWithRole;
  roles: Role[];
  onClose: () => void;
  squadhireMatch?: { talent_user_id: string; name: string };
  squadhireAdminUrl?: string | null;
}) {
  const queryClient = useQueryClient();
  const originalUserType = ((user as any).user_type as string) || 'internal';
  const [name, setName] = useState(user.display_name);
  const [email, setEmail] = useState(user.email);
  const [userType, setUserType] = useState<string>(originalUserType);
  const [roleId, setRoleId] = useState(user.custom_role?.id || '');
  const [secondaryRoleIds, setSecondaryRoleIds] = useState<string[]>(
    (user.secondary_roles || []).map((r) => r.id),
  );
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
    mutationFn: (payload: { role_id?: string; secondary_role_ids: string[] }) =>
      api.put(`/admin/users/${user.id}/custom-role`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err: any) => {
      setError(err?.response?.data?.error || 'Failed to update role');
    },
  });

  const userTypeMutation = useMutation({
    mutationFn: (newType: string) =>
      api.put(`/admin/users/${user.id}/user-type`, { user_type: newType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    },
    onError: (err: any) => {
      setError(err?.response?.data?.error || 'Failed to update user type');
    },
  });

  const isSaving = profileMutation.isPending || customRoleMutation.isPending || userTypeMutation.isPending;

  const originalSecondaryIds = (user.secondary_roles || []).map((r) => r.id).sort().join(',');
  const currentSecondaryIds = [...secondaryRoleIds].sort().join(',');
  const rolesChanged =
    roleId !== (user.custom_role?.id || '') || currentSecondaryIds !== originalSecondaryIds;

  const handleSave = async () => {
    setError('');
    const profileUpdates: { display_name?: string; email?: string } = {};
    if (name.trim() !== user.display_name) profileUpdates.display_name = name.trim();
    if (email.trim() !== user.email) profileUpdates.email = email.trim();

    try {
      if (Object.keys(profileUpdates).length > 0) {
        await profileMutation.mutateAsync(profileUpdates);
      }
      if (userType !== originalUserType) {
        await userTypeMutation.mutateAsync(userType);
      }
      if (rolesChanged) {
        const payload: { role_id?: string; secondary_role_ids: string[] } = {
          secondary_role_ids: secondaryRoleIds.filter((id) => id !== roleId),
        };
        if (roleId) payload.role_id = roleId;
        await customRoleMutation.mutateAsync(payload);
      }
      close();
    } catch {
      // Error is handled in onError
    }
  };

  const toggleSecondary = (id: string) => {
    if (id === roleId) return;
    setSecondaryRoleIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleSetPrimary = (newPrimaryId: string) => {
    // If the chosen primary was previously a secondary, drop it from secondaries.
    setSecondaryRoleIds((prev) => prev.filter((x) => x !== newPrimaryId));
    setRoleId(newPrimaryId);
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
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-divider bg-surface shadow-2xl transition-transform duration-200 ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-divider px-6 py-4">
          <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-foreground">Edit User</h3>
          <button
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-md text-foreground-dim transition hover:bg-surface-alt hover:text-foreground"
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
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-well text-xl font-semibold text-foreground">
              {user.display_name[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <p className="text-base font-medium text-foreground">{user.display_name}</p>
              <div className="mt-0.5 flex items-center gap-2">
                {(() => {
                  const label = accessLabelFor(user);
                  return (
                    <span className={`inline-block rounded-full px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] font-medium ${accessLabelClass(label)}`}>
                      {label}
                    </span>
                  );
                })()}
                <span className="font-[family-name:var(--font-mono)] text-xs text-foreground-dim">
                  Joined {new Date(user.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            {/* Display Name */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Display Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                className="w-full rounded-md border border-divider-strong bg-surface px-3 py-2.5 text-sm text-foreground placeholder-foreground-dim outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            {/* Email */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-divider-strong bg-surface px-3 py-2.5 text-sm text-foreground placeholder-foreground-dim outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            {/* User Type */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground-muted">User type</label>
              <select
                value={userType}
                onChange={(e) => setUserType(e.target.value)}
                className="w-full rounded-md border border-divider-strong bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-accent focus:ring-1 focus:ring-accent"
              >
                <option value="internal">Internal</option>
                <option value="client">Client</option>
                <option value="client_staff">Client Staff</option>
                <option value="partner">Partner</option>
                <option value="partner_employee">Partner Employee</option>
              </select>
              {userType !== originalUserType && userType !== 'internal' && user.is_admin && (
                <p className="mt-1 text-[11px] text-amber-600">Saving will also remove this user's admin access.</p>
              )}
              {userType !== originalUserType && (
                <p className="mt-1 text-[11px] text-foreground-dim">
                  Workspace role won't change automatically — re-pick a primary role below if needed.
                </p>
              )}
            </div>

            {/* Primary Role */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Primary role</label>
              {roles.length > 0 ? (
                <div className="space-y-1.5">
                  {roles.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => handleSetPrimary(role.id)}
                      className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition ${
                        roleId === role.id
                          ? 'border-accent bg-surface-alt text-foreground'
                          : 'border-divider bg-surface text-foreground-muted hover:border-divider-strong hover:text-foreground'
                      }`}
                    >
                      <span
                        className="inline-block h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: role.color }}
                      />
                      <span className="font-medium">{role.name}</span>
                      {role.is_default && (
                        <span className="ml-auto rounded-full bg-surface-alt px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-foreground-dim">
                          Default
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-foreground-dim">
                  {user.status === 'pending' ? 'User is pending approval' : 'No roles available'}
                </p>
              )}
            </div>

            {/* Secondary Roles */}
            {roles.length > 0 && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground-muted">
                  Secondary roles
                  <span className="ml-1.5 font-normal text-foreground-dim">
                    (extra permissions — unioned with primary)
                  </span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {roles
                    .filter((r) => r.id !== roleId)
                    .map((role) => {
                      const selected = secondaryRoleIds.includes(role.id);
                      return (
                        <button
                          key={role.id}
                          type="button"
                          onClick={() => toggleSecondary(role.id)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                            selected
                              ? 'border-accent bg-surface-alt text-foreground'
                              : 'border-divider bg-surface text-foreground-muted hover:border-divider-strong hover:text-foreground'
                          }`}
                        >
                          <span
                            className="inline-block h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: role.color }}
                          />
                          <span className="font-medium">{role.name}</span>
                          {selected && <span className="text-accent">✓</span>}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Platform Access */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Access</label>
              <div className="rounded-md border border-divider bg-canvas px-3 py-2.5">
                {(() => {
                  const label = accessLabelFor(user);
                  return (
                    <span className={`inline-block rounded-full px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-xs font-medium ${accessLabelClass(label)}`}>
                      {label}
                    </span>
                  );
                })()}
                <p className="mt-1 text-[11px] text-foreground-dim">
                  Use the actions in the table to grant/revoke admin access or ban/unban.
                </p>
              </div>
            </div>
          </div>

          {/* SquadHire link */}
          {squadhireMatch && squadhireAdminUrl && (
            <div className="mt-5 rounded-lg border border-purple-200 bg-purple-50/50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-purple-800">SquadHire Profile</p>
                  <p className="mt-0.5 text-[11px] text-purple-600">
                    Matched as <span className="font-medium">{squadhireMatch.name}</span>
                  </p>
                </div>
                <a
                  href={`${squadhireAdminUrl}/admin/users/${squadhireMatch.talent_user_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 transition"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                  View in SquadHire
                </a>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-divider px-6 py-4">
          <button
            onClick={close}
            className="rounded-md border border-divider-strong px-4 py-2 text-sm text-foreground-muted transition hover:border-divider-strong hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-hover disabled:opacity-50"
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
  squadhireMatch,
  squadhireAdminUrl,
}: {
  user: UserWithRole;
  currentUserId: string;
  roles: Role[];
  onAction: () => void;
  onEdit: (user: UserWithRole) => void;
  squadhireMatch?: { talent_user_id: string; name: string };
  squadhireAdminUrl?: string | null;
}) {
  const queryClient = useQueryClient();
  const isSelf = user.id === currentUserId;
  const isBanned = user.status === 'banned';
  const isSuspended = user.status === 'suspended';

  const roleMutation = useMutation({
    mutationFn: (is_admin: boolean) => api.put(`/admin/users/${user.id}/role`, { is_admin }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-users'] }); onAction(); },
  });

  const banMutation = useMutation({
    mutationFn: (banned: boolean) => api.put(`/admin/users/${user.id}/ban`, { banned }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-users'] }); onAction(); },
  });

  const suspendMutation = useMutation({
    mutationFn: (suspended: boolean) => api.put(`/admin/users/${user.id}/suspend`, { suspended }),
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
    <tr className="border-t border-divider hover:bg-canvas">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-well text-sm font-medium text-foreground">
            {user.display_name[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{user.display_name}</p>
            <p className="text-xs text-foreground-dim">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        {(() => {
          const ut = (user as any).user_type || 'internal';
          const cls =
            ut === 'client' ? 'bg-emerald-50 text-emerald-600' :
            ut === 'client_staff' ? 'bg-teal-50 text-teal-600' :
            ut === 'partner' ? 'bg-purple-50 text-purple-600' :
            ut === 'partner_employee' ? 'bg-violet-50 text-violet-600' :
            'bg-blue-50 text-blue-600';
          return (
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
              {userTypeLabel(ut)}
            </span>
          );
        })()}
      </td>
      <td className="px-4 py-3">
        {(() => {
          const label = accessLabelFor(user);
          return (
            <span className={`inline-block rounded-full px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-xs font-medium ${accessLabelClass(label)}`}>
              {label}
            </span>
          );
        })()}
      </td>
      <td className="px-4 py-3">
        {user.custom_role ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded bg-surface-alt px-1.5 py-0.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: user.custom_role.color }}
              />
              <span className="text-xs text-foreground">{user.custom_role.name}</span>
            </span>
            {(user.secondary_roles || []).map((sr) => (
              <span
                key={sr.id}
                className="inline-flex items-center gap-1 rounded border border-dashed border-divider-strong px-1.5 py-0.5"
                title="Secondary role"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: sr.color }}
                />
                <span className="text-[10px] text-foreground-muted">{sr.name}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-foreground-dim">{user.status === 'pending' ? 'Pending' : '—'}</span>
        )}
      </td>
      <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-sm text-foreground-muted">{date}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(user)}
            className="rounded-md border border-divider-strong bg-transparent px-2.5 py-1 text-xs text-foreground-muted hover:border-divider-strong hover:text-foreground"
          >
            Edit
          </button>
          {squadhireMatch && squadhireAdminUrl && (
            <a
              href={`${squadhireAdminUrl}/admin/users/${squadhireMatch.talent_user_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 transition"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              SquadHire
            </a>
          )}
          {!isSelf && (
            <>
              {!isBanned && !isSuspended && (
                <button
                  onClick={() => roleMutation.mutate(!user.is_admin)}
                  disabled={roleMutation.isPending}
                  className="rounded-md border border-divider-strong bg-transparent px-2.5 py-1 text-xs text-foreground-muted hover:border-divider-strong hover:text-foreground disabled:opacity-50"
                >
                  {user.is_admin ? 'Remove Admin' : 'Make Admin'}
                </button>
              )}
              {!isBanned && (
                <button
                  onClick={() => suspendMutation.mutate(!isSuspended)}
                  disabled={suspendMutation.isPending}
                  className={`rounded-md px-2.5 py-1 text-xs disabled:opacity-50 ${
                    isSuspended
                      ? 'bg-green-50 text-green-600 hover:bg-green-100'
                      : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
                  }`}
                >
                  {isSuspended ? 'Unsuspend' : 'Suspend'}
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
          {isSelf && <span className="text-xs text-foreground-dim">You</span>}
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
  const [userTypeFilter, setUserTypeFilter] = useState<string>('all');
  const [editingUser, setEditingUser] = useState<UserWithRole | null>(null);

  const authState = JSON.parse(localStorage.getItem('squadhub-admin-auth') || '{}');
  const currentUserId = authState?.state?.user?.id || '';

  const { data: usersRes, isLoading } = useQuery({
    queryKey: ['admin-users', search, page, userTypeFilter],
    queryFn: () => {
      const params = new URLSearchParams({ search, page: String(page), limit: '20' });
      if (userTypeFilter !== 'all') params.set('user_type', userTypeFilter);
      return api.get(`/admin/users?${params}`).then((r) => r.data);
    },
  });

  const { data: rolesRes } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api.get('/admin/roles').then((r) => r.data),
  });

  const users: UserWithRole[] = usersRes?.data || [];
  const roles: Role[] = rolesRes?.data || [];
  const total: number = usersRes?.total || 0;
  const totalPages = Math.ceil(total / 20);

  const { adminUrl, configured: shConfigured } = useSquadhireConfig();

  const partnerEmails = useMemo(
    () =>
      users
        .filter((u) => {
          const ut = (u as any).user_type;
          return ut === 'partner' || ut === 'partner_employee';
        })
        .map((u) => u.email),
    [users],
  );
  const { matches: shMatches } = useSquadhireUserLookup(partnerEmails, shConfigured);

  const refreshStats = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">Users ({total})</h2>
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by name or email..."
          className="w-full rounded-md border border-divider-strong bg-surface px-3 py-2 text-sm text-foreground placeholder-foreground-dim outline-none focus:border-accent focus:ring-1 focus:ring-accent sm:w-72"
        />
      </div>

      {/* User type filter */}
      <div className="mb-4 flex gap-1">
        {(['all', 'internal', 'client', 'client_staff', 'partner', 'partner_employee'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setUserTypeFilter(tab); setPage(1); }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              userTypeFilter === tab
                ? 'bg-ink text-white'
                : 'bg-surface text-foreground-muted hover:bg-canvas'
            }`}
          >
            {tab === 'all' ? 'All' : userTypeLabel(tab)}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-divider bg-surface">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-foreground-dim">Loading users...</p>
        ) : users.length === 0 ? (
          <p className="py-8 text-center text-sm text-foreground-dim">No users found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-divider bg-canvas">
                  <th className="px-4 py-3 font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">User</th>
                  <th className="px-4 py-3 font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Type</th>
                  <th className="px-4 py-3 font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Access</th>
                  <th className="px-4 py-3 font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Role</th>
                  <th className="px-4 py-3 font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Joined</th>
                  <th className="px-4 py-3 font-[family-name:var(--font-mono)] text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-muted">Actions</th>
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
                    squadhireMatch={shMatches[user.email]}
                    squadhireAdminUrl={adminUrl}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2 border-t border-divider px-4 py-3">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="rounded-md border border-divider-strong bg-transparent px-3 py-1.5 text-sm text-foreground-muted hover:border-divider-strong hover:text-foreground disabled:opacity-40"
            >
              Previous
            </button>
            <span className="font-[family-name:var(--font-mono)] text-sm text-foreground-muted">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-divider-strong bg-transparent px-3 py-1.5 text-sm text-foreground-muted hover:border-divider-strong hover:text-foreground disabled:opacity-40"
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
          squadhireMatch={shMatches[editingUser.email]}
          squadhireAdminUrl={adminUrl}
        />
      )}
    </div>
  );
}
