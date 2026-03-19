import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useAuthStore } from '../../stores/authStore';
import type { Workspace } from '@squadhub/shared';

interface MemberWithUser {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  user: {
    id: string;
    email: string;
    display_name: string;
    avatar_url: string | null;
    created_at: string;
  };
}

const ROLES = ['super_admin', 'admin', 'member', 'guest'] as const;

function roleBadgeColor(role: string) {
  switch (role) {
    case 'super_admin': return 'bg-purple-500/15 text-purple-400';
    case 'admin': return 'bg-blue-500/15 text-blue-400';
    case 'guest': return 'bg-[#222] text-[#888]';
    default: return 'bg-green-500/15 text-green-400';
  }
}

export default function WsAdminMembers() {
  const { currentWorkspace, setWorkspace } = useWorkspaceStore();
  const currentUser = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('member');
  const [inviteError, setInviteError] = useState('');

  // Fetch workspaces and auto-select first one if none selected
  const { data: workspacesRes } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api.get('/workspaces').then((r) => r.data),
  });

  useEffect(() => {
    const workspaces: Workspace[] = workspacesRes?.data || [];
    if (!currentWorkspace && workspaces.length > 0) {
      setWorkspace(workspaces[0]);
    }
  }, [workspacesRes, currentWorkspace, setWorkspace]);

  const wsId = currentWorkspace?.id;

  const { data: members, isLoading } = useQuery<MemberWithUser[]>({
    queryKey: ['workspace-members', wsId],
    queryFn: async () => {
      const res = await api.get(`/workspaces/${wsId}/members`);
      return res.data.data;
    },
    enabled: !!wsId,
  });

  const inviteMember = useMutation({
    mutationFn: async (body: { email: string; role: string }) => {
      const res = await api.post(`/workspaces/${wsId}/members`, body);
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-members', wsId] });
      setInviteEmail('');
      setInviteError('');
    },
    onError: (err: any) => {
      setInviteError(err.response?.data?.error || 'Failed to invite');
    },
  });

  const updateRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await api.put(`/workspaces/${wsId}/members/${userId}`, { role });
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-members', wsId] });
    },
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      await api.delete(`/workspaces/${wsId}/members/${userId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-members', wsId] });
    },
  });

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteError('');
    inviteMember.mutate({ email: inviteEmail.trim(), role: inviteRole });
  };

  if (!currentWorkspace) {
    return <p className="text-[#555]">Loading workspace...</p>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="mb-6 text-2xl font-semibold text-[#ededed]">Members</h2>

      {/* Invite form */}
      <form onSubmit={handleInvite} className="mb-6 rounded-lg border border-[#222] bg-[#111] p-5">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-[#888]">Invite Member</h3>
        <div className="flex gap-3">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="user@example.com"
            className="flex-1 rounded-md border border-[#333] bg-[#0a0a0a] px-3 py-2 text-sm text-[#ededed] placeholder-[#555] outline-none focus:border-[#ededed]"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="rounded-md border border-[#333] bg-[#0a0a0a] px-3 py-2 text-sm text-[#ededed] outline-none"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="guest">Guest</option>
          </select>
          <button
            type="submit"
            disabled={!inviteEmail.trim() || inviteMember.isPending}
            className="rounded-md bg-[#ededed] px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-white disabled:opacity-50"
          >
            {inviteMember.isPending ? 'Inviting...' : 'Invite'}
          </button>
        </div>
        {inviteError && <p className="mt-2 text-sm text-red-400">{inviteError}</p>}
      </form>

      {/* Members list */}
      <div className="rounded-lg border border-[#222] bg-[#111]">
        <div className="border-b border-[#222] px-5 py-3">
          <span className="text-sm font-medium text-[#888]">
            {members?.length || 0} members
          </span>
        </div>

        {isLoading ? (
          <p className="p-5 text-sm text-[#555]">Loading members...</p>
        ) : (
          <div className="divide-y divide-[#222]/50">
            {members?.map((m) => (
              <div key={m.user_id} className="flex items-center gap-4 px-5 py-3">
                {/* Avatar */}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#222] text-sm font-medium text-[#888]">
                  {m.user.avatar_url ? (
                    <img src={m.user.avatar_url} className="h-9 w-9 rounded-full" alt="" />
                  ) : (
                    (m.user.display_name || m.user.email)?.[0]?.toUpperCase()
                  )}
                </div>

                {/* Name & email */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#ededed]">
                    {m.user.display_name || 'No name'}
                    {m.user_id === currentUser?.id && (
                      <span className="ml-1.5 text-xs text-[#555]">(you)</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-[#555]">{m.user.email}</p>
                </div>

                {/* Role */}
                <select
                  value={m.role}
                  onChange={(e) => updateRole.mutate({ userId: m.user_id, role: e.target.value })}
                  disabled={m.user_id === currentUser?.id}
                  className={`rounded-full border-0 px-2.5 py-0.5 text-xs font-medium outline-none ${roleBadgeColor(m.role)} ${
                    m.user_id === currentUser?.id ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                  }`}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r.replace('_', ' ')}
                    </option>
                  ))}
                </select>

                {/* Remove */}
                {m.user_id !== currentUser?.id && (
                  <button
                    onClick={() => removeMember.mutate(m.user_id)}
                    className="rounded p-1 text-[#555] hover:bg-[#1a1a1a] hover:text-red-400"
                    title="Remove member"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
