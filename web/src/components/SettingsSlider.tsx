import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useAuthStore } from '../stores/authStore';
import { useMemberships, useUpdateMemberAccess, useRemoveMember } from '../hooks/useMemberships';
import { useFavorites, useAddFavorite, useRemoveFavorite } from '../hooks/useFavorites';
import { useIsAdmin } from '../hooks/usePermissions';
import { canAtLeast } from '../lib/access';
import ManageMembersModal from '../views/app/pm/ManageMembersModal';
import MoveModal from '../views/app/pm/MoveModal';
import type { ResourceType, AccessLevel, ResourceMembership } from '@squadhub/shared';

type SettingsSliderProps = {
  type: ResourceType;
  id: string;
  name: string;
  description?: string | null;
  spaceId?: string | null;
  folderId?: string | null;
  myAccess?: AccessLevel | null;
  onClose: () => void;
  onDeleted?: () => void;
};

const ACCESS_GROUPS: { value: AccessLevel; label: string }[] = [
  { value: 'manager', label: 'Managers' },
  { value: 'member', label: 'Full access' },
  { value: 'commenter', label: 'Commenters' },
  { value: 'viewer', label: 'Viewers' },
];

const ACCESS_ITEM_LABELS: Record<AccessLevel, string> = {
  manager: 'Manager',
  member: 'Full access',
  commenter: 'Commenter',
  viewer: 'Viewer',
};

export default function SettingsSlider({ type, id, name, description, spaceId, folderId, myAccess, onClose, onDeleted }: SettingsSliderProps) {
  const qc = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const isAdmin = useIsAdmin();
  const [editName, setEditName] = useState(name);
  const [editDesc, setEditDesc] = useState(description || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const { data: members } = useMemberships(type, id);
  const updateAccess = useUpdateMemberAccess(type, id);
  const removeMember = useRemoveMember(type, id);

  const { data: favorites } = useFavorites(workspaceId);
  const addFavorite = useAddFavorite(workspaceId);
  const removeFavorite = useRemoveFavorite(workspaceId);
  const favorite = favorites?.find((f) => f.item_type === type && f.item_id === id);
  const isFavorited = !!favorite;
  const favoritePending = addFavorite.isPending || removeFavorite.isPending;

  const toggleFavorite = () => {
    if (favoritePending) return;
    if (isFavorited && favorite) {
      removeFavorite.mutate(favorite.id);
    } else {
      addFavorite.mutate({ item_type: type, item_id: id });
    }
  };

  const canManage = canAtLeast(myAccess ?? undefined, 'manager') || isAdmin;

  const endpoint = type === 'channel' ? `/channels/${id}` : `/pm/${type}s/${id}`;

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await api.put(endpoint, body);
      return res.data.data;
    },
    onSuccess: () => {
      setSaving(false);
      setError('');
      if (type === 'channel') {
        qc.invalidateQueries({ queryKey: ['channels', workspaceId] });
      } else if (type === 'space') {
        qc.invalidateQueries({ queryKey: ['spaces', workspaceId] });
        qc.invalidateQueries({ queryKey: ['space', id] });
      } else {
        qc.invalidateQueries({ queryKey: ['space', spaceId] });
      }
    },
    onError: (err: any) => {
      setSaving(false);
      setError(err.response?.data?.error || 'Failed to save');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(endpoint);
    },
    onSuccess: () => {
      if (type === 'channel') {
        qc.invalidateQueries({ queryKey: ['channels', workspaceId] });
      } else if (type === 'space') {
        qc.invalidateQueries({ queryKey: ['spaces', workspaceId] });
      } else {
        qc.invalidateQueries({ queryKey: ['space', spaceId] });
      }
      onDeleted?.();
      onClose();
    },
    onError: (err: any) => {
      setError(err.response?.data?.error || 'Failed to delete');
    },
  });

  const handleSave = () => {
    const updates: Record<string, unknown> = {};
    if (editName !== name) updates.name = editName;
    if (editDesc !== (description || '')) updates.description = editDesc || null;
    if (Object.keys(updates).length === 0) return;
    setSaving(true);
    updateMutation.mutate(updates);
  };

  const handleDelete = () => {
    if (confirm(`Delete ${type} "${name}"? It will be moved to trash.`)) {
      deleteMutation.mutate();
    }
  };

  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  const membersByLevel: Record<AccessLevel, ResourceMembership[]> = {
    manager: [], member: [], commenter: [], viewer: [],
  };
  for (const m of members || []) membersByLevel[m.access_level]?.push(m);

  return (
    <div className="flex h-full w-80 shrink-0 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#E2E8F0] px-4 py-3">
        <h3 className="text-sm font-semibold text-[#0F172B] font-[family-name:var(--font-display)]">
          {typeLabel} Settings
        </h3>
        <button
          onClick={onClose}
          className="rounded p-1 text-[#999999] hover:text-[#0F172B]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Favorite toggle */}
        <button
          onClick={toggleFavorite}
          disabled={favoritePending}
          className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition disabled:opacity-50 ${
            isFavorited
              ? 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E] hover:bg-[#FEF3C7]'
              : 'border-[#CAD5E2] bg-white text-[#0F172B] hover:bg-[#F1F5F9]'
          }`}
          aria-pressed={isFavorited}
        >
          <svg
            className="h-4 w-4 shrink-0"
            viewBox="0 0 24 24"
            fill={isFavorited ? '#F59E0B' : 'none'}
            stroke={isFavorited ? '#F59E0B' : 'currentColor'}
            strokeWidth={isFavorited ? 0 : 1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          <span className="flex-1 text-left">
            {isFavorited ? 'Remove from favorites' : 'Add to favorites'}
          </span>
        </button>

        {/* Move — lists and folders only */}
        {(type === 'list' || type === 'folder') && canManage && spaceId && (
          <button
            onClick={() => setShowMove(true)}
            className="flex w-full items-center gap-2 rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-xs font-medium text-[#0F172B] transition hover:bg-[#F1F5F9]"
          >
            <svg
              className="h-4 w-4 shrink-0 text-[#64748B]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              <path d="M10 13l3-3m0 0l-3-3m3 3H6" />
            </svg>
            <span className="flex-1 text-left">Move {type === 'list' ? 'list' : 'folder'}...</span>
          </button>
        )}

        {/* Name */}
        <div>
          <label className="mb-1 block text-xs font-medium text-[#666666] uppercase tracking-wide">Name</label>
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
          />
        </div>

        {/* Description */}
        {(type === 'channel' || type === 'space') && (
          <div>
            <label className="mb-1 block text-xs font-medium text-[#666666] uppercase tracking-wide">Description</label>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm text-[#0F172B] outline-none resize-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
              placeholder={`Add a description for this ${type}...`}
            />
          </div>
        )}

        {/* Save button */}
        {(editName !== name || editDesc !== (description || '')) && (
          <button
            onClick={handleSave}
            disabled={saving || !editName.trim()}
            className="w-full rounded-md bg-[#0F172B] px-3 py-2 text-xs font-medium text-white hover:bg-[#1D293D] disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        )}

        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}

        {/* Sharing — inline member list grouped by access level */}
        <div className="border-t border-[#E2E8F0] pt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-[#666666] uppercase tracking-wide">
              Sharing · {(members || []).length}
            </p>
            {canManage && (
              <button
                onClick={() => setShowInvite(true)}
                className="rounded p-1 text-[#666666] transition hover:bg-white hover:text-[#2962FF]"
                title="Invite members"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            )}
          </div>

          <div className="space-y-3">
            {ACCESS_GROUPS.map((g) => {
              const rows = membersByLevel[g.value];
              if (!rows || rows.length === 0) return null;
              return (
                <div key={g.value}>
                  <p className="mb-1 text-[10px] font-semibold text-[#999999] uppercase tracking-wider">
                    {g.label} · {rows.length}
                  </p>
                  <div className="space-y-0.5">
                    {rows.map((m) => (
                      <MemberRow
                        key={m.id}
                        member={m}
                        isMe={m.user_id === currentUserId}
                        canManage={canManage}
                        onChangeAccess={(level) => updateAccess.mutate({ membershipId: m.id, access_level: level })}
                        onRemove={() => {
                          if (confirm(`Remove ${m.user?.display_name || 'this member'} from the ${type}?`)) {
                            removeMember.mutate(m.id);
                          }
                        }}
                      />
                    ))}
                  </div>
    </div>
  );
}

function SubscriptionCardSection({ folderId }: { folderId: string }) {
  const qc = useQueryClient();
  const [codeInput, setCodeInput] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);

  const { data: linkStatus } = useQuery({
    queryKey: ['folder-link-status', folderId],
    queryFn: () => import('../services/api').then((m) => m.default.get(`/pm/folders/${folderId}/link-status`).then((r) => r.data?.data)),
  });

  const hoursLinked = linkStatus?.linked ?? false;
  const cardCode = linkStatus?.card_code ?? null;

  const linkMutation = useMutation({
    mutationFn: (code: string) =>
      import('../services/api').then((m) =>
        m.default.post(`/pm/folders/${folderId}/link-to-card`, { card_code: code }).then((r) => r.data)
      ),
    onSuccess: () => {
      setShowLinkInput(false);
      setCodeInput('');
      qc.invalidateQueries({ queryKey: ['folder-link-status', folderId] });
    },
  });

  const isPending = linkMutation.isPending;

  return (
    <div className="border-t border-[#E2E8F0] pt-4">
      <p className="mb-2 text-xs font-medium text-[#666666] uppercase tracking-wide">
        Subscription Card
      </p>

      {hoursLinked ? (
        <div className="space-y-3">
          <p className="text-xs text-[#999999]">
            Linked card: <span className="font-mono text-[#0F172B]">{cardCode}</span>
          </p>

          <div>
            <label className="mb-1 block text-[10px] font-medium text-[#666666] uppercase tracking-wide">
              Billing Start Date
            </label>
            <p className="mb-1 text-[10px] text-[#999999]">
              First month's hours are prorated based on remaining calendar days.
            </p>
            <input
              type="date"
              defaultValue={linkStatus?.billing_start_date ?? ''}
              onChange={(e) => {
                const val = e.target.value || null;
                import('../services/api').then((m) =>
                  m.default.post(`/pm/folders/${folderId}/billing-start-date`, { billing_start_date: val })
                ).then(() => {
                  qc.invalidateQueries({ queryKey: ['folder-link-status', folderId] });
                });
              }}
              className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
            />
            {linkStatus?.prorated_monthly_hours != null && (
              <p className="mt-1 text-[10px] text-[#999999]">
                Prorated monthly limit: {linkStatus.prorated_monthly_hours}h
              </p>
            )}
          </div>

          <button
            onClick={() => setShowLinkInput(!showLinkInput)}
            className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-xs font-medium text-[#0F172B] transition hover:bg-[#F1F5F9]"
          >
            Change Card
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-[#999999]">No card linked to this space.</p>
          {showLinkInput ? (
            <div className="space-y-2">
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="Paste CARD-XXXXXX code"
                disabled={isPending}
                className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-sm font-mono text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF] disabled:opacity-50"
                onKeyDown={(e) => e.key === 'Enter' && codeInput && linkMutation.mutate(codeInput)}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => codeInput && linkMutation.mutate(codeInput)}
                  disabled={!codeInput || isPending}
                  className="flex-1 rounded-md bg-[#0F172B] px-3 py-2 text-xs font-medium text-white hover:bg-[#1D293D] disabled:opacity-50"
                >
                  {isPending ? 'Linking\u2026' : 'Link'}
                </button>
                <button
                  onClick={() => { setShowLinkInput(false); setCodeInput(''); }}
                  className="rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-xs font-medium text-[#0F172B] hover:bg-[#F1F5F9]"
                >
                  Cancel
                </button>
              </div>
              {linkMutation.isError && (
                <p className="text-xs text-red-600">
                  {(linkMutation.error as any)?.response?.data?.error || 'Link failed'}
                </p>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowLinkInput(true)}
              className="w-full rounded-md border border-[#CAD5E2] bg-white px-3 py-2 text-xs font-medium text-[#0F172B] transition hover:bg-[#F1F5F9]"
            >
              Link to Card
            </button>
          )}
        </div>
      )}
    </div>
  );
}


function MemberRow({
  member,
  isMe,
  canManage,
  onChangeAccess,
  onRemove,
}: {
  member: ResourceMembership;
  isMe: boolean;
  canManage: boolean;
  onChangeAccess: (level: AccessLevel) => void;
  onRemove: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const user = member.user;
  const displayName = user?.display_name || user?.email || 'Unknown';
  const customRole = (user as any)?.custom_role as { id: string; name: string; color: string } | null | undefined;
  const workspaceRole = (user as any)?.workspace_role as string | null | undefined;

  const fallbackRoleLabel = (() => {
    if (!workspaceRole) return null;
    if (workspaceRole === 'super_admin') return 'Super admin';
    return workspaceRole.charAt(0).toUpperCase() + workspaceRole.slice(1);
  })();

  return (
    <div className="group relative flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-white">
      {/* Avatar */}
      {user?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
      ) : (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0F172B] text-[10px] font-bold text-white">
          {displayName[0]?.toUpperCase() || '?'}
        </div>
      )}

      {/* Name + you marker */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-[#0F172B]">
          {displayName}
          {isMe && <span className="ml-1 text-[#999999]">· You</span>}
        </p>
      </div>

      {/* Role chip */}
      {customRole ? (
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: `${customRole.color}20`, color: customRole.color }}
          title={`Role: ${customRole.name}`}
        >
          {customRole.name}
        </span>
      ) : fallbackRoleLabel ? (
        <span
          className="shrink-0 rounded-full bg-[#E2E8F0] px-1.5 py-0.5 text-[10px] font-medium text-[#666666]"
          title={`Workspace role: ${fallbackRoleLabel}`}
        >
          {fallbackRoleLabel}
        </span>
      ) : null}

      {/* Manage menu */}
      {canManage && (
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded p-0.5 text-[#999999] opacity-0 transition hover:bg-[#E2E8F0] hover:text-[#0F172B] group-hover:opacity-100 aria-expanded:opacity-100"
            aria-expanded={menuOpen}
            title="Manage member"
          >
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-md border border-[#E2E8F0] bg-white py-1 shadow-lg">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#999999]">Change access</p>
              {(['manager', 'member', 'commenter', 'viewer'] as AccessLevel[]).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => {
                    if (lvl !== member.access_level) onChangeAccess(lvl);
                    setMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-2 py-1 text-left text-xs transition hover:bg-[#F1F5F9] ${
                    lvl === member.access_level ? 'text-[#2962FF]' : 'text-[#0F172B]'
                  }`}
                >
                  <span>{ACCESS_ITEM_LABELS[lvl]}</span>
                  {lvl === member.access_level && (
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
              <div className="my-1 border-t border-[#E2E8F0]" />
              <button
                onClick={() => { setMenuOpen(false); onRemove(); }}
                className="w-full px-2 py-1 text-left text-xs text-red-600 transition hover:bg-red-50"
              >
                Remove from list
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
