import { useMemo, useState } from 'react';
import type { SupportTicket } from '@squadhub/shared';
import { useSupportOverview, useMarkTicketRead } from '../../../hooks/useSupport';
import CreateTicketModal from './CreateTicketModal';
import SupportTicketThread from './SupportTicketThread';
import { CATEGORY_META, PriorityDot, StatusPill, relativeTime, ticketCode } from './supportUi';

function hashGradient(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 65% 45%))`;
}

function TicketCard({ t, active, onOpen }: { t: SupportTicket; active: boolean; onOpen: () => void }) {
  const cat = CATEGORY_META[t.category];
  const assignee = t.assignee;
  return (
    <button
      onClick={onOpen}
      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition ${
        active
          ? 'border-[var(--sh-ink)] bg-[var(--sh-hair-3)] shadow-[var(--sh-shadow-sm)]'
          : 'border-[var(--sh-hair)] bg-[var(--surface)] hover:border-[var(--sh-ink-4)] hover:shadow-[var(--sh-shadow-sm)]'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-[var(--sh-ink-4)]">{ticketCode(t)}</span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ${cat.chip}`}>
            {cat.label}
          </span>
          <PriorityDot priority={t.priority} />
        </div>
        <div className="mt-1 truncate text-[14px] font-semibold text-[var(--sh-ink)]">{t.subject}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[var(--sh-ink-3)]">
          <span>Opened by {t.creator?.display_name || t.creator?.email || 'user'}</span>
          <span>·</span>
          <span>{relativeTime(t.last_activity_at)}</span>
          {typeof t.reply_count === 'number' && t.reply_count > 0 && (
            <>
              <span>·</span>
              <span>{t.reply_count} {t.reply_count === 1 ? 'reply' : 'replies'}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <StatusPill status={t.status} />
        {assignee ? (
          <span
            className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-md text-[10px] font-bold text-white"
            title={`Assigned to ${assignee.display_name || assignee.email}`}
            style={{ background: assignee.avatar_url ? undefined : hashGradient(assignee.id) }}
          >
            {assignee.avatar_url ? (
              <img src={assignee.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              (assignee.display_name?.[0] || '?').toUpperCase()
            )}
          </span>
        ) : (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            Unassigned
          </span>
        )}
      </div>
    </button>
  );
}

export default function SupportChannelView({ workspaceId }: { workspaceId: string | null }) {
  const { data, isLoading } = useSupportOverview(workspaceId);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const markRead = useMarkTicketRead(workspaceId);

  const open = data?.tickets.open || [];
  const closed = data?.tickets.closed || [];
  const allTickets = useMemo(() => [...open, ...closed], [open, closed]);
  const selected = allTickets.find((t) => t.id === selectedId) || null;

  const openTicket = (t: SupportTicket) => {
    setSelectedId(t.id);
    setTab(t.status);
    markRead.mutate(t.id);
  };

  const list = tab === 'open' ? open : closed;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-[var(--sh-bg,var(--surface))]">
      {/* Left: header + tabs + ticket list */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b border-[var(--sh-hair)] px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--sh-ink)] text-white">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-6 0a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </span>
              <div>
                <h1 className="text-[18px] font-semibold text-[var(--sh-ink)]">Support</h1>
                <p className="text-[12px] text-[var(--sh-ink-3)]">
                  {data?.is_agent
                    ? 'Agent view — every ticket in this workspace.'
                    : 'Raise a ticket and our team will help you here.'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--sh-ink)] px-3.5 py-2 text-[13px] font-semibold text-white transition hover:opacity-90"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New ticket
            </button>
          </div>

          {/* Tabs */}
          <div className="mt-4 flex items-center gap-1 border-b border-[var(--sh-hair)] -mb-4">
            {(['open', 'closed'] as const).map((id) => {
              const count = id === 'open' ? open.length : closed.length;
              const activeTab = tab === id;
              return (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition ${
                    activeTab
                      ? 'border-[var(--sh-ink)] text-[var(--sh-ink)]'
                      : 'border-transparent text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)]'
                  }`}
                >
                  {id === 'open' ? 'Open tickets' : 'Closed tickets'}
                  <span
                    className={`rounded-full px-1.5 text-[10.5px] tabular-nums ${
                      activeTab ? 'bg-[var(--sh-ink)] text-white' : 'bg-[var(--sh-hair-3)] text-[var(--sh-ink-3)]'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="mx-auto max-w-3xl space-y-2">
            {isLoading ? (
              [0, 1, 2].map((i) => <div key={i} className="h-[76px] animate-pulse rounded-xl bg-[var(--sh-hair-3)]" />)
            ) : allTickets.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--sh-hair)] px-6 py-12 text-center">
                <h3 className="text-[15px] font-semibold text-[var(--sh-ink)]">No tickets yet</h3>
                <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-[var(--sh-ink-3)]">
                  Have a question or a problem? Open a ticket and we’ll pick it up. Each ticket becomes its own
                  conversation thread.
                </p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--sh-ink)] px-3.5 py-2 text-[13px] font-semibold text-white"
                >
                  Create your first ticket
                </button>
              </div>
            ) : list.length === 0 ? (
              <p className="px-1 py-8 text-center text-[12.5px] text-[var(--sh-ink-4)]">
                {tab === 'open' ? 'Nothing open. 🎉' : 'No closed tickets yet.'}
              </p>
            ) : (
              list.map((t) => (
                <TicketCard key={t.id} t={t} active={selectedId === t.id} onOpen={() => openTicket(t)} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Right: ticket thread — opens like a chat thread panel */}
      {selected && (
        <SupportTicketThread
          ticket={selected}
          workspaceId={workspaceId}
          isAgent={!!data?.is_agent}
          onClose={() => setSelectedId(null)}
        />
      )}

      {showCreate && (
        <CreateTicketModal
          workspaceId={workspaceId}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            setSelectedId(id);
            setTab('open');
          }}
        />
      )}
    </div>
  );
}
