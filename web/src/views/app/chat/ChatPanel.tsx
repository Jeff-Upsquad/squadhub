import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import { getSocket } from '../../../services/socket';
import type { Message } from '@squadhub/shared';
import MessageBubble, { DateSeparator } from './MessageBubble';
import MessageComposer from './MessageComposer';

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

export default function ChatPanel({ channelId }: { channelId: string }) {
  const queryClient = useQueryClient();
  const { data: messagesRes } = useQuery({
    queryKey: ['messages', channelId],
    queryFn: () => api.get(`/messages?channel_id=${channelId}`).then((r) => r.data),
    enabled: !!channelId,
    refetchInterval: false,
  });

  // Listen for real-time messages
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.emit('join_channel', channelId);

    const handleNewMessage = () => {
      queryClient.invalidateQueries({ queryKey: ['messages', channelId] });
    };

    socket.on('new_message', handleNewMessage);
    return () => {
      socket.emit('leave_channel', channelId);
      socket.off('new_message', handleNewMessage);
    };
  }, [channelId, queryClient]);

  const messages: Message[] = messagesRes?.data || [];

  // Group messages with date separators
  const messagesWithDates = useMemo(() => {
    const items: { type: 'date' | 'message'; date?: string; message?: Message }[] = [];
    let lastDate = '';

    messages.forEach((msg) => {
      const msgDate = new Date(msg.created_at).toDateString();
      if (msgDate !== lastDate) {
        items.push({ type: 'date', date: formatDateLabel(msg.created_at) });
        lastDate = msgDate;
      }
      items.push({ type: 'message', message: msg });
    });

    return items;
  }, [messages]);

  return (
    <div className="flex flex-1 flex-col bg-white dark:bg-surface">
      {/* Scrollable messages area */}
      <div className="flex flex-1 flex-col gap-[10px] overflow-y-auto">
        {messages.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-foreground-dim">No messages yet. Say something!</p>
        )}
        {messagesWithDates.map((item, i) =>
          item.type === 'date' ? (
            <DateSeparator key={`date-${i}`} date={item.date!} />
          ) : (
            <MessageBubble key={item.message!.id} message={item.message!} />
          )
        )}
      </div>
      {/* Composer pinned to bottom */}
      <MessageComposer
        channelId={channelId}
        onSend={() => queryClient.invalidateQueries({ queryKey: ['messages', channelId] })}
      />
    </div>
  );
}
