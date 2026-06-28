import { useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Channel } from '@squadhub/shared';
import api from '../../services/api';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useChatSidePanelStore } from '../../stores/chatSidePanelStore';

type ContainerType = 'space' | 'folder' | 'list';

interface Props {
  resourceType: ContainerType;
  resourceId: string;
  /** Container name — shown as the side-panel subtitle / link label. */
  name: string;
  /** The user's access level on this container (manager → may link/create). */
  accessLevel?: string | null;
  /** Optional positioning (e.g. marginLeft: 'auto' to float right in a tabs row). */
  style?: CSSProperties;
}

const ChatIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.84L3 20l1.05-3.15A7.6 7.6 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
    />
  </svg>
);

/**
 * "Chat" button shown in a list/folder/space header. When a channel is linked it
 * opens that channel in the wide ChatSidePanel; when none is linked, managers get
 * a popover to link an existing channel or create a new one, and everyone else
 * sees a disabled placeholder.
 */
export default function ContainerChatButton({ resourceType, resourceId, name, accessLevel, style }: Props) {
  const open = useChatSidePanelStore((s) => s.open);
  const activePanelChannelId = useChatSidePanelStore((s) => (s.isOpen ? s.channelId : null));
  const myRole = useWorkspaceStore((s) => s.currentWorkspace?.my_role);
  const canManage = myRole === 'admin' || myRole === 'super_admin' || accessLevel === 'manager';
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: linked } = useQuery<Channel | null>({
    queryKey: ['linked-channel', resourceType, resourceId],
    queryFn: async () => {
      const res = await api.get(`/channels/linked?resource_type=${resourceType}&resource_id=${resourceId}`);
      return res.data.data ?? null;
    },
    enabled: !!resourceId,
  });

  if (linked) {
    return (
      <button
        type="button"
        className="lv-tab"
        style={style}
        data-active={activePanelChannelId === linked.id}
        onClick={() => open({ channelId: linked.id, containerLabel: name })}
        title={`Open #${linked.name}`}
      >
        <ChatIcon />
        Chat
      </button>
    );
  }

  if (!canManage) {
    return (
      <button type="button" className="lv-tab" style={{ ...style, opacity: 0.45, cursor: 'default' }} disabled title="No chat linked">
        <ChatIcon />
        Chat
      </button>
    );
  }

  return (
    <>
      <button type="button" className="lv-tab" style={style} onClick={() => setPickerOpen(true)} title="Link or create a chat">
        <ChatIcon />
        Chat
      </button>
      {pickerOpen && (
        <LinkChannelModal
          resourceType={resourceType}
          resourceId={resourceId}
          name={name}
          onClose={() => setPickerOpen(false)}
          onLinked={(ch) => {
            setPickerOpen(false);
            open({ channelId: ch.id, containerLabel: name });
          }}
        />
      )}
    </>
  );
}

function LinkChannelModal({
  resourceType,
  resourceId,
  name,
  onClose,
  onLinked,
}: {
  resourceType: ContainerType;
  resourceId: string;
  name: string;
  onClose: () => void;
  onLinked: (channel: Channel) => void;
}) {
  const qc = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id ?? null);
  const channels = useWorkspaceStore((s) => s.channels);
  const [newName, setNewName] = useState(slugify(name));
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');

  // Only offer channels that aren't already linked to a container.
  const linkable = channels
    .filter((c) => !c.linked_resource_id)
    .filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()));

  const link = useMutation({
    mutationFn: async (body: { channel_id?: string; create?: { name: string } }) => {
      const res = await api.post('/channels/link', { resource_type: resourceType, resource_id: resourceId, ...body });
      return res.data.data as Channel;
    },
    onSuccess: (ch) => {
      qc.invalidateQueries({ queryKey: ['linked-channel', resourceType, resourceId] });
      if (workspaceId) qc.invalidateQueries({ queryKey: ['channels', workspaceId] });
      onLinked(ch);
    },
    onError: (err: any) => setError(err.response?.data?.error || 'Failed to link channel'),
  });

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl border border-divider bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-base font-semibold text-foreground">Add chat</h3>
        <p className="mb-4 text-xs text-foreground-dim">Link a channel to “{name}”. Everyone with access gets added.</p>
        {error && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

        {/* Create new */}
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-foreground-dim">Create new</label>
        <div className="mb-4 flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="channel-name"
            className="min-w-0 flex-1 rounded-md border border-divider bg-surface-alt px-3 py-2 text-sm text-foreground placeholder-foreground-dim focus:border-accent focus:outline-none"
          />
          <button
            onClick={() => newName && !link.isPending && link.mutate({ create: { name: newName } })}
            disabled={!newName || link.isPending}
            className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-surface transition hover:opacity-90 disabled:opacity-50"
          >
            Create
          </button>
        </div>

        {/* Link existing */}
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-foreground-dim">Or link existing</label>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search channels…"
          className="mb-2 w-full rounded-md border border-divider bg-surface-alt px-3 py-1.5 text-sm text-foreground placeholder-foreground-dim focus:border-accent focus:outline-none"
        />
        <div className="max-h-44 overflow-y-auto rounded-md border border-divider">
          {linkable.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-foreground-dim">No unlinked channels</div>
          ) : (
            linkable.map((c) => (
              <button
                key={c.id}
                onClick={() => !link.isPending && link.mutate({ channel_id: c.id })}
                disabled={link.isPending}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition hover:bg-surface-alt disabled:opacity-50"
              >
                <span className="text-foreground-dim">#</span>
                <span className="truncate">{c.name}</span>
              </button>
            ))
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-md border border-divider px-4 py-2 text-sm text-foreground-muted transition hover:text-foreground">
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'chat'
  );
}
