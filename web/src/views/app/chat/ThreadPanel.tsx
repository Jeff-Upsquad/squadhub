import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import { getSocket } from '../../../services/socket';
import type { Message } from '@squadhub/shared';
import MessageBubble from './MessageBubble';
import MessageComposer from './MessageComposer';
import type { ChatKind } from '../../../stores/workspaceStore';

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

  const { data: threadRes } = useQuery({
    queryKey,
    queryFn: () => api.get(`/messages/${parentId}/thread`).then((r) => r.data),
    enabled: !!parentId,
  });

  // Refresh on any new_message in this room (covers thread_reply events too).
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = () => queryClient.invalidateQueries({ queryKey });
    socket.on('new_message', handler);
    socket.on('thread_reply', handler);
    socket.on('new_reaction', handler);
    return () => {
      socket.off('new_message', handler);
      socket.off('thread_reply', handler);
      socket.off('new_reaction', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId]);

  const root: Message | null = threadRes?.data?.root || null;
  const replies: Message[] = threadRes?.data?.replies || [];

  return (
    <div className="sqc-thread-panel relative flex w-[420px] shrink-0 flex-col border-l border-divider bg-white dark:bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-divider px-4 py-[10px]">
        <div className="flex flex-col">
          <h3 className="text-[15px] font-bold text-foreground">Thread</h3>
          <p className="text-[11px] text-foreground-muted">{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</p>
        </div>
        <button
          onClick={onClose}
          className="rounded-[4px] p-1 text-foreground-muted hover:bg-surface-alt hover:text-foreground"
          aria-label="Close thread"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scroll area: parent message + divider + replies */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {root && (
          <>
            <MessageBubble message={root} inThread />
            <div className="mx-5 my-2 flex items-center gap-2 text-[11px] text-foreground-muted">
              <span className="h-px flex-1 bg-divider" />
              <span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
              <span className="h-px flex-1 bg-divider" />
            </div>
          </>
        )}
        {replies.map((r) => (
          <MessageBubble key={r.id} message={r} inThread />
        ))}
      </div>

      {/* Composer (posts with parent_message_id) */}
      <MessageComposer
        channelId={channelId}
        kind={kind}
        parentMessageId={parentId}
        onSend={() => queryClient.invalidateQueries({ queryKey })}
      />
    </div>
  );
}
