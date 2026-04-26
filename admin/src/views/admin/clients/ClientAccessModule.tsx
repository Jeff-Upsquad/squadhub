import { useState, useEffect, useCallback } from 'react';
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

export default function ClientAccessModule() {
  const [selected, setSelected] = useState<ClientAccessEntry | null>(null);

  const { data: clients, isLoading } = useQuery<ClientAccessEntry[]>({
    queryKey: ['admin-client-access'],
    queryFn: async () => {
      const res = await api.get('/admin/client-access');
      return res.data.data;
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[#0F172B]">Client Access</h1>
        <p className="mt-1 text-sm text-[#62748E]">
          Share clients with users so they show up under the Clients module. The role you pick comes from the Roles module.
        </p>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-[#90A1B9]">Loading…</p>
      ) : !clients || clients.length === 0 ? (
        <div className="rounded-lg border border-[#E2E8F0] bg-white py-12 text-center">
          <p className="text-sm text-[#90A1B9]">No clients yet. Create one in the Clients tab.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {clients.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className="flex w-full items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-5 py-4 text-left transition hover:shadow-sm"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F1F5F9] text-sm font-semibold uppercase text-[#62748E]">
                  {c.business_name.slice(0, 2)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#0F172B]">{c.business_name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        c.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {c.status}
                    </span>
                  </div>
                  {c.contact_person && (
                    <p className="mt-0.5 text-xs text-[#90A1B9]">{c.contact_person}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-[#62748E]">
                {c.user_access_count > 0 ? (
                  <>
                    <span>
                      {c.user_access_count} user{c.user_access_count !== 1 ? 's' : ''}
                    </span>
                    <span className="text-[#0F172B]">→</span>
                  </>
                ) : (
                  <span className="text-[#90A1B9]">No access assigned</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && <AccessSlider client={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function AccessSlider({ client, onClose }: { client: ClientAccessEntry; onClose: () => void }) {
  const qc = useQueryClient();
  const [userSearch, setUserSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const { data: cur } = useQuery<ClientAccessEntry>({
    queryKey: ['admin-client-access', client.id],
    queryFn: async () => {
      const res = await api.get(`/admin/client-access/${client.id}`);
      return res.data.data;
    },
    initialData: client,
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
    qc.invalidateQueries({ queryKey: ['admin-client-access', client.id] });
    qc.invalidateQueries({ queryKey: ['admin-client-access'] });
  };

  const addUser = useMutation({
    mutationFn: (body: { user_id: string; role_id: string }) =>
      api.post(`/admin/client-access/${client.id}/users`, body),
    onSuccess: invalidate,
  });
  const removeUser = useMutation({
    mutationFn: (userId: string) => api.delete(`/admin/client-access/${client.id}/users/${userId}`),
    onSuccess: invalidate,
  });

  const onKey = useCallback((e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }, [onClose]);
  useEffect(() => {
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onKey]);

  const assignedIds = new Set((cur?.user_access || []).map((ua) => ua.user_id));
  const filteredUsers = (allUsers || [])
    .filter((u) => !assignedIds.has(u.id))
    .filter(
      (u) =>
        !userSearch ||
        u.display_name.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.email.toLowerCase().includes(userSearch.toLowerCase()),
    );

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[480px] flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
          <div>
            <h3 className="font-[family-name:var(--font-display)] text-base font-semibold text-[#0F172B]">
              {cur?.business_name}
            </h3>
            <p className="mt-0.5 text-xs text-[#90A1B9]">Users with access to this client</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-[#90A1B9] hover:bg-[#F1F5F9] hover:text-[#0F172B]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!showAdd ? (
            <button
              onClick={() => setShowAdd(true)}
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
                placeholder="Search by name or email…"
                className="mb-2 w-full rounded-md border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs focus:border-[#0F172B] focus:outline-none"
              />
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {filteredUsers.length === 0 ? (
                  <p className="py-2 text-xs text-[#90A1B9]">No users found</p>
                ) : (
                  filteredUsers.slice(0, 20).map((user) => {
                    const roleId = defaultRoleForUserType(user.user_type);
                    const role = allRoles.find((r) => r.id === roleId);
                    return (
                      <div key={user.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-white">
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#62748E]">
                            {user.display_name?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-[#0F172B]">{user.display_name}</div>
                            <div className="truncate text-[10px] text-[#90A1B9]">{user.email}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-medium text-[#62748E]">
                            {role && (
                              <span
                                className="inline-block h-1.5 w-1.5 rounded-full"
                                style={{ background: role.color }}
                              />
                            )}
                            {role?.name || 'No role'}
                          </span>
                          <button
                            disabled={addUser.isPending}
                            onClick={() => addUser.mutate({ user_id: user.id, role_id: roleId })}
                            className="rounded bg-[#0F172B] px-2 py-1 text-[10px] font-medium text-white hover:bg-[#1E293B] disabled:opacity-50"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <button onClick={() => { setShowAdd(false); setUserSearch(''); }} className="mt-2 text-[10px] text-[#90A1B9] hover:text-[#0F172B]">
                Cancel
              </button>
            </div>
          )}

          {(() => {
            const grouped = USER_TYPE_SECTIONS.map((s) => ({
              ...s,
              users: (cur?.user_access || []).filter((ua) => s.match(ua.user?.user_type)),
            }));
            const total = grouped.reduce((n, s) => n + s.users.length, 0);

            if (total === 0) {
              return <p className="py-6 text-center text-xs text-[#90A1B9]">No users have access yet</p>;
            }

            return (
              <div className="space-y-5">
                {grouped.map((section) => (
                  <div key={section.key}>
                    <div className="mb-2 flex items-center gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#90A1B9]">
                        {section.label}
                      </p>
                      <span className="rounded-full bg-[#F1F5F9] px-1.5 py-0.5 text-[10px] font-medium text-[#62748E]">
                        {section.users.length}
                      </span>
                    </div>
                    {section.users.length === 0 ? (
                      <p className="py-2 text-[10px] text-[#90A1B9]">No users</p>
                    ) : (
                      <div className="space-y-1.5">
                        {section.users.map((ua) => (
                          <div key={ua.id} className="flex items-center justify-between rounded-lg border border-[#E2E8F0] px-3 py-2.5">
                            <div className="flex min-w-0 flex-1 items-center gap-2.5">
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E2E8F0] text-[10px] font-medium text-[#62748E]">
                                {ua.user?.display_name?.[0]?.toUpperCase() || '?'}
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-[#0F172B]">{ua.user?.display_name || 'Unknown'}</div>
                                <div className="truncate text-[10px] text-[#90A1B9]">{ua.user?.email || ''}</div>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-medium text-[#62748E]">
                                {ua.role && (
                                  <span
                                    className="inline-block h-1.5 w-1.5 rounded-full"
                                    style={{ background: ua.role.color }}
                                  />
                                )}
                                {ua.role?.name || 'No role'}
                              </span>
                              <button
                                onClick={() => removeUser.mutate(ua.user_id)}
                                className="rounded p-1 text-[#90A1B9] transition hover:bg-red-50 hover:text-red-500"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    </>
  );
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
