import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import { connectSocket, subscribeToChannelRoom } from '../../../services/socket';
import type { Message } from '@squadhub/shared';
import MessageBubble, { DateSeparator, getActivityMeta } from './MessageBubble';
import MessageComposer, { type MessageComposerHandle } from './MessageComposer';
import ThreadPanel from './ThreadPanel';
import { usePanelFileDrop } from '../pm/usePanelFileDrop';
import { useWorkspaceStore, type ChatKind } from '../../../stores/workspaceStore';
import { useAuthStore } from '../../../stores/authStore';
import { UNREAD_SUMMARY_QUERY_KEY } from '../../../hooks/useUnreadSummary';
import { useIsOnline } from '../../../stores/presenceStore';
import type { Notification } from '../InboxView';
import TypingIndicator, { useTypingUsers } from './TypingIndicator';

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

// A mounted chat is not necessarily being viewed: browsers keep the active
// channel mounted while its tab or window is in the background. Only advance
// read state when the user can actually see and interact with the conversation.
function isConversationActivelyViewed(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
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

export default function ChatPanel({
  channelId,
  kind = 'channel',
  soloGuard = false,
}: {
  channelId: string;
  kind?: ChatKind;
  soloGuard?: boolean;
}) {
  const queryClient = useQueryClient();
  const activeThreadParentId = useWorkspaceStore((s) => s.activeThreadParentId);
  const setActiveThread = useWorkspaceStore((s) => s.setActiveThread);
  const messageJumpTarget = useWorkspaceStore((s) => s.messageJumpTarget);
  const clearMessageJump = useWorkspaceStore((s) => s.clearMessageJump);
  const meId = useAuthStore((s) => s.user?.id);
  const typingUsers = useTypingUsers(channelId, kind);
  const [arrivingMessageIds, setArrivingMessageIds] = useState<Set<string>>(() => new Set());
  const arrivalTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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

  const {
    data: messagesRes,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      api
        .get(
          `/messages?${param}=${channelId}${pageParam ? `&cursor=${encodeURIComponent(pageParam as string)}` : ''}`,
        )
        .then((r) => r.data),
    enabled: !!channelId,
    refetchInterval: false,
    initialPageParam: undefined as string | undefined,
    // "Next page" means *older* messages: page N's cursor is the timestamp of
    // its oldest row, which the server uses as the `created_at <` bound.
    getNextPageParam: (lastPage: { has_more?: boolean; cursor?: string | null }) =>
      lastPage?.has_more ? lastPage.cursor ?? undefined : undefined,
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
      .then(async () => {
        // The same new_notification that triggers this clear also makes
        // useBrowserNotifications refetch the inbox list. That GET can be issued
        // before the server marks the row read and resolve *after* the optimistic
        // update below — and because it's already in flight, our invalidate
        // dedupes into it rather than starting a fresh fetch. The stale (unread)
        // response then clobbers the cache, so the bell stays unread even though
        // the conversation is open. Cancel that in-flight fetch first so this
        // clear is the authoritative last writer, then reconcile from the server.
        await Promise.all([
          queryClient.cancelQueries({ queryKey: ['notifications', 'list'] }),
          queryClient.cancelQueries({ queryKey: ['notifications', 'unread-count'] }),
        ]);
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

  // Mirror of the native partner app's chat read tracking. Web and Android
  // both badge conversations from the same per-user read high-water mark
  // (POST /messages/mark-read), so advance it whenever the conversation is on
  // screen and refresh the sidebar's unread counts once the write lands.
  const markChatRead = useCallback(() => {
    if (!channelId) return;
    const body = kind === 'dm' ? { dm_conversation_id: channelId } : { channel_id: channelId };
    api
      .post('/messages/mark-read', body)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: UNREAD_SUMMARY_QUERY_KEY });
      })
      .catch(() => {
        /* non-critical — only affects the unread badges */
      });
  }, [channelId, kind, queryClient]);

  // Listen for real-time messages on the same channel/DM room.
  useEffect(() => {
    const socket = connectSocket();
    const unsubscribeRoom = subscribeToChannelRoom(channelId);

    // new_message / thread_reply carry the whole row (with its sender), so drop
    // it straight into the cache instead of waiting on a refetch round-trip —
    // that round-trip is why an incoming message lagged the notification banner
    // by seconds. Still invalidate afterwards to backfill server-side enrichment
    // (reply_count, thread participants, mention hydration).
    const handleIncomingMessage = (message?: Message) => {
      const belongsHere = !!message && (kind === 'dm'
        ? message.dm_conversation_id === channelId
        : message.channel_id === channelId);
      if (!belongsHere) return;
      if (message?.id) {
        const oldTimer = arrivalTimersRef.current.get(message.id);
        if (oldTimer) clearTimeout(oldTimer);
        setArrivingMessageIds((current) => new Set(current).add(message.id));
        arrivalTimersRef.current.set(message.id, setTimeout(() => {
          arrivalTimersRef.current.delete(message.id);
          setArrivingMessageIds((current) => {
            if (!current.has(message.id)) return current;
            const next = new Set(current);
            next.delete(message.id);
            return next;
          });
        }, 650));
        queryClient.setQueryData<{ pages: { data?: Message[] }[]; pageParams: unknown[] }>(
          queryKey,
          (old) => {
            if (!old?.pages?.length) return old;
            // pages[0] holds the newest batch (oldest-first within the page); a
            // freshly arrived message is the newest, so append it to that page.
            const [first, ...rest] = old.pages;
            if (first.data?.some((m) => m.id === message.id)) return old;
            return {
              ...old,
              pages: [{ ...first, data: [...(first.data || []), message] }, ...rest],
            };
          },
        );
      }
      queryClient.invalidateQueries({ queryKey });
      // A message arriving in the conversation already on screen is read on
      // sight — but a background tab merely has the conversation mounted and
      // must retain its unread state until the user returns.
      if (isConversationActivelyViewed()) markChatRead();
    };
    // Edits/deletes/reactions send partial payloads, so reconcile via refetch.
    const handleMessageMutated = () => {
      queryClient.invalidateQueries({ queryKey });
    };
    // Clear a matching notification only while the conversation is genuinely
    // visible. A background tab may still have this ChatPanel mounted and must
    // not silently consume the alert.
    const handleNotification = (n: { metadata?: Record<string, unknown> | null }) => {
      if (
        notifMatchesConversation(n, channelId, kind) &&
        isConversationActivelyViewed()
      ) {
        clearConversationNotifications();
      }
    };

    socket.on('new_message', handleIncomingMessage);
    socket.on('new_reaction', handleMessageMutated);
    socket.on('thread_reply', handleIncomingMessage);
    socket.on('message_updated', handleMessageMutated);
    socket.on('message_deleted', handleMessageMutated);
    socket.on('new_notification', handleNotification);
    return () => {
      unsubscribeRoom();
      socket.off('new_message', handleIncomingMessage);
      socket.off('new_reaction', handleMessageMutated);
      socket.off('thread_reply', handleIncomingMessage);
      socket.off('message_updated', handleMessageMutated);
      socket.off('message_deleted', handleMessageMutated);
      socket.off('new_notification', handleNotification);
    };
  }, [channelId, kind, queryClient, queryKey, clearConversationNotifications, markChatRead]);

  useEffect(() => () => {
    arrivalTimersRef.current.forEach(clearTimeout);
    arrivalTimersRef.current.clear();
  }, []);

  // Clear accumulated read state when this conversation becomes the active,
  // visible browser view. Listening for both focus and visibility covers
  // switching back from another window, another tab, and an installed PWA.
  useEffect(() => {
    if (!channelId) return;

    let frame: number | null = null;
    const syncVisibleConversation = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (!isConversationActivelyViewed()) return;

        // Advance the chat read mark on every genuine view — even when there
        // are no inbox notifications to clear.
        markChatRead();
        const cached = queryClient.getQueryData<Notification[]>(['notifications', 'list']);
        if (
          cached &&
          !cached.some((n) => !n.is_read && notifMatchesConversation(n, channelId, kind))
        ) {
          return;
        }
        clearConversationNotifications();
      });
    };

    syncVisibleConversation();
    window.addEventListener('focus', syncVisibleConversation);
    document.addEventListener('visibilitychange', syncVisibleConversation);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener('focus', syncVisibleConversation);
      document.removeEventListener('visibilitychange', syncVisibleConversation);
    };
  }, [channelId, kind, queryClient, clearConversationNotifications, markChatRead]);

  // Each page is oldest-first, but pages arrive newest-batch-first (page 0 is the
  // initial load, page 1 is the older batch behind it, …). Reverse the page order
  // so the flattened timeline reads oldest → newest top to bottom.
  const messages: Message[] = useMemo(() => {
    const pages = (messagesRes?.pages || []) as { data?: Message[] }[];
    const flat = [...pages].reverse().flatMap((p) => p.data || []);
    // Defensive de-dup: page boundaries can overlap if two messages share a
    // created_at, so never let the same id render twice.
    const seen = new Set<string>();
    return flat.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  }, [messagesRes]);

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
  // scrollHeight captured just before an older-messages fetch, so we can keep the
  // current messages visually fixed once the prepended batch grows the content.
  const restoreScrollRef = useRef<number | null>(null);
  // Jump-to-message (from search): the id we're seeking, and the id currently
  // flashing. `jumpProcessedNonce` dedupes a request across re-renders;
  // `jumpFetchCount` bounds the page-loads so a very old target can't spin forever.
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const jumpProcessedNonce = useRef<number>(-1);
  const jumpFetchCount = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || topLevelMessages.length === 0) return;
    // A pending scroll restore means older messages were just prepended — never
    // yank the view to the bottom in that case.
    if (restoreScrollRef.current != null) return;
    const isNewConversation = lastChannelRef.current !== channelId;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (isNewConversation || nearBottom) {
      el.scrollTop = el.scrollHeight;
      lastChannelRef.current = channelId;
    }
  }, [channelId, topLevelMessages]);

  // After an older batch is prepended, restore the prior scroll offset (before
  // paint) so the messages the user was reading stay put instead of jumping.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && restoreScrollRef.current != null) {
      el.scrollTop = el.scrollHeight - restoreScrollRef.current;
      restoreScrollRef.current = null;
    }
  }, [messages]);

  // A page can render shorter than the viewport (e.g. a DM whose newest 50
  // rows are mostly hidden thread replies), leaving the message container with
  // no overflow. Then it can't scroll, onScroll never fires, and scroll-up
  // pagination is unreachable — the user sees a handful of messages with no
  // way to load more. Keep pulling older pages until the container actually
  // overflows (so scrolling — and scroll-up loading — can engage) or history
  // runs out. Runs per loaded page via the `messages` dep.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;
    if (el.scrollHeight - el.clientHeight <= 40) {
      fetchNextPage();
    }
  }, [messages, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Pull older messages when the user scrolls near the top of the history.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;
    if (el.scrollTop < 120) {
      restoreScrollRef.current = el.scrollHeight;
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // ---- Jump to a message picked from search --------------------------------
  // Switching conversations abandons any in-flight jump: a stale pendingJumpId
  // would otherwise page the NEW conversation for a message that lives in the
  // old one, and a stale highlight would linger. Declared BEFORE the seeding
  // effect below so, on a switch that also carries a fresh jump target, this
  // clears first and the seeding effect re-sets pendingJumpId afterwards.
  useEffect(() => {
    setPendingJumpId(null);
    setHighlightId(null);
  }, [channelId, kind]);

  // A jump request in the store that targets THIS conversation seeds the search:
  // thread replies open the thread panel; top-level messages seed pendingJumpId.
  // For thread targets the request is left in the store — the mounted
  // ThreadPanel consumes it to flash the exact reply (see ThreadPanel).
  useEffect(() => {
    const t = messageJumpTarget;
    if (!t || t.conversationId !== channelId || t.kind !== kind) return;
    if (jumpProcessedNonce.current === t.nonce) return;
    jumpProcessedNonce.current = t.nonce;
    if (t.parentId) {
      setActiveThread(t.parentId);
      return;
    }
    jumpFetchCount.current = 0;
    setPendingJumpId(t.messageId);
  }, [messageJumpTarget, channelId, kind, setActiveThread, clearMessageJump]);

  // Locate the pending target: scroll + flash it if it's in the DOM, otherwise
  // pull older pages until it appears (bounded), then give up once history is
  // exhausted or the cap is hit.
  useEffect(() => {
    if (!pendingJumpId) return;
    const el = scrollRef.current?.querySelector(`[data-message-id="${pendingJumpId}"]`);
    if (el) {
      (el as HTMLElement).scrollIntoView({ block: 'center' });
      setHighlightId(pendingJumpId);
      setPendingJumpId(null);
      clearMessageJump();
      return;
    }
    // First page may still be loading — wait for the next messages update rather
    // than declaring failure on an empty list.
    if (messages.length === 0) return;
    const MAX_JUMP_PAGES = 40;
    if (hasNextPage && !isFetchingNextPage && jumpFetchCount.current < MAX_JUMP_PAGES) {
      jumpFetchCount.current += 1;
      fetchNextPage();
    } else if (!hasNextPage || jumpFetchCount.current >= MAX_JUMP_PAGES) {
      setPendingJumpId(null);
      clearMessageJump();
    }
  }, [pendingJumpId, messages, hasNextPage, isFetchingNextPage, fetchNextPage, clearMessageJump]);

  // The search highlight is intentionally sticky: it stays on the jumped-to
  // message so the user can keep seeing what search landed on. It's cleared only
  // when the conversation changes (effect above) or another jump replaces it.

  // Tag a message as "grouped" when the prior visible message is from the
  // same author and within 5 minutes — matches the Slack-style stacking.
  const isGrouped = (idx: number) => {
    if (idx === 0) return false;
    const prev = messagesWithDates[idx - 1];
    const cur = messagesWithDates[idx];
    if (!prev || prev.type !== 'message' || cur.type !== 'message') return false;
    // Activity lines break the stacking chain — the next real message keeps
    // its avatar/header even from the same author.
    if (getActivityMeta(prev.message!) || getActivityMeta(cur.message!)) return false;
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
        <div className="sqc-msg-scroll" ref={scrollRef} onScroll={handleScroll}>
          {/* Spinner while older history loads in on scroll-up */}
          {isFetchingNextPage && (
            <div className="sqc-msg-loadolder" aria-live="polite">
              Loading earlier messages…
            </div>
          )}
          {/* Slack-style intro — only once the whole history is loaded, so it
              doesn't flash above messages that haven't scrolled in yet. */}
          {!hasNextPage &&
            (kind === 'dm' ? <DmIntro dmId={channelId} /> : <ChannelIntro channelId={channelId} />)}
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
                highlighted={highlightId === item.message!.id}
                animateIn={arrivingMessageIds.has(item.message!.id)}
              />
            )
          )}
        </div>
        <TypingIndicator users={typingUsers} />
        {/* Composer pinned to bottom */}
        <MessageComposer
          ref={composerRef}
          channelId={channelId}
          kind={kind}
          placeholder={composerPlaceholder}
          soloGuard={soloGuard}
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
