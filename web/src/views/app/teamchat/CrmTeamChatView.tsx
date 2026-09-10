'use client';

import { useEffect, useMemo, useState } from 'react';
import ChatPanel from '../chat/ChatPanel';
import {
  useCloseCrmTeamChat,
  useCrmTeamChatOpen,
  useCrmTeamChatUnread,
  useMarkCrmTeamChatRead,
  useReopenCrmTeamChat,
  type CrmTeamChatSource,
} from '../../../hooks/useCrmTeamChat';

export const CRM_TEAMCHAT_META: Record<
  CrmTeamChatSource,
  { title: string; subtitle: string; accent: string }
> = {
  crm: {
    title: 'SquadCRM TeamChat',
    subtitle: 'Team discussions on leads, deals, and contacts',
    accent: '#4f46e5',
  },
  shcrm: {
    title: 'SquadHireCRM TeamChat',
    subtitle: 'Team discussions on leads, talent, and contacts',
    accent: '#007A5A',
  },
};

function entityDot(source: CrmTeamChatSource, t: string | null): string {
  if (t === 'deal') return 'bg-indigo-500';
  if (t === 'contact') return 'bg-sky-500';
  // SquadHire talent entities read as "lead"-green; keep one convention.
  return source === 'shcrm' ? 'bg-teal-600' : 'bg-emerald-600';
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/**
 * Embedded CRM TeamChat module — the same TeamChat UI as the CRM (chat list
 * with unread badges + conversation pane), rendered inside SquadHub. The
 * conversation itself is SquadHub's own ChatPanel: CRM team chats live in
 * SquadHub channels, so this is the exact same thread the CRM shows.
 */
export default function CrmTeamChatView({ source }: { source: CrmTeamChatSource }) {
  const meta = CRM_TEAMCHAT_META[source];
  const { data: chats = [], isLoading, error } = useCrmTeamChatOpen(source);
  const { data: unread } = useCrmTeamChatUnread(source);
  const markRead = useMarkCrmTeamChatRead(source);
  const closeChat = useCloseCrmTeamChat(source);
  const reopenChat = useReopenCrmTeamChat(source);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState(false);

  const selected = useMemo(
    () => chats.find((c) => c.channel_id === selectedId) ?? null,
    [chats, selectedId],
  );

  // Keep the selection valid as the list refreshes; adopt first chat on load.
  useEffect(() => {
    if (selectedId && chats.some((c) => c.channel_id === selectedId)) return;
    if (chats.length > 0 && !selectedId) setSelectedId(chats[0].channel_id);
    if (chats.length === 0) setSelectedId(null);
  }, [chats, selectedId]);

  useEffect(() => {
    setClosed(!!selected?.closed);
  }, [selected?.channel_id, selected?.closed]);

  const unreadBy = unread?.by_channel ?? {};
  const unreadTotal = unread?.total ?? 0;
  const teamChannels = new Set(unread?.team_channels ?? []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter(
      (c) =>
        c.label?.toLowerCase().includes(q) ||
        c.subtitle?.toLowerCase().includes(q) ||
        c.last_message_preview?.toLowerCase().includes(q),
    );
  }, [chats, query]);

  const select = (channelId: string) => {
    setSelectedId(channelId);
    markRead.mutate(channelId);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* Left — chat list */}
      <div className="flex w-[340px] shrink-0 flex-col border-r border-[var(--sh-hair)]">
        <div className="border-b border-[var(--sh-hair)] px-4 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-[14px] font-semibold text-[var(--sh-ink)]">{meta.title}</h1>
              <p className="truncate text-[11.5px] text-[var(--sh-ink-4)]">{meta.subtitle}</p>
            </div>
            {unreadTotal > 0 ? (
              <span
                title={`${unreadTotal} unread`}
                className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
                style={{ background: meta.accent }}
              >
                {unreadTotal > 99 ? '99+' : unreadTotal}
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-[var(--sh-hair-3)] px-2 py-0.5 text-[11px] font-medium text-[var(--sh-ink-3)]">
                {chats.length} open
              </span>
            )}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="mt-2.5 w-full rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-2.5 py-1.5 text-[12.5px] text-[var(--sh-ink)] outline-none placeholder:text-[var(--sh-ink-4)] focus:border-[var(--sh-ink-4)]"
          />
        </div>

        <div className="flex-1 overflow-y-auto bg-[var(--canvas)] p-3">
          <div className="flex flex-col gap-2">
            {isLoading && (
              <div className="py-12 text-center text-[12.5px] text-[var(--sh-ink-4)]">
                Loading chats…
              </div>
            )}
            {!isLoading && error && (
              <div className="rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] px-4 py-8 text-center shadow-[var(--sh-shadow-sm)]">
                <div className="text-[14px] font-semibold text-[var(--sh-ink)]">
                  Couldn&apos;t reach the CRM
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-[var(--sh-ink-3)]">
                  The {meta.title} API isn&apos;t reachable. Start the CRM API
                  ({source === 'crm' ? 'SquadCRM on :4100' : 'SquadHireCRM on :4101'}) and reload.
                </p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-3 rounded-md border border-[var(--sh-hair)] px-3 py-1.5 text-[12px] font-medium text-[var(--sh-ink)] transition hover:bg-[var(--sh-hair-3)]"
                >
                  Retry
                </button>
              </div>
            )}
            {!isLoading && !error && chats.length === 0 && (
              <div className="rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] px-4 py-10 text-center shadow-[var(--sh-shadow-sm)]">
                <div className="text-[14px] font-semibold text-[var(--sh-ink)]">No open chats</div>
                <p className="mt-2 text-[12px] leading-relaxed text-[var(--sh-ink-3)]">
                  Open a lead, deal, or contact in {meta.title} and click{' '}
                  <strong>Team chat</strong>. It will appear here.
                </p>
              </div>
            )}
            {!isLoading && !error && chats.length > 0 && filtered.length === 0 && (
              <div className="py-12 text-center text-[12.5px] text-[var(--sh-ink-4)]">
                No chats match “{query}”
              </div>
            )}
            {filtered.map((ch) => {
              const n = unreadBy[ch.channel_id] ?? 0;
              const active = selectedId === ch.channel_id;
              const team = teamChannels.has(ch.channel_id) || ch.via_squad === true;
              return (
                <div
                  key={ch.channel_id}
                  className={`group flex items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                    active
                      ? 'border-[var(--sh-ink)] bg-[var(--surface)] shadow-[var(--sh-shadow-sm)]'
                      : 'border-[var(--sh-hair)] bg-[var(--surface)] hover:border-[var(--sh-hair-2)]'
                  }`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => select(ch.channel_id)}
                  >
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${entityDot(source, ch.entity_type)}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-[13.5px] text-[var(--sh-ink)] ${
                          n > 0 ? 'font-bold' : 'font-medium'
                        }`}
                      >
                        {ch.label}
                      </div>
                      <div
                        className={`truncate text-[11.5px] ${
                          n > 0 ? 'text-[var(--sh-ink-2)]' : 'text-[var(--sh-ink-4)]'
                        }`}
                      >
                        {ch.last_message_preview || ch.subtitle || 'No messages yet'}
                      </div>
                    </div>
                    {n > 0 && (
                      <span
                        className="shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-bold leading-4 text-white"
                        style={{ background: team ? '#D97706' : meta.accent }}
                      >
                        {n > 99 ? '99+' : n}
                      </span>
                    )}
                    {ch.last_message_at && (
                      <span className="shrink-0 text-[11px] text-[var(--sh-ink-4)]">
                        {shortDate(ch.last_message_at)}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    title="Close chat"
                    onClick={() => {
                      closeChat.mutate(ch.channel_id);
                      if (selectedId === ch.channel_id) setSelectedId(null);
                    }}
                    className="rounded-md border border-[var(--sh-hair)] px-2 py-1 text-[11px] text-[var(--sh-ink-3)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
                  >
                    Close
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right — embedded conversation (same SquadHub thread the CRM shows) */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--surface)]">
        {selected ? (
          <>
            <header className="flex items-center gap-3 border-b border-[var(--sh-hair)] px-4 py-3">
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-white"
                style={{ background: meta.accent }}
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.84L3 20l1.05-3.15A7.6 7.6 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-[var(--sh-ink)]">
                  {meta.title}
                </div>
                <div className="truncate text-[11px] text-[var(--sh-ink-3)]">
                  {selected.label}
                  {selected.subtitle ? ` · ${selected.subtitle}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (closed) {
                    await reopenChat.mutateAsync(selected.channel_id);
                    setClosed(false);
                  } else {
                    await closeChat.mutateAsync(selected.channel_id);
                    setClosed(true);
                  }
                }}
                className={`shrink-0 rounded-md border px-2.5 py-1 text-[12px] font-medium ${
                  closed
                    ? 'border-[rgba(0,122,90,0.25)] bg-[rgba(0,122,90,0.08)] text-[#007A5A]'
                    : 'border-[var(--sh-hair)] text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
                }`}
              >
                {closed ? 'Closed' : 'Close chat'}
              </button>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label="Close conversation"
                className="shrink-0 rounded p-1 text-[var(--sh-ink-3)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
              >
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </header>
            {closed && (
              <div className="flex items-center gap-2 border-b border-[rgba(0,122,90,0.15)] bg-[rgba(0,122,90,0.06)] px-4 py-2 text-[12px] text-[#007A5A]">
                This chat is closed. It stays hidden until someone sends a new message.
              </div>
            )}
            <div className="squadhub-chat flex min-h-0 flex-1 flex-col overflow-hidden">
              <ChatPanel key={selected.channel_id} channelId={selected.channel_id} kind="channel" />
            </div>
          </>
        ) : (
          <div className="grid flex-1 place-items-center bg-[var(--canvas)] px-6 text-center">
            <div>
              <svg
                className="mx-auto h-9 w-9 text-[var(--sh-ink-4)]"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.4}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.84L3 20l1.05-3.15A7.6 7.6 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <div className="mt-3 text-[14px] font-semibold text-[var(--sh-ink)]">
                Pick a chat to start reading
              </div>
              <p className="mt-1.5 text-[12.5px] text-[var(--sh-ink-3)]">
                Select a conversation on the left — it opens right here.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
