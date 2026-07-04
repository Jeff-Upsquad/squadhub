import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import { getSocket } from '../../../services/socket';
import type { Message } from '@squadhub/shared';
import MessageBubble from './MessageBubble';
import MessageComposer, { type MessageComposerHandle } from './MessageComposer';
import { usePanelFileDrop } from '../pm/usePanelFileDrop';
import { useWorkspaceStore, type ChatKind } from '../../../stores/workspaceStore';
import { useAuthStore } from '../../../stores/authStore';

interface Props {
  parentId: string;
  channelId: string;
  kind: ChatKind;
  onClose: () => void;
}

// Slack-style thread side panel. Shows the parent message + replies fetched
// via GET /messages/:id/thread. Reuses MessageComposer with `parentMessageId`
// so replies post into the thread automatically.
export default function ThreadPanel({ parentId, channelId, kind, onClose }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ['thread', parentId];

  // Context label under the "Thread" title — "# design" or the DM name.
  const channel = useWorkspaceStore((s) => s.channels.find((c) => c.id === channelId));
  const dm = useWorkspaceStore((s) => s.dmConversations.find((d) => d.id === channelId));
  const meId = useAuthStore((s) => s.user?.id);
  const dmOthers = (dm?.participants || []).filter((p) => p.id !== meId);
  const contextLabel =
    kind === 'dm'
      ? dmOthers.map((p) => p.display_name).join(', ') || 'Conversation'
      : channel
        ? `# ${channel.name}`
        : '';

  const { data: threadRes } = useQuery({
    queryKey,
    queryFn: () => api.get(`/messages/${parentId}/thread`).then((r) => r.data),
    enabled: !!parentId,
  });

  // Refresh on any new_message in this room (covers thread_reply events too).
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    // A reply for this thread carries the whole row — append it immediately so it
    // shows without a refetch round-trip, then reconcile in the background. Edits,
    // deletes and reactions send partial payloads, so those just refetch.
    const handleReply = (message?: Message) => {
      if (message?.id && message.parent_message_id === parentId) {
        queryClient.setQueryData<{ data?: { root: Message | null; replies: Message[] } }>(queryKey, (old) => {
          if (!old?.data) return old;
          if (old.data.replies?.some((m) => m.id === message.id)) return old;
          return { ...old, data: { ...old.data, replies: [...(old.data.replies || []), message] } };
        });
      }
      queryClient.invalidateQueries({ queryKey });
    };
    const handleMutated = () => queryClient.invalidateQueries({ queryKey });
    socket.on('new_message', handleReply);
    socket.on('thread_reply', handleReply);
    socket.on('new_reaction', handleMutated);
    socket.on('message_updated', handleMutated);
    socket.on('message_deleted', handleMutated);
    return () => {
      socket.off('new_message', handleReply);
      socket.off('thread_reply', handleReply);
      socket.off('new_reaction', handleMutated);
      socket.off('message_updated', handleMutated);
      socket.off('message_deleted', handleMutated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId]);

  const root: Message | null = threadRes?.data?.root || null;
  const replies: Message[] = threadRes?.data?.replies || [];

  // Drag a file anywhere over the thread panel to stage it on the reply composer
  // (mirrors the main ChatPanel behaviour).
  const composerRef = useRef<MessageComposerHandle>(null);
  const { dragActive, panelHandlers } = usePanelFileDrop((files) => {
    composerRef.current?.addFiles(files);
  });

  // Keep the thread pinned to the newest reply: jump to the bottom when the
  // thread opens and stick there as replies arrive, unless the reader has
  // scrolled up to read history. Mirrors the main ChatPanel behaviour.
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastParentRef = useRef<string | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !root) return;
    const isNewThread = lastParentRef.current !== parentId;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (isNewThread || nearBottom) {
      el.scrollTop = el.scrollHeight;
      lastParentRef.current = parentId;
    }
  }, [parentId, root, replies.length]);

  return (
    <div
      className="sqc-thread-panel relative flex w-[400px] shrink-0 flex-col border-l border-divider bg-white dark:bg-surface"
      {...panelHandlers}
    >
      {dragActive && (
        <div aria-hidden className="sqc-drop-overlay">
          <div className="sqc-drop-overlay__label">Drop a file to attach</div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between border-b border-divider px-4 py-[9px]">
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="text-[18px] font-extrabold leading-tight text-foreground">Thread</h3>
          {contextLabel && (
            <span className="truncate text-[13px] text-foreground-muted">{contextLabel}</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded-[6px] p-1.5 text-foreground-muted hover:bg-surface-alt hover:text-foreground"
          aria-label="Close thread"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scroll area: parent message + divider + replies */}
      <div ref={scrollRef} className="flex flex-1 flex-col overflow-y-auto pb-3">
        {root && (
          <>
            <div className="pt-2">
              <MessageBubble message={root} inThread />
            </div>
            {replies.length > 0 && (
              <div className="sqc-thread-divider">
                {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
              </div>
            )}
          </>
        )}
        {replies.map((r) => (
          <MessageBubble key={r.id} message={r} inThread />
        ))}
      </div>

      {/* Composer (posts with parent_message_id) */}
      <MessageComposer
        ref={composerRef}
        channelId={channelId}
        kind={kind}
        parentMessageId={parentId}
        placeholder="Reply…"
        onSend={() => queryClient.invalidateQueries({ queryKey })}
      />
    </div>
  );
}
