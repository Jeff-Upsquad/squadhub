import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import api from '../../services/api';
import { usePMStore } from '../../stores/pmStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { HomeView } from '../../layouts/MainLayout';
import InboxTaskDetail from './inbox/InboxTaskDetail';
import InboxMessageDetail from './inbox/InboxMessageDetail';
import ViewSearchInput from '../../components/pm/ViewSearchInput';
import DesktopNotificationsBanner from '../../components/DesktopNotificationsBanner';

export type Notification = {
  id: string;
  user_id: string;
  type:
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

type Filter = 'all' | 'unread' | 'mentions';

const NEEDS_YOU = new Set<Notification['type']>(['task_assigned', 'mention', 'message_mention']);

function isMention(t: Notification['type']) {
  return t === 'mention' || t === 'message_mention';
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

function ctxLabel(n: Notification): string {
  switch (n.type) {
    case 'task_assigned': return 'task';
    case 'task_completed': return 'task done';
    case 'task_commented': return 'comment';
    case 'mention': return 'mention';
    case 'message_mention': return 'mention';
    case 'task_updated': return 'task update';
    case 'task_due_soon': return 'due soon';
    case 'dm_received': return 'DM';
    case 'reaction_added': return 'reaction';
    case 'lms_assigned': return 'learning';
    case 'lms_updated': return 'learning';
    default: return n.type;
  }
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

  const [filter, setFilter] = useState<Filter>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((it) => {
      if (filter === 'unread' && it.is_read) return false;
      if (filter === 'mentions' && !isMention(it.type)) return false;
      if (q) {
        const haystack = `${it.title || ''} ${it.body || ''} ${it.actor?.display_name || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [items, filter, searchQuery]);

  const groups = useMemo(() => {
    const out: { needs: Notification[]; fyi: Notification[] } = { needs: [], fyi: [] };
    for (const n of filtered) {
      if (NEEDS_YOU.has(n.type)) out.needs.push(n);
      else out.fyi.push(n);
    }
    return out;
  }, [filtered]);

  const current = items.find((n) => n.id === activeId) || filtered[0] || null;

  const openSource = (n: Notification) => {
    if (n.reference_type === 'task' && n.metadata?.task_id) {
      setActiveTask(n.metadata.task_id as string);
    } else if ((n.reference_type === 'message' || n.reference_type === 'chat_message') && n.metadata?.channel_id) {
      setActiveChannel(n.metadata.channel_id as string);
      setHomeView?.('chat');
    }
  };

  const onRowClick = (n: Notification) => {
    setActiveId(n.id);
    if (!n.is_read) markRead.mutate(n.id);
    openSource(n);
  };

  const unreadCount = items.filter((n) => !n.is_read).length;

  return (
    <div className="sh-view inbox-view">
      <div className="inbox-list">
        <DesktopNotificationsBanner />
        <div className="inbox-filter">
          <div className="pill" data-active={filter === 'all'} onClick={() => setFilter('all')}>All</div>
          <div className="pill" data-active={filter === 'unread'} onClick={() => setFilter('unread')}>
            Unread{unreadCount > 0 ? ` · ${unreadCount}` : ''}
          </div>
          <div className="pill" data-active={filter === 'mentions'} onClick={() => setFilter('mentions')}>Mentions</div>
          <div style={{ flex: 1 }} />
          <ViewSearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search notifications..." />
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
        </div>

        {isLoading && filtered.length === 0 ? (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--sh-ink-3)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, fontSize: 13, color: 'var(--sh-ink-3)' }}>
            {filter === 'unread' ? 'You\u2019re all caught up.' : filter === 'mentions' ? 'No mentions yet.' : 'No notifications yet.'}
          </div>
        ) : (
          <>
            {groups.needs.length > 0 && (
              <div>
                <div className="inbox-group-hd">Needs you · {groups.needs.length}</div>
                {groups.needs.map((n) => (
                  <NotifRow key={n.id} n={n} active={current?.id === n.id} onClick={() => onRowClick(n)} />
                ))}
              </div>
            )}
            {groups.fyi.length > 0 && (
              <div>
                <div className="inbox-group-hd">FYI · {groups.fyi.length}</div>
                {groups.fyi.map((n) => (
                  <NotifRow key={n.id} n={n} active={current?.id === n.id} onClick={() => onRowClick(n)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="inbox-detail">
        {current ? (
          renderDetail(current, () => openSource(current))
        ) : (
          <div style={{ padding: 32, fontSize: 13, color: 'var(--sh-ink-3)' }}>
            Pick a notification to see the detail.
          </div>
        )}
      </div>
    </div>
  );
}

function renderDetail(n: Notification, onOpen: () => void) {
  if (n.reference_type === 'task' && n.metadata?.task_id) {
    return <InboxTaskDetail taskId={n.metadata.task_id as string} onOpen={onOpen} />;
  }
  if (n.reference_type === 'message' && (n.metadata?.message_id || n.reference_id)) {
    return (
      <InboxMessageDetail
        messageId={(n.metadata?.message_id as string) || n.reference_id}
        onOpen={onOpen}
      />
    );
  }
  return <DetailPane n={n} onOpen={onOpen} />;
}

function NotifRow({ n, active, onClick }: { n: Notification; active: boolean; onClick: () => void }) {
  const av = avatarFor(n);
  return (
    <div
      className="ib-item"
      data-unread={!n.is_read}
      data-active={active}
      onClick={onClick}
    >
      <div className="line1">
        <div
          className="ava"
          style={{ width: 20, height: 20, borderRadius: '50%', background: av.color, fontSize: 9, fontWeight: 600 }}
        >
          {av.initials}
        </div>
        <span className="ib-from">{n.actor?.display_name || 'System'}</span>
        <span className="ib-ctx">{ctxLabel(n)}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--sh-ink-3)' }}>{timeAgo(n.created_at)}</span>
      </div>
      <div className="ib-title">{n.title}</div>
      {n.body && <div className="ib-snip">{n.body}</div>}
    </div>
  );
}

function DetailPane({ n, onOpen }: { n: Notification; onOpen: () => void }) {
  const av = avatarFor(n);
  return (
    <>
      <div className="detail-head">
        <div className="ava" style={{ width: 40, height: 40, borderRadius: '50%', background: av.color, fontWeight: 600 }}>
          {av.initials}
        </div>
        <div style={{ flex: 1 }}>
          <h1>{n.title}</h1>
          <div style={{ fontSize: 12, color: 'var(--sh-ink-3)', marginTop: 2 }}>
            From <b style={{ color: 'var(--sh-ink)' }}>{n.actor?.display_name || 'System'}</b> · {ctxLabel(n)} · {timeAgo(n.created_at)}
          </div>
        </div>
        <button type="button" className="top-btn ghost-border" onClick={onOpen}>
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          Open
        </button>
      </div>
      <div className="detail-body">
        {n.body ? <p>{n.body}</p> : <p style={{ color: 'var(--sh-ink-3)' }}>No preview available.</p>}
      </div>
    </>
  );
}
