import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import { getSocket } from '../../../services/socket';
import type { Message } from '@squadhub/shared';
import MessageBubble, { DateSeparator } from './MessageBubble';
import MessageComposer, { type MessageComposerHandle } from './MessageComposer';
import ThreadPanel from './ThreadPanel';
import { usePanelFileDrop } from '../pm/usePanelFileDrop';
import { useWorkspaceStore, type ChatKind } from '../../../stores/workspaceStore';
import { useAuthStore } from '../../../stores/authStore';
import { useIsOnline } from '../../../stores/presenceStore';
import type { Notification } from '../InboxView';

// Stable gradient for users without an avatar — same hash as MessageBubble.
function hashGradient(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 65% 45%))`;
}

// ---- Slack-style conversation intros (top of history) ----
function ChannelIntro({ channelId }: { channelId: string }) {
  const channel = useWorkspaceStore((s) => s.channels.find((c) => c.id === channelId));
  if (!channel) return null;
  return (
    <div className="sqc-intro">
      <h2 className="sqc-intro__title">
        <span className="wave">👋</span>
        <span>
          Welcome to the <span className="sqc-intro__hashlink"># {channel.name}</span> channel
        </span>
      </h2>
      <p className="sqc-intro__desc">
        {channel.description ? (
          channel.description
        ) : (
          <>
            This channel is for everything <span className="sqc-intro__hashlink">#{channel.name}</span>.{' '}
            <span className="muted">Hold meetings, share docs, and make decisions together. Keep your team informed!</span>
          </>
        )}
      </p>
    </div>
  );
}

function DmIntro({ dmId }: { dmId: string }) {
  const dm = useWorkspaceStore((s) => s.dmConversations.find((d) => d.id === dmId));
  const meId = useAuthStore((s) => s.user?.id);
  const others = (dm?.participants || []).filter((p) => p.id !== meId);
  const first = others[0];
  const online = useIsOnline(first?.id);
  if (!dm) return null;

  // Note-to-self conversation
  if (others.length === 0) {
    const me = (dm.participants || [])[0];
    return (
      <div className="sqc-intro sqc-intro--dm">
        <span className="sqc-intro__avatar" style={{ background: me?.avatar_url ? undefined : hashGradient(me?.id || 'me') }}>
          {me?.avatar_url ? <img src={me.avatar_url} alt="" /> : (me?.display_name?.[0] || 'Y').toUpperCase()}
        </span>
        <div className="sqc-intro__namerow">
          <span className="sqc-intro__name">{me?.display_name || 'You'} <span className="muted">(you)</span></span>
        </div>
        <p className="sqc-intro__desc muted">
          This is your space. Draft messages, list your to-dos, or keep links and files handy.
        </p>
      </div>
    );
  }

  const names = others.map((p, i) => (
    <span key={p.id}>
      <span className="sqc-mention-chip">@{p.display_name}</span>
      {i < others.length - 1 ? ', ' : ''}
    </span>
  ));

  return (
    <div className="sqc-intro sqc-intro--dm">
      <span className="sqc-intro__avatar" style={{ background: first?.avatar_url ? undefined : hashGradient(first?.id || 'x') }}>
        {first?.avatar_url ? <img src={first.avatar_url} alt="" /> : (first?.display_name?.[0] || '?').toUpperCase()}
      </span>
      <div className="sqc-intro__namerow">
        <span className="sqc-intro__name">
          {others.map((p) => p.display_name).join(', ')}
        </span>
        {others.length === 1 && (
          <span
            className={`sqc-presence${online ? ' is-online' : ''}`}
            title={online ? 'Active' : 'Away'}
          />
        )}
      </div>
      <p className="sqc-intro__desc">
        This conversation is just between {names} and you. Check out {others.length === 1 ? 'their' : 'everyone’s'} profile to
        learn more about them.
      </p>
    </div>
  );
}

// Does this notification belong to the conversation currently on screen?
// DMs match on metadata.dm_conversation_id, channels on metadata.channel_id.
// (message_mention rows carry both keys with the irrelevant one null, so the
// kind-specific check keeps DM and channel notifications from crossing over.)
function notifMatchesConversation(
  n: { metadata?: Record<string, unknown> | null },
  channelId: string,
  kind: ChatKind,
): boolean {
  return kind === 'dm'
    ? n.metadata?.dm_conversation_id === channelId
    : n.metadata?.channel_id === channelId;
}

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
  const meId = useAuthStore((s) => s.user?.id);

  // "Message #design" / "Message Jane D" placeholder, like Slack.
  const channelName = useWorkspaceStore((s) =>
    kind === 'channel' ? s.channels.find((c) => c.id === channelId)?.name : undefined,
  );
  const dmName = useWorkspaceStore((s) => {
    if (kind !== 'dm') return undefined;
    const dm = s.dmConversations.find((d) => d.id === channelId);
    const others = (dm?.participants || []).filter((p) => p.id !== meId);
    return others.map((p) => p.display_name).join(', ');
  });
  const composerPlaceholder =
    kind === 'dm'
      ? dmName
        ? `Message ${dmName}`
        : 'Jot something down'
      : channelName
        ? `Message #${channelName}`
        : undefined;

  // Stable param so cache keys & GET URL stay consistent.
  const param = kind === 'dm' ? 'dm_conversation_id' : 'channel_id';
  const queryKey = useMemo(() => ['messages', kind, channelId], [kind, channelId]);

  const { data: messagesRes } = useQuery({
    queryKey,
    queryFn: () => api.get(`/messages?${param}=${channelId}`).then((r) => r.data),
    enabled: !!channelId,
    refetchInterval: false,
  });

  // Having a conversation on screen counts as reading its messages, so its
  // inbox notifications should clear instead of leaving the bell badge nagging.
  // Asks the server to mark every unread notification for this conversation as
  // read, then optimistically drops the matching rows and refreshes the badge.
  const clearConversationNotifications = useCallback(() => {
    if (!channelId) return;
    const body = kind === 'dm' ? { dm_conversation_id: channelId } : { channel_id: channelId };
    api
      .post('/notifications/read-conversation', body)
      .then(() => {
        queryClient.setQueryData<Notification[]>(['notifications', 'list'], (old) =>
          (old || []).map((n) =>
            !n.is_read && notifMatchesConversation(n, channelId, kind) ? { ...n, is_read: true } : n,
          ),
        );
        queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
        queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
      })
      .catch(() => {
        /* non-critical — the inbox can still be cleared manually */
      });
  }, [channelId, kind, queryClient]);

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
    // A notification that lands for the conversation already on screen has, by
    // definition, already been read — clear it without making the user leave.
    const handleNotification = (n: { metadata?: Record<string, unknown> | null }) => {
      if (notifMatchesConversation(n, channelId, kind)) clearConversationNotifications();
    };

    socket.on('new_message', handleNewMessage);
    socket.on('new_reaction', handleReaction);
    socket.on('thread_reply', handleNewMessage);
    socket.on('message_updated', handleNewMessage);
    socket.on('message_deleted', handleNewMessage);
    socket.on('new_notification', handleNotification);
    return () => {
      socket.emit('leave_channel', channelId);
      socket.off('new_message', handleNewMessage);
      socket.off('new_reaction', handleReaction);
      socket.off('thread_reply', handleNewMessage);
      socket.off('message_updated', handleNewMessage);
      socket.off('message_deleted', handleNewMessage);
      socket.off('new_notification', handleNotification);
    };
  }, [channelId, kind, queryClient, queryKey, clearConversationNotifications]);

  // On open: clear any notifications that piled up while the conversation was
  // closed. Skip the write when the cached inbox already shows nothing to clear.
  useEffect(() => {
    if (!channelId) return;
    const cached = queryClient.getQueryData<Notification[]>(['notifications', 'list']);
    if (cached && !cached.some((n) => !n.is_read && notifMatchesConversation(n, channelId, kind))) return;
    clearConversationNotifications();
  }, [channelId, kind, queryClient, clearConversationNotifications]);

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

  // Keep the view pinned to the newest message: jump on conversation switch
  // and first load, stick to the bottom on new messages unless the user has
  // scrolled up to read history.
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastChannelRef = useRef<string | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || topLevelMessages.length === 0) return;
    const isNewConversation = lastChannelRef.current !== channelId;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (isNewConversation || nearBottom) {
      el.scrollTop = el.scrollHeight;
      lastChannelRef.current = channelId;
    }
  }, [channelId, topLevelMessages]);

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

  // Drag a file anywhere over the conversation to stage it on the composer.
  const composerRef = useRef<MessageComposerHandle>(null);
  const { dragActive, panelHandlers } = usePanelFileDrop((files) => {
    composerRef.current?.addFiles(files);
  });

  return (
    <div className="squadhub-chat flex flex-1 overflow-hidden">
      {/* Main message column */}
      <div className="relative flex flex-1 flex-col min-w-0" {...panelHandlers}>
        {dragActive && (
          <div aria-hidden className="sqc-drop-overlay">
            <div className="sqc-drop-overlay__label">Drop a file to attach</div>
          </div>
        )}
        {/* Scrollable messages area */}
        <div className="sqc-msg-scroll" ref={scrollRef}>
          {/* Slack-style intro at the start of history */}
          {kind === 'dm' ? <DmIntro dmId={channelId} /> : <ChannelIntro channelId={channelId} />}
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
          ref={composerRef}
          channelId={channelId}
          kind={kind}
          placeholder={composerPlaceholder}
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
