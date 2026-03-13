import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import { getSocket } from '../../../services/socket';
import type { Message } from '@squadhub/shared';
import MessageBubble from './MessageBubble';
import MessageComposer from './MessageComposer';

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

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-y-auto py-4">
        {messages.length === 0 && (
          <p className="px-5 text-sm text-gray-500">No messages yet. Say something!</p>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>
      <MessageComposer
        channelId={channelId}
        onSend={() => queryClient.invalidateQueries({ queryKey: ['messages', channelId] })}
      />
    </div>
  );
}
