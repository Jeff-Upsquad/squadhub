'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';

const MODULES = [
  { key: 'sales', label: 'Sales' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'banking', label: 'Banking' },
  { key: 'accountant', label: 'Accounting' },
  { key: 'items', label: 'Items' },
  { key: 'documents', label: 'Documents' },
  { key: 'reports', label: 'Reports' },
];
const ALL_MODULES = MODULES.map((m) => m.key);
const LEVELS = [
  { key: 'full', label: 'Full access' },
  { key: 'view', label: 'View only' },
  { key: 'comment', label: 'Comment only' },
];

interface AccessRow {
  id: string;
  orgId: string;
  userId: string;
  accessLevel: string;
  allowedModules: string[];
  updatedAt: string;
}
interface Workspace {
  id: string;
  name: string;
}
interface UserRow {
  id: string;
  display_name?: string;
  email?: string;
}

export default function AdminSquadbooksAccess() {
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState('');
  const [userId, setUserId] = useState('');
  const [accessLevel, setAccessLevel] = useState('view');
  const [modules, setModules] = useState<string[]>([...ALL_MODULES]);
  const [formError, setFormError] = useState('');

  const { data: wsRes } = useQuery({
    queryKey: ['admin-workspaces'],
    queryFn: () => api.get('/workspaces').then((r) => r.data),
  });
  const { data: usersRes } = useQuery({
    queryKey: ['admin-users-list'],
    queryFn: () => api.get('/admin/users', { params: { limit: 200 } }).then((r) => r.data),
  });
  const { data: grantsRes, isLoading: grantsLoading } = useQuery({
    queryKey: ['squadbooks-access', workspaceId],
    queryFn: () =>
      api.get('/admin/squadbooks-access', { params: { orgId: workspaceId } }).then((r) => r.data),
    enabled: !!workspaceId,
  });

  const workspaces: Workspace[] = wsRes?.data || [];
  const users: UserRow[] = usersRes?.data || [];
  const grants: AccessRow[] = grantsRes?.data || [];

  useEffect(() => {
    if (!workspaceId && workspaces.length) setWorkspaceId(workspaces[0].id);
  }, [workspaces, workspaceId]);

  const userName = (id: string) => {
    const u = users.find((x) => x.id === id);
    return u?.display_name || u?.email || `${id.slice(0, 8)}…`;
  };

  const saveMutation = useMutation({
    mutationFn: (body: {
      orgId: string;
      userId: string;
      accessLevel: string;
      allowedModules: string[];
    }) => api.post('/admin/squadbooks-access', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['squadbooks-access'] });
      setUserId('');
      setFormError('');
    },
    onError: (err: any) => setFormError(err.response?.data?.error || 'Failed to save access'),
  });

  const revokeMutation = useMutation({
    mutationFn: (uid: string) =>
      api.delete('/admin/squadbooks-access', { params: { orgId: workspaceId, userId: uid } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['squadbooks-access'] }),
  });

  const toggleModule = (k: string) =>
    setModules((m) => (m.includes(k) ? m.filter((x) => x !== k) : [...m, k]));

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!workspaceId || !userId) {
      setFormError('Pick a workspace and a user.');
      return;
    }
    saveMutation.mutate({ orgId: workspaceId, userId, accessLevel, allowedModules: modules });
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-lg font-semibold text-[#0F172B]">SquadBooks Access</h1>
      <p className="mt-1 text-sm text-[#62748E]">
        Assign who can use SquadBooks in each workspace, their access level, and which modules they
        can open. Users must also be granted the SquadBooks mini-app under Access Control.
      </p>

      <div className="mt-4">
        <label className="block text-xs font-medium text-[#62748E]">Workspace</label>
        <select
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          className="mt-1 w-72 rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm"
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      <form onSubmit={handleSave} className="mt-5 rounded-lg border border-[#E2E8F0] bg-white p-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#62748E]">User</label>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="mt-1 w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm"
            >
              <option value="">Select a user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name || u.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#62748E]">Access level</label>
            <select
              value={accessLevel}
              onChange={(e) => setAccessLevel(e.target.value)}
              className="mt-1 w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm"
            >
              {LEVELS.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <label className="block text-xs font-medium text-[#62748E]">Modules</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {MODULES.map((m) => (
              <button
                type="button"
                key={m.key}
                onClick={() => toggleModule(m.key)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                  modules.includes(m.key)
                    ? 'border-[#0F172B] bg-[#0F172B] text-white'
                    : 'border-[#CAD5E2] bg-white text-[#62748E]'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {formError && (
          <p className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-600">{formError}</p>
        )}
        <button
          type="submit"
          disabled={saveMutation.isPending}
          className="mt-4 rounded-md bg-[#0F172B] px-4 py-2 text-sm font-medium text-white hover:bg-[#1D293D] disabled:opacity-50"
        >
          Assign access
        </button>
      </form>

      <div className="mt-6 rounded-lg border border-[#E2E8F0] bg-white">
        <div className="border-b border-[#E2E8F0] px-4 py-3 text-sm font-medium text-[#0F172B]">
          Current access
        </div>
        {grantsLoading ? (
          <div className="px-4 py-6 text-sm text-[#62748E]">Loading…</div>
        ) : grants.length === 0 ? (
          <div className="px-4 py-6 text-sm text-[#62748E]">
            No one has SquadBooks access in this workspace yet.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-left text-xs uppercase tracking-wide text-[#90A1B9]">
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">Level</th>
                <th className="px-4 py-2">Modules</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id} className="border-b border-[#F1F5F9]">
                  <td className="px-4 py-2 text-[#0F172B]">{userName(g.userId)}</td>
                  <td className="px-4 py-2 text-[#62748E]">
                    {LEVELS.find((l) => l.key === g.accessLevel)?.label || g.accessLevel}
                  </td>
                  <td className="px-4 py-2 text-[#62748E]">
                    {g.allowedModules.length ? g.allowedModules.join(', ') : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => revokeMutation.mutate(g.userId)}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
