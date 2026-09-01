import { useEffect, useMemo, useRef, useState } from 'react';
import type { ServerToClientEvents } from '@squadhub/shared';
import { connectSocket } from '../../../services/socket';
import { useAuthStore } from '../../../stores/authStore';
import { useWorkspaceStore, type ChatKind } from '../../../stores/workspaceStore';

type TypingEvent = Parameters<ServerToClientEvents['user_typing']>[0];

export interface TypingUser {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
}

function matchesConversation(
  data: Pick<TypingEvent, 'channel_id' | 'dm_conversation_id' | 'parent_message_id'>,
  conversationId: string,
  kind: ChatKind,
  parentMessageId?: string,
) {
  const sameConversation = kind === 'dm'
    ? data.dm_conversation_id === conversationId
    : data.channel_id === conversationId;
  return sameConversation && (data.parent_message_id || undefined) === parentMessageId;
}

/** Live typing state with a safety expiry for dropped stop events. */
export function useTypingUsers(conversationId: string, kind: ChatKind, parentMessageId?: string) {
  const meId = useAuthStore((s) => s.user?.id);
  const dm = useWorkspaceStore((s) =>
    kind === 'dm' ? s.dmConversations.find((item) => item.id === conversationId) : undefined,
  );
  const dmNames = useMemo(
    () => new Map((dm?.participants || []).map((user) => [user.id, user.display_name])),
    [dm],
  );
  const [users, setUsers] = useState<Map<string, TypingUser>>(() => new Map());
  const expiryTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!conversationId) return;
    const socket = connectSocket();

    const remove = (userId: string) => {
      const timer = expiryTimers.current.get(userId);
      if (timer) clearTimeout(timer);
      expiryTimers.current.delete(userId);
      setUsers((current) => {
        if (!current.has(userId)) return current;
        const next = new Map(current);
        next.delete(userId);
        return next;
      });
    };

    const onTyping = (data: TypingEvent) => {
      if (data.user_id === meId || !matchesConversation(data, conversationId, kind, parentMessageId)) return;
      const existingTimer = expiryTimers.current.get(data.user_id);
      if (existingTimer) clearTimeout(existingTimer);
      setUsers((current) => {
        const next = new Map(current);
        next.set(data.user_id, {
          id: data.user_id,
          displayName: data.display_name || dmNames.get(data.user_id) || 'Someone',
          avatarUrl: data.avatar_url,
        });
        return next;
      });
      // Network changes can swallow a stop event. Never leave a stale “typing”
      // label on screen indefinitely.
      expiryTimers.current.set(data.user_id, setTimeout(() => remove(data.user_id), 4500));
    };

    const onStop = (data: Parameters<ServerToClientEvents['user_stop_typing']>[0]) => {
      if (matchesConversation(data, conversationId, kind, parentMessageId)) remove(data.user_id);
    };

    const onMessage = (message: Parameters<ServerToClientEvents['new_message']>[0]) => {
      const sameConversation = kind === 'dm'
        ? message.dm_conversation_id === conversationId
        : message.channel_id === conversationId;
      if (sameConversation && (message.parent_message_id || undefined) === parentMessageId) {
        remove(message.sender_id);
      }
    };

    socket.on('user_typing', onTyping);
    socket.on('user_stop_typing', onStop);
    socket.on('new_message', onMessage);
    return () => {
      socket.off('user_typing', onTyping);
      socket.off('user_stop_typing', onStop);
      socket.off('new_message', onMessage);
      expiryTimers.current.forEach(clearTimeout);
      expiryTimers.current.clear();
      setUsers(new Map());
    };
  }, [conversationId, kind, parentMessageId, meId, dmNames]);

  return Array.from(users.values());
}

function hashGradient(id: string) {
  let hue = 0;
  for (let i = 0; i < id.length; i += 1) hue = (hue * 31 + id.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 65% 45%))`;
}

export default function TypingIndicator({ users }: { users: TypingUser[] }) {
  if (users.length === 0) return null;

  const names = users.map((user) => user.displayName);
  const label = names.length === 1
    ? `${names[0]} is typing`
    : names.length === 2
      ? `${names[0]} and ${names[1]} are typing`
      : `${names[0]}, ${names[1]} and ${names.length - 2} more are typing`;

  return (
    <div className="sqc-typing" role="status" aria-live="polite" aria-label={`${label}…`}>
      <span className="sqc-typing__avatars" aria-hidden="true">
        {users.slice(0, 3).map((user) => (
          <span key={user.id} className="sqc-typing__avatar" style={{ background: hashGradient(user.id) }}>
            {user.avatarUrl
              ? <img src={user.avatarUrl} alt="" />
              : (user.displayName[0] || '?').toUpperCase()}
          </span>
        ))}
      </span>
      <span className="sqc-typing__bubble" aria-hidden="true">
        <i /><i /><i />
      </span>
      <span className="sqc-typing__label">{label}<span aria-hidden="true">…</span></span>
    </div>
  );
}
