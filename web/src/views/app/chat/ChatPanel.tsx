import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import { getSocket } from '../../../services/socket';
import type { Message } from '@squadhub/shared';
import MessageBubble, { DateSeparator } from './MessageBubble';
import MessageComposer from './MessageComposer';
import ThreadPanel from './ThreadPanel';
import { useWorkspaceStore, type ChatKind } from '../../../stores/workspaceStore';

// ---- Format date for separator ----
function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export default function ChatPanel({ channelId, kind = 'channel' }: { channelId: string; kind?: ChatKind }) {
  const queryClient = useQueryClient();
  const activeThreadParentId = useWorkspaceStore((s) => s.activeThreadParentId);
  const setActiveThread = useWorkspaceStore((s) => s.setActiveThread);

  // Stable param so cache keys & GET URL stay consistent.
  const param = kind === 'dm' ? 'dm_conversation_id' : 'channel_id';
  const queryKey = useMemo(() => ['messages', kind, channelId], [kind, channelId]);

  const { data: messagesRes } = useQuery({
    queryKey,
    queryFn: () => api.get(`/messages?${param}=${channelId}`).then((r) => r.data),
    enabled: !!channelId,
    refetchInterval: false,
  });

  // Listen for real-time messages on the same channel/DM room.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.emit('join_channel', channelId);

    const handleNewMessage = () => {
      queryClient.invalidateQueries({ queryKey });
    };
    const handleReaction = () => {
      queryClient.invalidateQueries({ queryKey });
    };

    socket.on('new_message', handleNewMessage);
    socket.on('new_reaction', handleReaction);
    socket.on('thread_reply', handleNewMessage);
    return () => {
      socket.emit('leave_channel', channelId);
      socket.off('new_message', handleNewMessage);
      socket.off('new_reaction', handleReaction);
      socket.off('thread_reply', handleNewMessage);
    };
  }, [channelId, queryClient, queryKey]);

  const messages: Message[] = messagesRes?.data || [];

  // Hide thread replies from the main timeline — they live in the thread panel.
  const topLevelMessages = useMemo(
    () => messages.filter((m) => !m.parent_message_id),
    [messages],
  );

  // Group messages with date separators
  const messagesWithDates = useMemo(() => {
    const items: { type: 'date' | 'message'; date?: string; message?: Message }[] = [];
    let lastDate = '';

    topLevelMessages.forEach((msg) => {
      const msgDate = new Date(msg.created_at).toDateString();
      if (msgDate !== lastDate) {
        items.push({ type: 'date', date: formatDateLabel(msg.created_at) });
        lastDate = msgDate;
      }
      items.push({ type: 'message', message: msg });
    });

    return items;
  }, [topLevelMessages]);

  return (
    <div className="flex flex-1 overflow-hidden bg-white dark:bg-surface">
      {/* Main message column */}
      <div className="flex flex-1 flex-col">
        {/* Scrollable messages area */}
        <div className="flex flex-1 flex-col gap-[10px] overflow-y-auto">
          {topLevelMessages.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-foreground-dim">No messages yet. Say something!</p>
          )}
          {messagesWithDates.map((item, i) =>
            item.type === 'date' ? (
              <DateSeparator key={`date-${i}`} date={item.date!} />
            ) : (
              <MessageBubble
                key={item.message!.id}
                message={item.message!}
                onOpenThread={() => setActiveThread(item.message!.id)}
              />
            )
          )}
        </div>
        {/* Composer pinned to bottom */}
        <MessageComposer
          channelId={channelId}
          kind={kind}
          onSend={() => queryClient.invalidateQueries({ queryKey })}
        />
      </div>

      {/* Thread panel */}
      {activeThreadParentId && (
        <ThreadPanel
          parentId={activeThreadParentId}
          channelId={channelId}
          kind={kind}
          onClose={() => setActiveThread(null)}
        />
      )}
    </div>
  );
}
