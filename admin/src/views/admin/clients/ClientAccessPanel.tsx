'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import type { User, Role } from '@squadhub/shared';

interface ClientUserAccessRow {
  id: string;
  user_id: string;
  role_id: string | null;
  user: {
    id: string;
    display_name: string;
    email: string;
    avatar_url: string | null;
    user_type: string;
  } | null;
  role: { id: string; name: string; color: string; is_system?: boolean } | null;
}

interface ClientAccessEntry {
  id: string;
  business_name: string;
  contact_person: string | null;
  status: string;
  user_access_count: number;
  user_access: ClientUserAccessRow[];
}

const KNOWN_USER_TYPES = ['client', 'client_staff', 'internal', 'partner', 'partner_employee'];
const USER_TYPE_SECTIONS: {
  key: string;
  label: string;
  match: (t: string | null | undefined) => boolean;
}[] = [
  { key: 'client',           label: 'Client User',      match: (t) => t === 'client' },
  { key: 'client_staff',     label: 'Client Staff',     match: (t) => t === 'client_staff' },
  { key: 'internal',         label: 'Squad Manager',    match: (t) => t === 'internal' },
  { key: 'partner',          label: 'Partner Users',    match: (t) => t === 'partner' },
  { key: 'partner_employee', label: 'Partner Employees', match: (t) => t === 'partner_employee' },
  { key: 'other',            label: 'Other Users',      match: (t) => !KNOWN_USER_TYPES.includes(t ?? '') },
];

/**
 * Embeddable access manager for one client — the per-client portion of the old
 * Client Access module, lifted out of its fixed drawer so it can live inside the
 * client detail's "Access" tab. Grants are shared with users + a role; the user
 * then sees the client in their sidebar (Areas / Shared with me).
 */
export default function ClientAccessPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [userSearch, setUserSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const { data: cur, isLoading } = useQuery<ClientAccessEntry>({
    queryKey: ['admin-client-access', clientId],
    queryFn: async () => {
      const res = await api.get(`/admin/client-access/${clientId}`);
      return res.data.data;
    },
  });

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ['all-users-for-access'],
    queryFn: async () => {
      const res = await api.get('/admin/users');
      return res.data.data;
    },
    enabled: showAdd,
  });

  const { data: allRoles = [] } = useQuery<Role[]>({
    queryKey: ['all-roles'],
    queryFn: async () => {
      const res = await api.get('/admin/roles');
      return res.data.data;
    },
  });

  const squadManagerRoleId = (allRoles.find((r) => r.name === 'Squad Manager') || {}).id || '';
  const clientUserRoleId = (allRoles.find((r) => r.name === 'Client User') || {}).id || '';

  const defaultRoleForUserType = (userType: string | null | undefined): string => {
    if (userType === 'internal') return squadManagerRoleId;
    if (userType === 'client' || userType === 'client_staff') return clientUserRoleId;
    return '';
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-client-access', clientId] });
    qc.invalidateQueries({ queryKey: ['admin-client-access'] });
  };

  const addUser = useMutation({
    mutationFn: (body: { user_id: string; role_id: string }) =>
      api.post(`/admin/client-access/${clientId}/users`, body),
    onSuccess: invalidate,
  });
  const removeUser = useMutation({
    mutationFn: (userId: string) => api.delete(`/admin/client-access/${clientId}/users/${userId}`),
    onSuccess: invalidate,
  });

  const assignedIds = new Set((cur?.user_access || []).map((ua) => ua.user_id));
  const filteredUsers = (allUsers || [])
    .filter((u) => !assignedIds.has(u.id))
    .filter(
      (u) =>
        !userSearch ||
        u.display_name.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.email.toLowerCase().includes(userSearch.toLowerCase()),
    );

  const grouped = USER_TYPE_SECTIONS.map((s) => ({
    ...s,
    users: (cur?.user_access || []).filter((ua) => s.match(ua.user?.user_type)),
  }));
  const total = grouped.reduce((n, s) => n + s.users.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">
          Access {total > 0 ? `· ${total} user${total !== 1 ? 's' : ''}` : ''}
        </h4>
      </div>
      <p className="text-xs text-foreground-muted">
        Share this client with users so it shows up in their sidebar. The role you pick comes from the Roles module.
      </p>

      {!showAdd ? (
        <button
          onClick={() => setShowAdd(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-divider-strong py-2 text-xs font-medium text-foreground-muted transition hover:border-ink hover:text-foreground"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add User
        </button>
      ) : (
        <div className="rounded-lg border border-divider bg-surface-alt p-3">
          <input
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="mb-2 w-full rounded-md border border-divider bg-surface px-3 py-1.5 text-xs focus:border-ink focus:outline-none"
          />
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {filteredUsers.length === 0 ? (
              <p className="py-2 text-xs text-foreground-dim">No users found</p>
            ) : (
              filteredUsers.slice(0, 20).map((user) => {
                const roleId = defaultRoleForUserType(user.user_type);
                const role = allRoles.find((r) => r.id === roleId);
                return (
                  <div key={user.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-surface">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-well text-[10px] font-medium text-foreground-muted">
                        {user.display_name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-foreground">{user.display_name}</div>
                        <div className="truncate text-[10px] text-foreground-dim">{user.email}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-foreground-muted">
                        {role && (
                          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: role.color }} />
                        )}
                        {role?.name || 'No role'}
                      </span>
                      <button
                        disabled={addUser.isPending}
                        onClick={() => addUser.mutate({ user_id: user.id, role_id: roleId })}
                        className="rounded bg-ink px-2 py-1 text-[10px] font-medium text-white hover:bg-ink-hover disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <button onClick={() => { setShowAdd(false); setUserSearch(''); }} className="mt-2 text-[10px] text-foreground-dim hover:text-foreground">
            Cancel
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="py-6 text-center text-xs text-foreground-dim">Loading…</p>
      ) : total === 0 ? (
        <p className="py-6 text-center text-xs text-foreground-dim">No users have access yet</p>
      ) : (
        <div className="space-y-5">
          {grouped.filter((s) => s.users.length > 0).map((section) => (
            <div key={section.key}>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground-dim">{section.label}</p>
                <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted">
                  {section.users.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {section.users.map((ua) => (
                  <div key={ua.id} className="flex items-center justify-between rounded-lg border border-divider px-3 py-2.5">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-well text-[10px] font-medium text-foreground-muted">
                        {ua.user?.display_name?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{ua.user?.display_name || 'Unknown'}</div>
                        <div className="truncate text-[10px] text-foreground-dim">{ua.user?.email || ''}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-foreground-muted">
                        {ua.role && (
                          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: ua.role.color }} />
                        )}
                        {ua.role?.name || 'No role'}
                      </span>
                      <button
                        onClick={() => removeUser.mutate(ua.user_id)}
                        className="rounded p-1 text-foreground-dim transition hover:bg-red-50 hover:text-red-500"
                        aria-label="Remove access"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
