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

  // Build a client-side thread index from the loaded messages, so the
  // "N replies · Last reply …" footer works even if the server's denormalized
  // reply_count isn't populated yet.
  const threadIndex = useMemo(() => {
    type Entry = { count: number; participants: Array<{ id: string; display_name?: string | null; avatar_url?: string | null }>; lastReplyAt: string };
    const map = new Map<string, Entry>();
    for (const m of messages as Array<Message & { sender?: { id: string; display_name?: string | null; avatar_url?: string | null } }>) {
      const pid = m.parent_message_id;
      if (!pid) continue;
      let entry = map.get(pid);
      if (!entry) {
        entry = { count: 0, participants: [], lastReplyAt: m.created_at };
        map.set(pid, entry);
      }
      entry.count += 1;
      if (m.created_at > entry.lastReplyAt) entry.lastReplyAt = m.created_at;
      if (m.sender && entry.participants.length < 5 && !entry.participants.find((p) => p.id === m.sender!.id)) {
        entry.participants.push(m.sender);
      }
    }
    return map;
  }, [messages]);

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

  // Tag a message as "grouped" when the prior visible message is from the
  // same author and within 5 minutes — matches the Slack-style stacking.
  const isGrouped = (idx: number) => {
    if (idx === 0) return false;
    const prev = messagesWithDates[idx - 1];
    const cur = messagesWithDates[idx];
    if (!prev || prev.type !== 'message' || cur.type !== 'message') return false;
    if (prev.message!.sender_id !== cur.message!.sender_id) return false;
    const dt = new Date(cur.message!.created_at).getTime() - new Date(prev.message!.created_at).getTime();
    return dt >= 0 && dt < 5 * 60 * 1000;
  };

  return (
    <div className="squadhub-chat flex flex-1 overflow-hidden">
      {/* Main message column */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Scrollable messages area */}
        <div className="sqc-msg-scroll">
          {topLevelMessages.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-[var(--sh-text-2)]">No messages yet. Say something!</p>
          )}
          {messagesWithDates.map((item, i) =>
            item.type === 'date' ? (
              <DateSeparator key={`date-${i}`} date={item.date!} />
            ) : (
              <MessageBubble
                key={item.message!.id}
                message={item.message!}
                grouped={isGrouped(i)}
                threadMeta={threadIndex.get(item.message!.id)}
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
