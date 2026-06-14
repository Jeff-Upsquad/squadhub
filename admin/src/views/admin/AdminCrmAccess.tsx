import { useState, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';

type CrmRole = 'admin' | 'member' | 'guest';
type CrmLevel = 'view' | 'full' | 'admin' | 'none';

interface Workspace {
  id: string;
  name: string;
}
interface CrmModule {
  app: string;
  key: string;
  label: string;
  sort: number;
}
interface UserLite {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  user_type: string;
}
interface GrantedRow {
  user_id: string;
  user: UserLite | null;
  access: { role: CrmRole; enabled: boolean };
  module_levels: Record<string, CrmLevel>;
}

const ROLE_DEFAULT_LEVEL: Record<CrmRole, CrmLevel> = { admin: 'admin', member: 'full', guest: 'view' };
const LEVEL_LABEL: Record<CrmLevel, string> = { view: 'View only', full: 'Full access', admin: 'Admin', none: 'No access' };

export default function AdminCrmAccess() {
  const qc = useQueryClient();
  const [pickedWs, setPickedWs] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [app, setApp] = useState<'squadcrm' | 'squadhire'>('squadcrm');
  // Add-user source: existing workspace members, or — for SquadHire CRM only —
  // anyone in the SquadHub directory (provisioned into SquadHire on add).
  const [addSource, setAddSource] = useState<'members' | 'directory'>('members');
  const [dirRole, setDirRole] = useState<CrmRole>('member');

  const { data: wsRes } = useQuery({
    queryKey: ['crm-access-workspaces', app],
    queryFn: () => api.get('/admin/crm-access/workspaces', { params: { app } }).then((r) => r.data),
  });
  const workspaces: Workspace[] = wsRes?.data || [];
  const workspaceId = pickedWs || workspaces[0]?.id || '';

  const { data: modulesRes } = useQuery({
    queryKey: ['crm-access-modules', app],
    queryFn: () => api.get('/admin/crm-access/modules', { params: { app } }).then((r) => r.data),
  });
  const modules: CrmModule[] = modulesRes?.data || [];

  const { data: cfgRes } = useQuery({
    queryKey: ['crm-access-config', app, workspaceId],
    queryFn: () =>
      api
        .get('/admin/crm-access/workspace-config', { params: { workspace_id: workspaceId, app } })
        .then((r) => r.data),
    enabled: !!workspaceId,
  });
  const enforcementEnabled: boolean = cfgRes?.data?.access_enforcement_enabled ?? false;

  const { data: usersRes, isLoading } = useQuery({
    queryKey: ['crm-access-users', app, workspaceId],
    queryFn: () =>
      api.get('/admin/crm-access/users', { params: { workspace_id: workspaceId, app } }).then((r) => r.data),
    enabled: !!workspaceId,
  });
  const members: GrantedRow[] = usersRes?.data?.members || [];

  const { data: candRes } = useQuery({
    queryKey: ['crm-access-candidates', app, workspaceId, search],
    queryFn: () =>
      api
        .get('/admin/crm-access/candidates', { params: { workspace_id: workspaceId, q: search, app } })
        .then((r) => r.data),
    enabled: !!workspaceId && adding && addSource === 'members',
  });
  const candidates: UserLite[] = candRes?.data || [];

  // SquadHub directory (internal staff). Only relevant for SquadHire CRM, which
  // keeps its own accounts — picking someone here provisions them into SquadHire.
  const { data: dirRes, isFetching: dirLoading } = useQuery({
    queryKey: ['crm-access-directory', search],
    queryFn: () =>
      api
        .get('/admin/users', { params: { search, user_type: 'internal', limit: 20 } })
        .then((r) => r.data),
    enabled: adding && addSource === 'directory' && app === 'squadhire',
  });
  const directory: UserLite[] = dirRes?.data || [];
  // Emails already granted, so the directory can show "Added" instead of "Add".
  const grantedEmails = new Set(
    members.map((m) => (m.user?.email || '').toLowerCase()).filter(Boolean),
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['crm-access-users', app, workspaceId] });
    qc.invalidateQueries({ queryKey: ['crm-access-candidates', app, workspaceId] });
  };

  const toggleEnforcement = useMutation({
    mutationFn: (enabled: boolean) =>
      api.patch('/admin/crm-access/workspace-config', {
        workspace_id: workspaceId,
        access_enforcement_enabled: enabled,
        app,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-access-config', app, workspaceId] }),
  });

  const addUser = useMutation({
    mutationFn: (v: { user_id: string; role: CrmRole }) =>
      api.post('/admin/crm-access/grant', { user_id: v.user_id, workspace_id: workspaceId, role: v.role, app }),
    onSuccess: invalidate,
  });

  // Provision a SquadHub directory person into SquadHire CRM, then grant. The
  // backend finds-or-creates the SquadHire account by email (idempotent).
  const provisionUser = useMutation({
    mutationFn: (v: { email: string; display_name: string | null; role: CrmRole }) =>
      api.post('/admin/crm-access/provision-and-grant', {
        email: v.email,
        display_name: v.display_name ?? undefined,
        workspace_id: workspaceId,
        app,
        role: v.role,
      }),
    onSuccess: invalidate,
  });

  const setRole = useMutation({
    mutationFn: (v: { user_id: string; role: CrmRole }) =>
      api.patch('/admin/crm-access/grant', { user_id: v.user_id, workspace_id: workspaceId, role: v.role, app }),
    onSuccess: invalidate,
  });

  const removeUser = useMutation({
    mutationFn: (user_id: string) =>
      api.delete('/admin/crm-access/grant', { data: { user_id, workspace_id: workspaceId, app } }),
    onSuccess: invalidate,
  });

  const setModuleLevel = useMutation({
    mutationFn: (v: { user_id: string; module: string; level: CrmLevel | null }) =>
      api.put('/admin/crm-access/module-level', {
        user_id: v.user_id,
        workspace_id: workspaceId,
        module: v.module,
        level: v.level,
        app,
      }),
    onSuccess: invalidate,
  });

  const selectClass =
    'rounded-md border border-divider-strong bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent';

  return (
    <div className="p-6">
      <h2 className="mb-1 font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">CRM Access</h2>
      <p className="mb-6 text-sm text-foreground-muted">
        Add people to Squad CRM and set their role + per-module permission levels. Only people you add appear here.
      </p>

      {/* Workspace + enforcement */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 rounded-lg border border-divider bg-surface p-5">
        <div className="min-w-[150px]">
          <label className="mb-1.5 block text-xs font-medium text-foreground-muted">App</label>
          <select
            className={selectClass}
            value={app}
            onChange={(e) => {
              setApp(e.target.value as 'squadcrm' | 'squadhire');
              setPickedWs('');
              setAdding(false);
              setExpanded(null);
              setAddSource('members');
            }}
          >
            <option value="squadcrm">Squad CRM</option>
            <option value="squadhire">SquadHire CRM</option>
          </select>
        </div>
        <div className="min-w-[220px]">
          <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Workspace</label>
          <select
            className={selectClass}
            value={workspaceId}
            onChange={(e) => {
              setPickedWs(e.target.value);
              setAdding(false);
              setExpanded(null);
            }}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-sm font-medium text-foreground">Access enforcement</div>
            <div className="text-xs text-foreground-muted">
              {enforcementEnabled
                ? 'On — only people added below can use the CRM here.'
                : 'Off — everyone with workspace membership has full access.'}
            </div>
          </div>
          <button
            onClick={() => toggleEnforcement.mutate(!enforcementEnabled)}
            disabled={!workspaceId || toggleEnforcement.isPending}
            className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
              enforcementEnabled ? 'bg-accent' : 'bg-well'
            }`}
            aria-label="Toggle access enforcement"
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface transition ${
                enforcementEnabled ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {enforcementEnabled && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
          Enforcement is ON. Anyone not in the list below cannot access the CRM in this workspace.
        </div>
      )}

      {/* Access list */}
      <div className="overflow-hidden rounded-lg border border-divider bg-surface">
        <div className="flex items-center justify-between border-b border-divider px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">
            People with CRM access {members.length > 0 && <span className="text-foreground-dim">({members.length})</span>}
          </h3>
          <button
            onClick={() => {
              setAdding((v) => !v);
              setSearch('');
              setAddSource('members');
            }}
            disabled={!workspaceId}
            className="rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white transition hover:bg-ink-hover disabled:opacity-50"
          >
            {adding ? 'Close' : '+ Add user'}
          </button>
        </div>

        {/* Add-user picker */}
        {adding && (
          <div className="border-b border-divider bg-surface-alt px-4 py-3">
            {/* Source tabs — the SquadHub directory is SquadHire-CRM only */}
            {app === 'squadhire' && (
              <div className="mb-3 flex gap-1 rounded-md border border-divider bg-surface p-1 text-xs">
                {(
                  [
                    ['members', 'SquadHire members'],
                    ['directory', 'SquadHub directory'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setAddSource(key);
                      setSearch('');
                    }}
                    className={`flex-1 rounded px-3 py-1.5 font-medium transition ${
                      addSource === key ? 'bg-ink text-white' : 'text-foreground-muted hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                addSource === 'directory'
                  ? 'Search SquadHub directory by name or email…'
                  : 'Search workspace members by name or email…'
              }
              className="mb-3 w-full rounded-md border border-divider-strong bg-surface px-3 py-2 text-sm text-foreground placeholder-foreground-dim outline-none focus:border-accent"
            />

            {addSource === 'members' ? (
              <>
                <div className="max-h-64 overflow-y-auto rounded-md border border-divider bg-surface">
                  {candidates.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-foreground-dim">
                      {search ? 'No matching members.' : 'All workspace members already have access.'}
                    </p>
                  ) : (
                    candidates.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between border-b border-divider px-3 py-2 last:border-0"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{c.display_name || '—'}</div>
                          <div className="truncate text-xs text-foreground-muted">{c.email || c.id}</div>
                        </div>
                        <button
                          onClick={() => addUser.mutate({ user_id: c.id, role: 'member' })}
                          disabled={addUser.isPending}
                          className="shrink-0 rounded-md border border-divider-strong bg-surface px-3 py-1 text-xs font-medium text-foreground transition hover:bg-canvas disabled:opacity-50"
                        >
                          Add
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <p className="mt-2 text-xs text-foreground-dim">
                  Added as Member with no access to any module — open Modules to grant access per module. New people (no
                  account yet) are invited from the Invitations screen.
                </p>
              </>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs text-foreground-muted">Grant as</span>
                  <select className={selectClass} value={dirRole} onChange={(e) => setDirRole(e.target.value as CrmRole)}>
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="guest">Guest</option>
                  </select>
                </div>
                <div className="max-h-64 overflow-y-auto rounded-md border border-divider bg-surface">
                  {dirLoading ? (
                    <p className="px-3 py-4 text-center text-xs text-foreground-dim">Searching…</p>
                  ) : directory.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-foreground-dim">
                      {search ? 'No matching people.' : 'Type to search the SquadHub directory.'}
                    </p>
                  ) : (
                    directory.map((c) => {
                      const already = !!c.email && grantedEmails.has(c.email.toLowerCase());
                      return (
                        <div
                          key={c.id}
                          className="flex items-center justify-between border-b border-divider px-3 py-2 last:border-0"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">{c.display_name || '—'}</div>
                            <div className="truncate text-xs text-foreground-muted">{c.email || c.id}</div>
                          </div>
                          {already ? (
                            <span className="shrink-0 text-xs font-medium text-foreground-dim">Added</span>
                          ) : (
                            <button
                              onClick={() =>
                                provisionUser.mutate({ email: c.email!, display_name: c.display_name, role: dirRole })
                              }
                              disabled={!c.email || provisionUser.isPending}
                              className="shrink-0 rounded-md border border-divider-strong bg-surface px-3 py-1 text-xs font-medium text-foreground transition hover:bg-canvas disabled:opacity-50"
                            >
                              Add
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="mt-2 text-xs text-foreground-dim">
                  Provisions a new SquadHire login (separate from their SquadHub login) and emails a set-password invite,
                  then grants {dirRole} access. Existing SquadHire accounts are reused.
                </p>
              </>
            )}
          </div>
        )}

        {/* Granted list */}
        {isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-foreground-muted">Loading…</p>
        ) : members.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-foreground-muted">
            No one has CRM access yet. Click <span className="font-medium text-foreground">+ Add user</span> to grant
            access.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-divider text-left text-xs text-foreground-muted">
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">CRM role</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const isOpen = expanded === m.user_id;
                return (
                  <Fragment key={m.user_id}>
                    <tr className="border-b border-divider">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-foreground">{m.user?.display_name || '—'}</div>
                        <div className="text-xs text-foreground-muted">{m.user?.email || m.user_id}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          className={selectClass}
                          value={m.access.role}
                          onChange={(e) => setRole.mutate({ user_id: m.user_id, role: e.target.value as CrmRole })}
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="guest">Guest</option>
                        </select>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => setExpanded(isOpen ? null : m.user_id)}
                          className="mr-3 text-xs font-medium text-accent hover:underline"
                        >
                          {isOpen ? 'Hide modules' : 'Modules'}
                        </button>
                        <button
                          onClick={() => removeUser.mutate(m.user_id)}
                          disabled={removeUser.isPending}
                          className="text-xs font-medium text-red-500 hover:underline disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-divider bg-surface-alt">
                        <td colSpan={3} className="px-4 py-3">
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                            {modules.map((mod) => {
                              const override = m.module_levels[mod.key];
                              const roleDefault = ROLE_DEFAULT_LEVEL[m.access.role];
                              return (
                                <div key={mod.key} className="flex items-center justify-between gap-2">
                                  <span className="text-xs text-foreground-muted">{mod.label}</span>
                                  <select
                                    className={selectClass}
                                    value={override ?? 'default'}
                                    onChange={(e) =>
                                      setModuleLevel.mutate({
                                        user_id: m.user_id,
                                        module: mod.key,
                                        level: e.target.value === 'default' ? null : (e.target.value as CrmLevel),
                                      })
                                    }
                                  >
                                    <option value="default">Default ({LEVEL_LABEL[roleDefault]})</option>
                                    <option value="none">No access</option>
                                    <option value="view">View only</option>
                                    <option value="full">Full access</option>
                                    <option value="admin">Admin</option>
                                  </select>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
