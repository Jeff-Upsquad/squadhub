import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { useMemberships, useAddMember, useUpdateMemberAccess, useRemoveMember } from '../../../hooks/useMemberships';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import type { ResourceType, AccessLevel } from '@squadhub/shared';

const ACCESS_LEVELS: { value: AccessLevel; label: string; description: string }[] = [
  { value: 'viewer', label: 'View Only', description: 'Can only view' },
  { value: 'commenter', label: 'Comment Only', description: 'Can view and comment' },
  { value: 'member', label: 'Full Access', description: 'Can create, edit and delete tasks' },
  { value: 'manager', label: 'Manager', description: 'Full control including settings' },
];

export default function ManageMembersModal({
  resourceType,
  resourceId,
  resourceName,
  onClose,
}: {
  resourceType: ResourceType;
  resourceId: string;
  resourceName: string;
  onClose: () => void;
}) {
  const workspace = useWorkspaceStore((s) => s.currentWorkspace);
  const { data: members, isLoading } = useMemberships(resourceType, resourceId);
  const addMember = useAddMember(resourceType, resourceId);
  const updateAccess = useUpdateMemberAccess(resourceType, resourceId);
  const removeMember = useRemoveMember(resourceType, resourceId);

  const [showInvite, setShowInvite] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [inviteLevel, setInviteLevel] = useState<AccessLevel>('viewer');
  const [error, setError] = useState('');

  // Fetch workspace members for invite search
  const { data: wsMembers } = useQuery({
    queryKey: ['workspace-members', workspace?.id],
    queryFn: async () => {
      const res = await api.get(`/workspaces/${workspace!.id}/members`);
      return res.data.data;
    },
    enabled: !!workspace && showInvite,
  });

  const existingUserIds = new Set((members || []).map((m) => m.user_id));
  const availableMembers = (wsMembers || [])
    .filter((wm: any) => !existingUserIds.has(wm.user_id))
    .filter((wm: any) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return wm.user?.display_name?.toLowerCase().includes(q) || wm.user?.email?.toLowerCase().includes(q);
    });

  const handleInvite = () => {
    if (!selectedUserId) return;
    setError('');
    addMember.mutate(
      { user_id: selectedUserId, access_level: inviteLevel },
      {
        onSuccess: () => {
          setSelectedUserId(null);
          setSearchQuery('');
          setShowInvite(false);
        },
        onError: (err: any) => setError(err.response?.data?.error || 'Failed to invite'),
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-[#E2E8F0] bg-[#F1F5F9] p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#0F172B] font-[family-name:var(--font-display)]">
            Members — {resourceName}
          </h2>
          <button onClick={onClose} className="text-[#999999] hover:text-[#0F172B]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Invite button */}
        {!showInvite && (
          <button
            onClick={() => setShowInvite(true)}
            className="mb-4 w-full rounded-lg border border-dashed border-[#CAD5E2] px-3 py-2 text-sm text-[#666666] transition hover:border-[#2962FF] hover:text-[#2962FF]"
          >
            + Invite member
          </button>
        )}

        {/* Invite form */}
        {showInvite && (
          <div className="mb-4 rounded-lg border border-[#CAD5E2] bg-[#F8FAFC] p-3">
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search workspace members..."
              className="mb-2 w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-1.5 text-sm text-[#0F172B] placeholder-[#999999] outline-none focus:border-[#2962FF]"
            />

            {/* User list */}
            <div className="mb-2 max-h-32 overflow-y-auto">
              {availableMembers.length === 0 && (
                <p className="px-2 py-1 text-xs text-[#999999]">No members to invite</p>
              )}
              {availableMembers.slice(0, 10).map((wm: any) => (
                <button
                  key={wm.user_id}
                  onClick={() => setSelectedUserId(wm.user_id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                    selectedUserId === wm.user_id
                      ? 'bg-[#2962FF]/10 text-[#2962FF]'
                      : 'text-[#0F172B] hover:bg-white'
                  }`}
                >
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0F172B] text-[10px] font-bold text-white">
                    {wm.user?.display_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <span className="truncate">{wm.user?.display_name}</span>
                  <span className="ml-auto text-xs text-[#999999]">{wm.user?.email}</span>
                </button>
              ))}
            </div>

            {/* Access level dropdown */}
            <div className="mb-2">
              <label className="mb-1 block text-xs font-medium text-[#666666] uppercase tracking-wide">Access Level</label>
              <select
                value={inviteLevel}
                onChange={(e) => setInviteLevel(e.target.value as AccessLevel)}
                className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-1.5 text-sm text-[#0F172B] outline-none focus:border-[#2962FF]"
              >
                {ACCESS_LEVELS.map((al) => (
                  <option key={al.value} value={al.value}>
                    {al.label} — {al.description}
                  </option>
                ))}
              </select>
            </div>

            {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowInvite(false); setSelectedUserId(null); setSearchQuery(''); }}
                className="rounded-md px-3 py-1.5 text-xs text-[#666666] hover:text-[#0F172B]"
              >
                Cancel
              </button>
              <button
                onClick={handleInvite}
                disabled={!selectedUserId || addMember.isPending}
                className="rounded-md bg-[#0F172B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1D293D] disabled:opacity-50"
              >
                {addMember.isPending ? 'Inviting...' : 'Invite'}
              </button>
            </div>
          </div>
        )}

        {/* Member list */}
        <div className="max-h-64 overflow-y-auto">
          {isLoading && <p className="py-2 text-center text-xs text-[#999999]">Loading...</p>}
          {members?.map((member) => (
            <div key={member.id} className="flex items-center gap-3 border-b border-[#E2E8F0] py-2 last:border-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0F172B] text-xs font-bold text-white">
                {member.user?.display_name?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#0F172B] truncate">{member.user?.display_name}</p>
                <p className="text-xs text-[#999999] truncate">{member.user?.email}</p>
              </div>
              <select
                value={member.access_level}
                onChange={(e) =>
                  updateAccess.mutate({ membershipId: member.id, access_level: e.target.value as AccessLevel })
                }
                className="rounded-md border border-[#CAD5E2] bg-white px-2 py-1 text-xs text-[#0F172B] outline-none focus:border-[#2962FF]"
              >
                {ACCESS_LEVELS.map((al) => (
                  <option key={al.value} value={al.value}>{al.label}</option>
                ))}
              </select>
              <button
                onClick={() => removeMember.mutate(member.id)}
                className="rounded p-1 text-[#999999] hover:text-red-500"
                title="Remove member"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          {members?.length === 0 && !isLoading && (
            <p className="py-4 text-center text-xs text-[#999999]">No members yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
