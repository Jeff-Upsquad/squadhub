import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Message, SupportTicket } from '@squadhub/shared';
import api from '../../../services/api';
import { getSocket } from '../../../services/socket';
import MessageBubble from '../chat/MessageBubble';
import MessageComposer, { type MessageComposerHandle } from '../chat/MessageComposer';
import { usePanelFileDrop } from '../pm/usePanelFileDrop';
import { useSetTicketStatus, useClaimTicket } from '../../../hooks/useSupport';
import { CATEGORY_META, StatusPill, PriorityDot, ticketCode } from './supportUi';

/**
 * A support ticket's conversation, rendered exactly like a normal channel chat
 * thread: the real MessageBubble + MessageComposer over the shared /messages
 * thread route (parent = the ticket's opening message). Adds a ticket meta +
 * triage strip on top. Access is granted server-side (the creator/assignee are
 * commenter members of the Support channel; non-agents are still scoped to
 * their own ticket by the /messages support guard).
 */
export default function SupportTicketThread({
  ticket,
  isAgent,
  workspaceId,
  onClose,
}: {
  ticket: SupportTicket;
  isAgent: boolean;
  workspaceId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const rootId = ticket.root_message_id || '';
  const channelId = ticket.channel_id;
  const queryKey = ['thread', rootId];
  const setStatus = useSetTicketStatus(workspaceId);
  const claim = useClaimTicket(workspaceId);
  const cat = CATEGORY_META[ticket.category];
  const closed = ticket.status === 'closed';

  const { data: threadRes } = useQuery({
    queryKey,
    queryFn: () => api.get(`/messages/${rootId}/thread`).then((r) => r.data),
    enabled: !!rootId,
  });
  const root: Message | null = threadRes?.data?.root || null;
  const replies: Message[] = threadRes?.data?.replies || [];

  // Real-time — same wiring as the chat ThreadPanel (join the channel room,
  // append replies for this parent, reconcile in the background).
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !rootId) return;
    socket.emit('join_channel', channelId);
    const handleReply = (message?: Message) => {
      if (message?.id && message.parent_message_id === rootId) {
        qc.setQueryData<{ data?: { root: Message | null; replies: Message[] } }>(queryKey, (old) => {
          if (!old?.data) return old;
          if (old.data.replies?.some((m) => m.id === message.id)) return old;
          return { ...old, data: { ...old.data, replies: [...(old.data.replies || []), message] } };
        });
      }
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ['support', 'overview', workspaceId] });
    };
    const handleMutated = () => qc.invalidateQueries({ queryKey });
    socket.on('new_message', handleReply);
    socket.on('thread_reply', handleReply);
    socket.on('new_reaction', handleMutated);
    socket.on('message_updated', handleMutated);
    socket.on('message_deleted', handleMutated);
    return () => {
      socket.emit('leave_channel', channelId);
      socket.off('new_message', handleReply);
      socket.off('thread_reply', handleReply);
      socket.off('new_reaction', handleMutated);
      socket.off('message_updated', handleMutated);
      socket.off('message_deleted', handleMutated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId, channelId, workspaceId]);

  // Drag a file over the panel to stage it on the reply composer.
  const composerRef = useRef<MessageComposerHandle>(null);
  const { dragActive, panelHandlers } = usePanelFileDrop((files) => composerRef.current?.addFiles(files));

  // Stick to the newest reply on open / as replies arrive.
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastRoot = useRef<string | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !root) return;
    const isNew = lastRoot.current !== rootId;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (isNew || nearBottom) {
      el.scrollTop = el.scrollHeight;
      lastRoot.current = rootId;
    }
  }, [rootId, root, replies.length]);

  const canClaim = isAgent && !ticket.assigned_to;

  return (
    <div
      className="sqc-thread-panel relative flex w-[420px] shrink-0 flex-col border-l border-divider bg-white dark:bg-[var(--surface)]"
      {...panelHandlers}
    >
      {dragActive && (
        <div aria-hidden className="sqc-drop-overlay">
          <div className="sqc-drop-overlay__label">Drop a file to attach</div>
        </div>
      )}

      {/* Thread header — mirrors the chat ThreadPanel */}
      <div className="flex items-center justify-between border-b border-divider px-4 py-[9px]">
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="text-[18px] font-extrabold leading-tight text-foreground">Thread</h3>
          <span className="truncate text-[13px] text-foreground-muted">{ticketCode(ticket)}</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-[6px] p-1.5 text-foreground-muted hover:bg-surface-alt hover:text-foreground"
          aria-label="Close thread"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Ticket meta + triage actions */}
      <div className="border-b border-divider px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ${cat.chip}`}>
            {cat.label}
          </span>
          <StatusPill status={ticket.status} />
          <PriorityDot priority={ticket.priority} withLabel />
        </div>
        <h2 className="mt-1.5 text-[15px] font-semibold leading-snug text-foreground">{ticket.subject}</h2>
        <div className="mt-1 text-[11.5px] text-foreground-muted">
          Opened by {ticket.creator?.display_name || ticket.creator?.email || 'a user'}
          {ticket.assignee && <> · Assigned to {ticket.assignee.display_name || ticket.assignee.email}</>}
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          {canClaim && (
            <button
              onClick={() => claim.mutate(ticket.id)}
              className="rounded-lg border border-[var(--sh-hair)] px-3 py-1.5 text-[12px] font-semibold text-foreground transition hover:bg-surface-alt"
            >
              Claim
            </button>
          )}
          <button
            onClick={() => setStatus.mutate({ ticketId: ticket.id, action: closed ? 'reopen' : 'close' })}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
              closed
                ? 'border border-[var(--sh-hair)] text-foreground hover:bg-surface-alt'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {closed ? 'Reopen' : 'Mark resolved'}
          </button>
        </div>
      </div>

      {/* Conversation — real chat bubbles */}
      <div ref={scrollRef} className="flex flex-1 flex-col overflow-y-auto pb-3">
        {root && (
          <>
            <div className="pt-2">
              <MessageBubble message={root} inThread />
            </div>
            {replies.length > 0 && (
              <div className="sqc-thread-divider">
                {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
              </div>
            )}
          </>
        )}
        {replies.map((r) => (
          <MessageBubble key={r.id} message={r} inThread />
        ))}
      </div>

      {/* Composer — the real chat composer, posting into this ticket's thread */}
      {closed ? (
        <div className="border-t border-divider px-4 py-3 text-center text-[12px] text-foreground-muted">
          This ticket is closed.{' '}
          <button
            onClick={() => setStatus.mutate({ ticketId: ticket.id, action: 'reopen' })}
            className="font-semibold text-foreground underline"
          >
            Reopen it
          </button>{' '}
          to continue.
        </div>
      ) : (
        <MessageComposer
          ref={composerRef}
          channelId={channelId}
          kind="channel"
          parentMessageId={rootId}
          placeholder="Reply…"
          onSend={() => {
            qc.invalidateQueries({ queryKey });
            qc.invalidateQueries({ queryKey: ['support', 'overview', workspaceId] });
          }}
        />
      )}
    </div>
  );
}
