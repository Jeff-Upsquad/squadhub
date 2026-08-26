import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import api from '../../services/api';
import { usePMStore } from '../../stores/pmStore';
import { useWorkspaceStore, type ChatKind } from '../../stores/workspaceStore';
import type { HomeView } from '../../layouts/MainLayout';
import InboxTaskDetail from './inbox/InboxTaskDetail';
import InboxMessageDetail from './inbox/InboxMessageDetail';
import DesktopNotificationsBanner from '../../components/DesktopNotificationsBanner';
import InstallPwaPrompt from '../../components/InstallPwaPrompt';
import { useIsMobile } from '../../hooks/useIsMobile';

export type Notification = {
  id: string;
  user_id: string;
  type:
    | 'announcement'
    | 'task_assigned'
    | 'task_updated'
    | 'task_completed'
    | 'task_commented'
    | 'task_due_soon'
    | 'mention'
    | 'message_mention'
    | 'dm_received'
    | 'reaction_added'
    | 'lms_assigned'
    | 'lms_updated';
  reference_id: string;
  reference_type: string;
  actor_id: string | null;
  title: string;
  body: string | null;
  metadata: Record<string, any>;
  is_read: boolean;
  created_at: string;
  actor: { id: string; display_name: string; email: string; avatar_url: string | null } | null;
};

type Filter = 'all' | 'mentions' | 'threads' | 'tasks';

// Where to land in chat when opening a message notification: the exact
// message, plus its thread root when it lives in a thread. ChatPanel scrolls
// to + flashes top-level targets; thread targets open the thread panel (and
// ThreadPanel flashes the reply).
export type ChatJump = { messageId: string; parentId: string | null };

function isMention(t: Notification['type']) {
  return t === 'mention' || t === 'message_mention';
}

function isThread(n: Notification) {
  return n.reference_type === 'message' || n.reference_type === 'chat_message' || n.type === 'dm_received';
}

export function avatarFor(n: Notification): { initials: string; color: string } {
  const name = n.actor?.display_name || 'Someone';
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';
  const seed = n.actor?.id || n.id;
  const hue = Array.from(seed).reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return { initials, color: `oklch(0.6 0.13 ${hue})` };
}

// Resolve a message/chat notification to the conversation it should open.
// DMs deep-link by dm_conversation_id (kind 'dm'); channel posts by channel_id
// (kind 'channel'). dm_received carries only dm_conversation_id, and a mention
// inside a DM likewise has no channel_id — both must route as a DM, otherwise
// the row click does nothing. Returns null for non-chat notifications.
export function chatTargetFor(n: Notification): { id: string; kind: ChatKind } | null {
  if (n.reference_type !== 'message' && n.reference_type !== 'chat_message') return null;
  const dm = n.metadata?.dm_conversation_id as string | undefined;
  if (dm) return { id: dm, kind: 'dm' };
  const channel = n.metadata?.channel_id as string | undefined;
  if (channel) return { id: channel, kind: 'channel' };
  return null;
}

// Slack-style context line — what the notification lives in ("Thread in a
// direct message", "Task"), shown as the row's small header above the actor.
function ctxLine(n: Notification): string {
  const chat = chatTargetFor(n);
  switch (n.type) {
    case 'announcement': return 'Announcement';
    case 'dm_received': return 'Thread in a direct message';
    case 'message_mention': return chat?.kind === 'dm' ? 'Mention in a direct message' : 'Thread in a channel';
    case 'mention': return 'Mention in a task';
    case 'task_assigned': return 'Task';
    case 'task_updated': return 'Task update';
    case 'task_completed': return 'Task done';
    case 'task_commented': return 'Task comment';
    case 'task_due_soon': return 'Due soon';
    case 'reaction_added': return 'Reaction';
    case 'lms_assigned': return 'Learning';
    case 'lms_updated': return 'Learning';
    default: return n.type;
  }
}

// Small glyph that prefixes the context line, mirroring Slack's per-source
// icons (chat bubble for threads, @ for mentions, checkbox for tasks…).
function CtxGlyph({ n }: { n: Notification }) {
  const chat = isThread(n);
  const common = {
    width: 12,
    height: 12,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  if (chat) {
    return (
      <svg {...common}>
        <path d="M21 11.5a8.38 8.38 0 0 1-9 8.36 8.5 8.5 0 0 1-3.4-.7L3 20l.84-5.6A8.38 8.38 0 0 1 12 3.14a8.38 8.38 0 0 1 9 8.36z" />
      </svg>
    );
  }
  if (n.type === 'mention') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
      </svg>
    );
  }
  if (n.type === 'reaction_added') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
        <path d="M9 9h.01M15 9h.01" />
      </svg>
    );
  }
  if (n.type.startsWith('lms')) {
    return (
      <svg {...common}>
        <path d="m4 19 8-4 8 4-8 4z" />
        <path d="M12 15V5l8 4-8 4" />
        <path d="m4 9 8-4 8 4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}

// Slack-style timestamp: "Just now", "9:35 PM", "Yesterday", "Thursday", "Aug 12".
function slackTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (d.toDateString() === now.toDateString()) {
    if (mins < 60) return `${mins}m ago`;
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  if (now.getTime() - d.getTime() < 7 * 86_400_000) {
    return d.toLocaleDateString([], { weekday: 'long' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function InboxView({
  setHomeView,
}: {
  setHomeView?: (v: HomeView) => void;
} = {}) {
  const queryClient = useQueryClient();
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const setActiveChannel = useWorkspaceStore((s) => s.setActiveChannel);
  const requestMessageJump = useWorkspaceStore((s) => s.requestMessageJump);

  const [unreadsOnly, setUnreadsOnly] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  const { data: items = [], isLoading } = useQuery<Notification[]>({
    queryKey: ['notifications', 'list'],
    queryFn: async () => {
      const res = await api.get('/notifications', { params: { limit: 100 } });
      return res.data.data || [];
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => api.patch(`/notifications/${id}/read`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['notifications', 'list'] });
      const prev = queryClient.getQueryData<Notification[]>(['notifications', 'list']);
      queryClient.setQueryData<Notification[]>(['notifications', 'list'], (old) =>
        (old || []).map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['notifications', 'list'], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
    },
  });

  // Deep-link: desktop companion sets window.__pendingInboxNotificationId
  const [pendingDeepLink, setPendingDeepLink] = useState<string | null>(null);
  useEffect(() => {
    const pending = window.__pendingInboxNotificationId;
    if (pending) {
      setActiveId(pending);
      setPendingDeepLink(pending);
      delete window.__pendingInboxNotificationId;
    }
  }, []);

  // Once items load, mark the deep-linked notification as read
  useEffect(() => {
    if (!pendingDeepLink || items.length === 0) return;
    const target = items.find((n) => n.id === pendingDeepLink);
    if (target && !target.is_read) {
      markRead.mutate(target.id);
    }
    setPendingDeepLink(null);
  }, [pendingDeepLink, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const markAllRead = useMutation({
    mutationFn: async () => api.post('/notifications/mark-all-read'),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notifications', 'list'] });
      const prev = queryClient.getQueryData<Notification[]>(['notifications', 'list']);
      queryClient.setQueryData<Notification[]>(['notifications', 'list'], (old) =>
        (old || []).map((n) => ({ ...n, is_read: true })),
      );
      return { prev };
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['notifications', 'list'], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
    },
  });

  const unreadCount = items.filter((n) => !n.is_read).length;

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((it) => {
      if (unreadsOnly && it.is_read) return false;
      if (filter === 'mentions' && !isMention(it.type)) return false;
      if (filter === 'threads' && !isThread(it)) return false;
      if (filter === 'tasks' && !(it.reference_type === 'task' || it.type === 'mention')) return false;
      if (q) {
        const haystack = `${it.title || ''} ${it.body || ''} ${it.actor?.display_name || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [items, filter, unreadsOnly, searchQuery]);

  const current = items.find((n) => n.id === activeId) || filtered[0] || null;

  const openSource = (n: Notification, jump?: ChatJump) => {
    if (n.reference_type === 'task' && n.metadata?.task_id) {
      setActiveTask(n.metadata.task_id as string);
      return;
    }
    const target = chatTargetFor(n);
    if (target) {
      setActiveChannel(target.id, target.kind);
      setHomeView?.('chat');
      // Land on the exact message: highlight it, or open its thread when it
      // lives in one (same pipeline the search palette uses).
      if (jump) {
        requestMessageJump({
          conversationId: target.id,
          kind: target.kind,
          messageId: jump.messageId,
          parentId: jump.parentId,
        });
      }
    }
  };

  const onRowClick = (n: Notification) => {
    setActiveId(n.id);
    if (!n.is_read) markRead.mutate(n.id);
    // Chat notifications stay in the right detail pane (which has its own
    // "Open in chat" button) instead of navigating away to the channel on
    // click. Tasks and other sources still open their source directly.
    if (chatTargetFor(n)) return;
    openSource(n);
  };

  const TABS: { key: Filter; label: string; icon: ReactNode }[] = [
    {
      key: 'all',
      label: 'All',
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <path d="M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      ),
    },
    {
      key: 'mentions',
      label: 'Mentions',
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
        </svg>
      ),
    },
    {
      key: 'threads',
      label: 'Threads',
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 11.5a8.38 8.38 0 0 1-9 8.36 8.5 8.5 0 0 1-3.4-.7L3 20l.84-5.6A8.38 8.38 0 0 1 12 3.14a8.38 8.38 0 0 1 9 8.36z" />
        </svg>
      ),
    },
    {
      key: 'tasks',
      label: 'Tasks',
      icon: (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <path d="m8.5 12.5 2.5 2.5 4.5-5" />
        </svg>
      ),
    },
  ];

  const unreadsToggle = (
    <button
      type="button"
      className="ib-unreads"
      data-on={unreadsOnly}
      role="switch"
      aria-checked={unreadsOnly}
      onClick={() => setUnreadsOnly((v) => !v)}
    >
      <span className="ib-unreads-lbl">Unreads</span>
      <span className="ib-switch"><span className="ib-knob" /></span>
    </button>
  );

  return (
    <div className="sh-view inbox-view" data-detail={activeId ? 'true' : undefined}>
      <div className="inbox-list">
        {!isMobile && <DesktopNotificationsBanner />}
        {!isMobile && <InstallPwaPrompt />}
        {isMobile ? (
          <div className="inbox-phone-head">
            <h1>Activity</h1>
            {unreadsToggle}
            <button
              type="button"
              className="inbox-mark-all"
              disabled={unreadCount === 0 || markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
                <path d="m5 13 4 4L19 7" />
                <path d="M9 13 13 17 20 9" opacity="0.55" />
              </svg>
              Mark all read
            </button>
          </div>
        ) : (
          <div className="inbox-head">
            <h1>Activity</h1>
            {unreadsToggle}
          </div>
        )}
        <div className="inbox-filter">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className="ib-tab"
              data-active={filter === t.key}
              onClick={() => setFilter(t.key)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
          {isMobile ? (
            <div style={{ flex: 1 }} />
          ) : (
            <>
              <div style={{ flex: 1 }} />
              {/* Collapsed search icon — expands into an input on click
                  (or via the global "/" shortcut, which focuses it). */}
              <div className="ib-search" data-open={searchOpen}>
                <button
                  type="button"
                  className="ib-search-btn"
                  aria-label={searchOpen ? 'Close search' : 'Search activity'}
                  title="Search"
                  onClick={() => {
                    if (searchOpen && !searchQuery) {
                      setSearchOpen(false);
                    } else {
                      setSearchOpen(true);
                      requestAnimationFrame(() => searchInputRef.current?.focus());
                    }
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden>
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.8-3.8" />
                  </svg>
                </button>
                <input
                  ref={searchInputRef}
                  data-view-search="true"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearchQuery('');
                      setSearchOpen(false);
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder="Search activity…"
                  className="ib-search-input"
                  aria-hidden={!searchOpen}
                  tabIndex={searchOpen ? 0 : -1}
                />
                {searchOpen && searchQuery && (
                  <button
                    type="button"
                    className="ib-search-clear"
                    aria-label="Clear search"
                    onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                      <path d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <button
                type="button"
                className="pill"
                disabled={unreadCount === 0 || markAllRead.isPending}
                onClick={() => markAllRead.mutate()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: unreadCount === 0 ? 0.5 : 1, cursor: unreadCount === 0 ? 'default' : 'pointer' }}
              >
                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="m5 12 5 5L20 7" />
                </svg>
                Mark all read
              </button>
            </>
          )}
        </div>
        {isMobile && (
          <label className="inbox-phone-search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4 4" />
            </svg>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search activity"
            />
          </label>
        )}

        {isLoading && filtered.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--sh-ink-3)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="ib-empty">
            {unreadsOnly
              ? 'You\u2019re all caught up.'
              : filter === 'mentions'
                ? 'No mentions yet.'
                : 'No notifications yet.'}
          </div>
        ) : (
          filtered.map((n) => (
            <NotifRow
              key={n.id}
              n={n}
              active={current?.id === n.id}
              onClick={() => onRowClick(n)}
              onMarkRead={() => markRead.mutate(n.id)}
            />
          ))
        )}
      </div>

      <div className="inbox-detail">
        {/* Phone: the detail takes over the screen, so it owns a way back to
            the list. Hidden on desktop by .ib-back's base rule. */}
        {activeId && (
          <button type="button" className="ib-back" onClick={() => setActiveId(null)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
            All notifications
          </button>
        )}
        {current ? (
          renderDetail(current, (jump?: ChatJump) => openSource(current, jump))
        ) : (
          <div className="ib-empty" style={{ padding: 32 }}>
            Pick a notification to see the thread.
          </div>
        )}
      </div>
    </div>
  );
}

function renderDetail(n: Notification, onOpen: (jump?: ChatJump) => void) {
  if (n.reference_type === 'task' && n.metadata?.task_id) {
    return <InboxTaskDetail taskId={n.metadata.task_id as string} notificationId={n.id} onOpen={onOpen} />;
  }
  if (n.reference_type === 'message' && (n.metadata?.message_id || n.reference_id)) {
    return (
      <InboxMessageDetail
        messageId={(n.metadata?.message_id as string) || n.reference_id}
        onOpen={onOpen}
      />
    );
  }
  return <DetailPane n={n} onOpen={() => onOpen()} />;
}

function NotifRow({
  n,
  active,
  onClick,
  onMarkRead,
}: {
  n: Notification;
  active: boolean;
  onClick: () => void;
  onMarkRead: () => void;
}) {
  const av = avatarFor(n);
  // Action line: the title minus the leading actor name ("Alex Smith assigned
  // you to apple 6" -> "assigned you to apple 6"), mirroring Slack's
  // "replied to: …" pattern under the actor name.
  let action = (n.title || '').trim();
  const actor = n.actor?.display_name?.trim();
  if (actor && action.toLowerCase().startsWith(actor.toLowerCase())) {
    action = action.slice(actor.length).trim();
  }
  return (
    <div
      className="ib-item"
      data-unread={!n.is_read}
      data-active={active}
      onClick={onClick}
    >
      <div className="ib-ctxline">
        {!n.is_read && <span className="ib-dot" aria-hidden />}
        <span className="ib-ctxglyph"><CtxGlyph n={n} /></span>
        <span className="ib-ctx-txt">{ctxLine(n)}</span>
        <span className="ib-time">{slackTime(n.created_at)}</span>
      </div>
      <div className="ib-body-row">
        <div
          className="ava"
          style={{ width: 30, height: 30, borderRadius: '50%', background: av.color, fontSize: 10.5, flexShrink: 0 }}
        >
          {av.initials}
        </div>
        <div className="ib-content">
          <div className="ib-from">{n.actor?.display_name || 'System'}</div>
          {action && action !== (n.body || '').trim() && <div className="ib-action">{action}</div>}
          {n.body && <div className="ib-snip">{n.body}</div>}
        </div>
      </div>
      {!n.is_read && (
        <button
          type="button"
          className="ib-mark-read"
          title="Mark as read"
          aria-label="Mark as read"
          onClick={(e) => {
            e.stopPropagation();
            onMarkRead();
          }}
        >
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="m5 12 5 5L20 7" />
          </svg>
        </button>
      )}
    </div>
  );
}

function DetailPane({ n, onOpen }: { n: Notification; onOpen: () => void }) {
  const av = avatarFor(n);
  return (
    <div className="th-pane">
      <div className="th-head">
        <div
          className="ava"
          style={{ width: 36, height: 36, borderRadius: '50%', background: av.color, fontSize: 12 }}
        >
          {av.initials}
        </div>
        <div className="th-head-txt">
          <h1>{n.title}</h1>
          <div className="th-sub">
            {n.actor?.display_name || 'System'} · {ctxLine(n)} · {timeAgo(n.created_at)}
          </div>
        </div>
        <button type="button" className="top-btn ghost-border" onClick={onOpen}>
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          Open
        </button>
      </div>
      <div className="th-scroll">
        {n.body ? (
          <div className="th-msg">
            <div
              className="ava"
              style={{ width: 32, height: 32, borderRadius: '50%', background: av.color, fontSize: 11 }}
            >
              {av.initials}
            </div>
            <div className="th-msg-body">
              <div className="th-msg-hd">
                <b>{n.actor?.display_name || 'System'}</b>
                <span>{slackTime(n.created_at)}</span>
              </div>
              <p style={{ margin: '2px 0 0' }}>{n.body}</p>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--sh-ink-3)' }}>No preview available.</div>
        )}
      </div>
    </div>
  );
}
