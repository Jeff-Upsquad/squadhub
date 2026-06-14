import { useState, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';

type CrmRole = 'admin' | 'member' | 'guest';
type CrmLevel = 'view' | 'full' | 'admin';

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
interface MemberRow {
  user_id: string;
  membership_role: string;
  user: {
    id: string;
    display_name: string | null;
    email: string | null;
    avatar_url: string | null;
    user_type: string;
  } | null;
  access: { role: CrmRole; enabled: boolean } | null;
  module_levels: Record<string, CrmLevel>;
}

const ROLE_DEFAULT_LEVEL: Record<CrmRole, CrmLevel> = { admin: 'admin', member: 'full', guest: 'view' };
const LEVEL_LABEL: Record<CrmLevel, string> = { view: 'View only', full: 'Full access', admin: 'Admin' };

export default function AdminCrmAccess() {
  const qc = useQueryClient();
  const [pickedWs, setPickedWs] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: wsRes } = useQuery({
    queryKey: ['crm-access-workspaces'],
    queryFn: () => api.get('/admin/crm-access/workspaces').then((r) => r.data),
  });
  const workspaces: Workspace[] = wsRes?.data || [];
  const workspaceId = pickedWs || workspaces[0]?.id || '';

  const { data: modulesRes } = useQuery({
    queryKey: ['crm-access-modules'],
    queryFn: () => api.get('/admin/crm-access/modules').then((r) => r.data),
  });
  const modules: CrmModule[] = modulesRes?.data || [];

  const { data: cfgRes } = useQuery({
    queryKey: ['crm-access-config', workspaceId],
    queryFn: () =>
      api.get('/admin/crm-access/workspace-config', { params: { workspace_id: workspaceId } }).then((r) => r.data),
    enabled: !!workspaceId,
  });
  const enforcementEnabled: boolean = cfgRes?.data?.access_enforcement_enabled ?? false;

  const { data: usersRes, isLoading } = useQuery({
    queryKey: ['crm-access-users', workspaceId],
    queryFn: () =>
      api.get('/admin/crm-access/users', { params: { workspace_id: workspaceId } }).then((r) => r.data),
    enabled: !!workspaceId,
  });
  const members: MemberRow[] = usersRes?.data?.members || [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['crm-access-users', workspaceId] });
    qc.invalidateQueries({ queryKey: ['crm-access-config', workspaceId] });
  };

  const toggleEnforcement = useMutation({
    mutationFn: (enabled: boolean) =>
      api.patch('/admin/crm-access/workspace-config', {
        workspace_id: workspaceId,
        access_enforcement_enabled: enabled,
      }),
    onSuccess: invalidate,
  });

  const setRole = useMutation({
    mutationFn: (v: { user_id: string; role: CrmRole }) =>
      api.post('/admin/crm-access/grant', { user_id: v.user_id, workspace_id: workspaceId, role: v.role }),
    onSuccess: invalidate,
  });

  const setEnabled = useMutation({
    mutationFn: (v: { user_id: string; enabled: boolean }) =>
      api.patch('/admin/crm-access/grant', { user_id: v.user_id, workspace_id: workspaceId, enabled: v.enabled }),
    onSuccess: invalidate,
  });

  const setModuleLevel = useMutation({
    mutationFn: (v: { user_id: string; module: string; level: CrmLevel | null }) =>
      api.put('/admin/crm-access/module-level', {
        user_id: v.user_id,
        workspace_id: workspaceId,
        module: v.module,
        level: v.level,
      }),
    onSuccess: invalidate,
  });

  const onRoleChange = (m: MemberRow, value: string) => {
    if (value === 'none') {
      if (m.access) setEnabled.mutate({ user_id: m.user_id, enabled: false });
    } else {
      setRole.mutate({ user_id: m.user_id, role: value as CrmRole });
    }
  };

  const selectClass =
    'rounded-md border border-[#CAD5E2] bg-white px-2 py-1.5 text-sm text-[#0F172B] outline-none focus:border-[#2962FF]';

  return (
    <div className="p-6">
      <h2 className="mb-1 font-[family-name:var(--font-display)] text-2xl font-bold text-[#0F172B]">CRM Access</h2>
      <p className="mb-6 text-sm text-[#62748E]">
        Control who can use Squad CRM in each workspace, their role, and per-module permission levels.
      </p>

      {/* Workspace + enforcement */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 rounded-lg border border-[#E2E8F0] bg-white p-5">
        <div className="min-w-[220px]">
          <label className="mb-1.5 block text-xs font-medium text-[#62748E]">Workspace</label>
          <select className={selectClass} value={workspaceId} onChange={(e) => setPickedWs(e.target.value)}>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-sm font-medium text-[#0F172B]">Access enforcement</div>
            <div className="text-xs text-[#62748E]">
              {enforcementEnabled
                ? 'On — only granted users can access this workspace.'
                : 'Off — everyone with workspace membership has full access.'}
            </div>
          </div>
          <button
            onClick={() => toggleEnforcement.mutate(!enforcementEnabled)}
            disabled={!workspaceId || toggleEnforcement.isPending}
            className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
              enforcementEnabled ? 'bg-[#2962FF]' : 'bg-[#CAD5E2]'
            }`}
            aria-label="Toggle access enforcement"
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                enforcementEnabled ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {!enforcementEnabled && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
          Enforcement is off for this workspace. Grants below are saved but not applied until you turn enforcement on.
          Turn it on only after every active member has the access they need (existing members were backfilled).
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-[#62748E]">Loading…</p>
      ) : members.length === 0 ? (
        <div className="rounded-lg border border-[#E2E8F0] bg-white p-8 text-center text-sm text-[#62748E]">
          No workspace members found.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#E2E8F0] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left text-xs text-[#62748E]">
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">CRM role</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const role = m.access?.enabled ? m.access.role : 'none';
                const isOpen = expanded === m.user_id;
                return (
                  <Fragment key={m.user_id}>
                    <tr className="border-b border-[#F1F5F9]">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-[#0F172B]">{m.user?.display_name || '—'}</div>
                        <div className="text-xs text-[#62748E]">{m.user?.email || m.user_id}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          className={selectClass}
                          value={role}
                          onChange={(e) => onRoleChange(m, e.target.value)}
                        >
                          <option value="none">No access</option>
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="guest">Guest</option>
                        </select>
                      </td>
                      <td className="px-4 py-2.5">
                        {m.access ? (
                          m.access.enabled ? (
                            <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-600">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                              Revoked
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-[#90A1B9]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => setExpanded(isOpen ? null : m.user_id)}
                          disabled={!m.access?.enabled}
                          className="text-xs font-medium text-[#2962FF] hover:underline disabled:text-[#90A1B9] disabled:no-underline"
                        >
                          {isOpen ? 'Hide modules' : 'Modules'}
                        </button>
                      </td>
                    </tr>
                    {isOpen && m.access?.enabled && (
                      <tr className="border-b border-[#F1F5F9] bg-[#F8FAFC]">
                        <td colSpan={4} className="px-4 py-3">
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                            {modules.map((mod) => {
                              const override = m.module_levels[mod.key];
                              const roleDefault = ROLE_DEFAULT_LEVEL[m.access!.role];
                              return (
                                <div key={mod.key} className="flex items-center justify-between gap-2">
                                  <span className="text-xs text-[#62748E]">{mod.label}</span>
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
        </div>
      )}
    </div>
  );
}
