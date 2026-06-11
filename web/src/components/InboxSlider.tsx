import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { usePMStore } from '../stores/pmStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { avatarFor, type Notification } from '../views/app/InboxView';
import type { HomeView } from '../layouts/MainLayout';

/**
 * Floating notification panel — opened by the rail's inbox button. A compact
 * single-column feed (avatar / action / context / comment) anchored next to
 * the icon rail; clicking a row jumps to its source and closes the panel.
 * The full-page inbox stays reachable via the Home sidebar's Inbox item.
 */

const ACTION_LABEL: Record<Notification['type'], string> = {
  task_assigned: 'Assigned you a task',
  task_updated: 'Updated a task',
  task_completed: 'Completed a task',
  task_commented: 'Commented on a task',
  task_due_soon: 'Task due soon',
  mention: 'Mentioned you in a comment',
  message_mention: 'Mentioned you in a message',
  dm_received: 'Sent you a direct message',
  reaction_added: 'Reacted to your message',
  lms_assigned: 'Assigned you a course',
  lms_updated: 'Updated a course',
};

// Titles read "<actor> <verb phrase> <entity>" — peel off the first two so the
// context chip shows just the entity ("apple 6", "#general"). Falls back to the
// whole title when the shape doesn't match.
const VERB_PREFIXES = [
  /^assigned you to\s+/i,
  /^commented on\s+/i,
  /^mentioned you in\s+/i,
  /^completed\s+/i,
  /^updated\s+/i,
  /^reacted to\s+/i,
  /^sent you\s+/i,
  /^added you to\s+/i,
];

function chipFor(n: Notification): string | null {
  let t = (n.title || '').trim();
  if (!t) return null;
  const actor = n.actor?.display_name?.trim();
  if (actor && t.toLowerCase().startsWith(actor.toLowerCase())) {
    t = t.slice(actor.length).trim();
  }
  for (const v of VERB_PREFIXES) {
    if (v.test(t)) return t.replace(v, '').trim() || null;
  }
  return t || null;
}

function when(iso: string): string {
  const then = new Date(iso);
  const m = Math.floor((Date.now() - then.getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d}d ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ChipIcon({ refType }: { refType: string }) {
  if (refType === 'message' || refType === 'chat_message') {
    return (
      <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M21 11.5a8.38 8.38 0 0 1-9 8.36 8.5 8.5 0 0 1-3.4-.7L3 20l.84-5.6A8.38 8.38 0 0 1 12 3.14a8.38 8.38 0 0 1 9 8.36z" />
      </svg>
    );
  }
  return (
    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}

function Tab({ label, badge, active, onClick }: { label: string; badge?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-1.5 pb-2.5 pt-1 text-[13px] transition ${
        active ? 'font-semibold text-[var(--sh-ink)]' : 'font-medium text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)]'
      }`}
    >
      {label}
      {badge != null && badge > 0 && (
        <span className="grid h-[18px] min-w-[18px] place-items-center rounded-[5px] bg-[var(--sh-ink)] px-1 text-[10.5px] font-semibold leading-none text-[var(--surface)]">
          {badge}
        </span>
      )}
      {active && <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-[var(--sh-ink)]" />}
    </button>
  );
}

export default function InboxSlider({
  onClose,
  setHomeView,
}: {
  onClose: () => void;
  setHomeView: (v: HomeView) => void;
}) {
  const queryClient = useQueryClient();
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const setActiveChannel = useWorkspaceStore((s) => s.setActiveChannel);
  const [tab, setTab] = useState<'inbox' | 'all'>('inbox');

  // Close on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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

  const unread = items.filter((n) => !n.is_read);
  const shown = tab === 'inbox' ? unread : items;

  const onRowClick = (n: Notification) => {
    if (!n.is_read) markRead.mutate(n.id);
    if (n.reference_type === 'task' && n.metadata?.task_id) {
      setActiveTask(n.metadata.task_id as string);
      onClose();
    } else if ((n.reference_type === 'message' || n.reference_type === 'chat_message') && n.metadata?.channel_id) {
      setActiveChannel(n.metadata.channel_id as string);
      setHomeView('chat');
      onClose();
    }
  };

  return (
    <>
      {/* Transparent click-catcher — the panel floats without dimming the view */}
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />

      {/* Floating card next to the icon rail; full-width below the mobile top bar */}
      <div
        className="inbox-slider-panel sh-view fixed left-2 right-2 top-14 z-50 flex max-h-[calc(100dvh-72px)] flex-col overflow-hidden rounded-[14px] border border-[var(--sh-hair)] bg-[var(--surface)] md:left-[76px] md:right-auto md:top-3 md:max-h-[calc(100dvh-24px)] md:w-[520px]"
        style={{ boxShadow: '0 18px 50px rgba(10, 10, 10, 0.16), 0 2px 8px rgba(10, 10, 10, 0.06)' }}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 pb-3 pt-4">
          <svg className="h-[18px] w-[18px] text-[var(--sh-ink)]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          <h3 className="text-[15px] font-semibold text-[var(--sh-ink)]">Inbox</h3>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inbox"
            className="grid h-7 w-7 place-items-center rounded-[8px] text-[var(--sh-ink-3)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-end gap-5 border-b border-[var(--sh-hair)] px-5">
          <Tab label="Inbox" badge={unread.length} active={tab === 'inbox'} onClick={() => setTab('inbox')} />
          <Tab label="All activity" active={tab === 'all'} onClick={() => setTab('all')} />
          <div className="flex-1" />
          {unread.length > 0 && (
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="pb-2.5 pt-1 text-[11.5px] font-medium text-[var(--sh-ink-3)] transition hover:text-[var(--sh-ink)]"
            >
              Mark all read
            </button>
          )}
        </div>

        {/* Feed */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && items.length === 0 ? (
            <div className="px-5 py-8 text-[13px] text-[var(--sh-ink-3)]">Loading…</div>
          ) : shown.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-[var(--sh-ink-3)]">
              {tab === 'inbox' ? 'You’re all caught up.' : 'No notifications yet.'}
            </div>
          ) : (
            shown.map((n) => {
              const av = avatarFor(n);
              const chip = chipFor(n);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onRowClick(n)}
                  className="flex w-full gap-3 border-b border-[var(--sh-hair-3)] px-5 py-3.5 text-left transition hover:bg-[var(--sh-hair-3)]"
                >
                  <div
                    className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
                    style={{ background: av.color }}
                  >
                    {av.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[13px] font-semibold text-[var(--sh-ink)]">
                        {n.actor?.display_name || 'System'}
                      </span>
                      {tab === 'all' && !n.is_read && (
                        <span className="h-1.5 w-1.5 shrink-0 self-center rounded-full bg-[var(--sh-ink)]" />
                      )}
                      <span className="ml-auto shrink-0 text-[11.5px] text-[var(--sh-ink-4)]">{when(n.created_at)}</span>
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-[var(--sh-ink-3)]">{ACTION_LABEL[n.type] || 'Notification'}</div>
                    {chip && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--sh-ink-2)]">
                        <ChipIcon refType={n.reference_type} />
                        <span className="truncate">{chip}</span>
                      </div>
                    )}
                    {n.body && <div className="mt-1 text-[13px] leading-[1.45] text-[var(--sh-ink)] line-clamp-2">{n.body}</div>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
