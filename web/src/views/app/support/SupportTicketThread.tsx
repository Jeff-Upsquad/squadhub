import { useEffect, useRef, useState } from 'react';
import { useSendTicketMessage, useSetTicketStatus, useTicketThread, type BridgeTicket } from '../../../hooks/useSupport';
import HubUnavailable, { isHubUnavailable } from '../../../components/HubUnavailable';
import { CATEGORY_META, StatusPill, PriorityDot, ticketCode, relativeTime } from './supportUi';

/**
 * A support ticket's conversation. The thread lives on Squad Hub's help desk;
 * the SaaS server reads it and posts replies over the bridge. Agent replies
 * show up here (and as an in-app notification).
 */
export default function SupportTicketThread({
  ticket,
  workspaceId,
  onClose,
}: {
  ticket: BridgeTicket;
  workspaceId: string | null;
  onClose: () => void;
}) {
  const thread = useTicketThread(ticket.id);
  const send = useSendTicketMessage(ticket.id, workspaceId);
  const setStatus = useSetTicketStatus(workspaceId);
  const [draft, setDraft] = useState('');
  const live = thread.data?.ticket ?? ticket;
  const cat = CATEGORY_META[live.category] ?? CATEGORY_META.general;
  const closed = live.status === 'closed';
  const messages = thread.data?.messages ?? [];

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || send.isPending) return;
    await send.mutateAsync(text);
    setDraft('');
  };

  return (
    <div className="sqc-thread-panel relative flex w-[420px] shrink-0 flex-col border-l border-divider bg-white dark:bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-divider px-4 py-[9px]">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="text-[18px] font-extrabold leading-tight text-foreground">Ticket</h3>
          <span className="truncate text-[13px] text-foreground-muted">{ticketCode(live)}</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-[6px] p-1.5 text-foreground-muted hover:bg-surface-alt hover:text-foreground"
          aria-label="Close ticket"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="border-b border-divider px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ${cat.chip}`}>{cat.label}</span>
          <StatusPill status={live.status} />
          <PriorityDot priority={live.priority} withLabel />
        </div>
        <h2 className="mt-1.5 text-[15px] font-semibold leading-snug text-foreground">{live.subject}</h2>
        <div className="mt-1 text-[11.5px] text-foreground-muted">
          {live.assignee ? `Handled by ${live.assignee.display_name}` : 'Waiting for the support team'}
        </div>
        <div className="mt-2.5">
          <button
            onClick={() => setStatus.mutate({ ticketId: live.id, action: closed ? 'reopen' : 'close' })}
            disabled={setStatus.isPending}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-50 ${
              closed ? 'border border-[var(--sh-hair)] text-foreground hover:bg-surface-alt' : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {closed ? 'Reopen' : 'Mark resolved'}
          </button>
          {setStatus.isError && (
            <span className="ml-2 text-[11.5px] text-red-600">
              {isHubUnavailable(setStatus.error) ? 'Temporarily unavailable — try again shortly.' : 'Could not update the ticket.'}
            </span>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {thread.isError ? (
          isHubUnavailable(thread.error) ? (
            <HubUnavailable what="This ticket" onRetry={() => thread.refetch()} />
          ) : (
            <p className="text-[12.5px] text-red-600">Could not load this ticket.</p>
          )
        ) : thread.isLoading ? (
          <p className="text-[12.5px] text-foreground-muted">Loading…</p>
        ) : (
          messages.map((m) => {
            const mine = m.author.kind === 'requester';
            return (
              <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                <div className="mb-0.5 text-[11px] text-foreground-muted">
                  {mine ? 'You' : m.author.name || 'Support'} · {relativeTime(m.created_at)}
                </div>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[13px] ${
                    mine ? 'bg-[var(--sh-ink)] text-white' : 'bg-surface-alt text-foreground'
                  }`}
                >
                  {m.content}
                  {m.file_url && (
                    <a href={m.file_url} target="_blank" rel="noreferrer" className="mt-1 block underline">
                      {m.file_name || 'Attachment'}
                    </a>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {closed ? (
        <div className="border-t border-divider px-4 py-3 text-center text-[12px] text-foreground-muted">
          This ticket is closed. Reopen it to continue.
        </div>
      ) : (
        <div className="border-t border-divider p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            maxLength={8000}
            placeholder="Reply…"
            className="w-full resize-none rounded-lg border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-[13px] text-foreground outline-none focus:border-[var(--sh-ink)]"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[11.5px] text-red-600">
              {send.isError ? (isHubUnavailable(send.error) ? 'Temporarily unavailable — try again shortly.' : 'Could not send.') : ''}
            </span>
            <button
              onClick={() => void submit()}
              disabled={!draft.trim() || send.isPending}
              className="rounded-lg bg-[var(--sh-ink)] px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
            >
              {send.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
