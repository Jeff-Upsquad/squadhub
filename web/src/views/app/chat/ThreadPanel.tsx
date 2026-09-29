import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';
import { getSocket, subscribeToChannelRoom } from '../../../services/socket';
import type { Message } from '@squadhub/shared';
import MessageBubble from './MessageBubble';
import MessageComposer, { type MessageComposerHandle } from './MessageComposer';
import { usePanelFileDrop } from '../pm/usePanelFileDrop';
import { useWorkspaceStore, type ChatKind } from '../../../stores/workspaceStore';
import { useAuthStore } from '../../../stores/authStore';
import { sourceFromThread, useConvertToTaskStore } from '../../../stores/convertToTaskStore';
import TypingIndicator, { useTypingUsers } from './TypingIndicator';

interface Props {
  parentId: string;
  channelId: string;
  kind: ChatKind;
  onClose?: () => void;
  // Fill a host container instead of docking as a resizable side panel
  // (the SquadUp call rail). Drops the resize handle, fixed width and the
  // close button; the host owns the panel's frame.
  embedded?: boolean;
  // Header title — defaults to "Thread".
  title?: string;
}

// Slack-style thread side panel. Shows the parent message + replies fetched
// via GET /messages/:id/thread. Reuses MessageComposer with `parentMessageId`
// so replies post into the thread automatically.
const THREAD_W_DEFAULT = 400;
const THREAD_W_MIN = 320;
const THREAD_W_MAX = 720;
function threadWidthKey(userId?: string | null) {
  return userId ? `sh-thread-width:${userId}` : 'sh-thread-width';
}

export default function ThreadPanel({ parentId, channelId, kind, onClose, embedded = false, title = 'Thread' }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ['thread', parentId];

  // Context label under the "Thread" title — "# design" or the DM name.
  const channel = useWorkspaceStore((s) => s.channels.find((c) => c.id === channelId));
  const dm = useWorkspaceStore((s) => s.dmConversations.find((d) => d.id === channelId));
  const meId = useAuthStore((s) => s.user?.id);
  const typingUsers = useTypingUsers(channelId, kind, parentId);
  // Resizable width — shared across all chats/channels for this user.
  // Persisted per user in localStorage; clamped to a usable range.
  const [threadWidth, setThreadWidth] = useState(THREAD_W_DEFAULT);
  const [resizingThread, setResizingThread] = useState(false);
  const threadResize = useRef<{ startX: number; startW: number } | null>(null);
  const threadWidthRef = useRef(THREAD_W_DEFAULT);
  // Load the persisted width after mount — lazy-init from localStorage would
  // diverge from the server render and trip hydration.
  useEffect(() => {
    try {
      const stored =
        Number(window.localStorage.getItem(threadWidthKey(meId))) ||
        Number(window.localStorage.getItem('sh-thread-width'));
      if (Number.isFinite(stored) && stored >= THREAD_W_MIN && stored <= THREAD_W_MAX) {
        threadWidthRef.current = stored;
        setThreadWidth(stored);
      }
    } catch {
      /* non-critical — fall back to the default width */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId]);
  const beginThreadResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    threadResize.current = { startX: e.clientX, startW: threadWidthRef.current };
    setResizingThread(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add('sb-resizing');
  };
  const moveThreadResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = threadResize.current;
    if (!st) return;
    // Dragging the left edge leftwards widens the panel, rightwards narrows it.
    const next = Math.min(THREAD_W_MAX, Math.max(THREAD_W_MIN, st.startW - (e.clientX - st.startX)));
    threadWidthRef.current = next;
    setThreadWidth(next);
  };
  const endThreadResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!threadResize.current) return;
    threadResize.current = null;
    setResizingThread(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    document.body.classList.remove('sb-resizing');
    try {
      window.localStorage.setItem(threadWidthKey(meId), String(threadWidthRef.current));
      // Keep the legacy shared key in sync for accounts without an id yet.
      window.localStorage.setItem('sh-thread-width', String(threadWidthRef.current));
    } catch {
      /* non-critical — width still applies for this session */
    }
  };
  const resetThreadWidth = () => {
    threadWidthRef.current = THREAD_W_DEFAULT;
    setThreadWidth(THREAD_W_DEFAULT);
    try {
      window.localStorage.setItem(threadWidthKey(meId), String(THREAD_W_DEFAULT));
      window.localStorage.setItem('sh-thread-width', String(THREAD_W_DEFAULT));
    } catch {
      /* ignore */
    }
  };
  const [arrivingReplyIds, setArrivingReplyIds] = useState<Set<string>>(() => new Set());
  const arrivalTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const dmOthers = (dm?.participants || []).filter((p) => p.id !== meId);
  const contextLabel =
    kind === 'dm'
      ? dmOthers.map((p) => p.display_name).join(', ') || 'Conversation'
      : channel
        ? `# ${channel.name}`
        : '';

  const { data: threadRes } = useQuery({
    queryKey,
    queryFn: () => api.get(`/messages/${parentId}/thread`).then((r) => r.data),
    enabled: !!parentId,
  });

  // Hold the conversation room ourselves: alongside ChatPanel this is a no-op
  // (ref-counted), but embedded in the SquadUp rail there is no host panel.
  useEffect(() => subscribeToChannelRoom(channelId), [channelId]);

  // Refresh on any new_message in this room (covers thread_reply events too).
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    // A reply for this thread carries the whole row — append it immediately so it
    // shows without a refetch round-trip, then reconcile in the background. Edits,
    // deletes and reactions send partial payloads, so those just refetch.
    const handleReply = (message?: Message) => {
      if (message?.id && message.parent_message_id === parentId) {
        const oldTimer = arrivalTimersRef.current.get(message.id);
        if (oldTimer) clearTimeout(oldTimer);
        setArrivingReplyIds((current) => new Set(current).add(message.id));
        arrivalTimersRef.current.set(message.id, setTimeout(() => {
          arrivalTimersRef.current.delete(message.id);
          setArrivingReplyIds((current) => {
            if (!current.has(message.id)) return current;
            const next = new Set(current);
            next.delete(message.id);
            return next;
          });
        }, 650));
        queryClient.setQueryData<{ data?: { root: Message | null; replies: Message[] } }>(queryKey, (old) => {
          if (!old?.data) return old;
          if (old.data.replies?.some((m) => m.id === message.id)) return old;
          return { ...old, data: { ...old.data, replies: [...(old.data.replies || []), message] } };
        });
      }
      queryClient.invalidateQueries({ queryKey });
    };
    const handleMutated = () => queryClient.invalidateQueries({ queryKey });
    socket.on('new_message', handleReply);
    socket.on('thread_reply', handleReply);
    socket.on('new_reaction', handleMutated);
    socket.on('message_updated', handleMutated);
    socket.on('message_deleted', handleMutated);
    return () => {
      socket.off('new_message', handleReply);
      socket.off('thread_reply', handleReply);
      socket.off('new_reaction', handleMutated);
      socket.off('message_updated', handleMutated);
      socket.off('message_deleted', handleMutated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId]);

  useEffect(() => () => {
    arrivalTimersRef.current.forEach(clearTimeout);
    arrivalTimersRef.current.clear();
  }, []);

  const root: Message | null = threadRes?.data?.root || null;
  const replies: Message[] = threadRes?.data?.replies || [];
  const openConvertToTask = useConvertToTaskStore((s) => s.open);

  const isBotDoubt = root?.metadata?.kind === 'bot_doubt';
  const isClosed = isBotDoubt && !!root?.metadata?.is_closed;
  const doubtId = root?.metadata?.doubt_id as string | undefined;
  const doubtStatus = (root?.metadata?.status as string) || 'open';

  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizeText, setFinalizeText] = useState('');
  const [finalizing, setFinalizing] = useState(false);

  const toggleCloseDoubt = async () => {
    if (!doubtId) return;
    try {
      await api.post(`/bot-channels/${channelId}/doubts/${doubtId}/close`, { closed: !isClosed });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      console.error('Failed to toggle close:', err);
    }
  };

  const finalizeGuidance = async () => {
    if (!doubtId || !finalizeText.trim() || finalizing) return;
    setFinalizing(true);
    try {
      await api.post(`/bot-channels/${channelId}/doubts/${doubtId}/resolve`, {
        mode: 'instruct',
        instruction: finalizeText.trim(),
      });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey });
      setFinalizeOpen(false);
      setFinalizeText('');
    } catch (err) {
      console.error('Failed to finalize guidance:', err);
    } finally {
      setFinalizing(false);
    }
  };

  // Drag a file anywhere over the thread panel to stage it on the reply composer
  // (mirrors the main ChatPanel behaviour).
  const composerRef = useRef<MessageComposerHandle>(null);
  const { dragActive, panelHandlers } = usePanelFileDrop((files) => {
    composerRef.current?.addFiles(files);
  });

  // Keep the thread pinned to the newest reply: jump to the bottom when the
  // thread opens and stick there as replies arrive, unless the reader has
  // scrolled up to read history. Mirrors the main ChatPanel behaviour.
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastParentRef = useRef<string | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !root) return;
    const isNewThread = lastParentRef.current !== parentId;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (isNewThread || nearBottom) {
      el.scrollTop = el.scrollHeight;
      lastParentRef.current = parentId;
    }
  }, [parentId, root, replies.length]);

  // Jump-to-message (from search or the inbox's "Open in chat"): ChatPanel
  // opens this panel for thread targets and leaves the request in the store —
  // consume it here to scroll to the exact message and flash the highlight.
  const messageJumpTarget = useWorkspaceStore((s) => s.messageJumpTarget);
  const clearMessageJump = useWorkspaceStore((s) => s.clearMessageJump);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    const t = messageJumpTarget;
    if (!t || t.parentId !== parentId) return;
    if (t.conversationId !== channelId || t.kind !== kind) return;
    setHighlightId(t.messageId);
    clearMessageJump();
    // Run after the pin-to-bottom effect above so the target scroll wins.
    const raf = requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector(`[data-message-id="${t.messageId}"]`)
        ?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(raf);
  }, [messageJumpTarget, parentId, channelId, kind, clearMessageJump]);

  // A fresh thread starts un-highlighted.
  useEffect(() => {
    setHighlightId(null);
  }, [parentId]);

  return (
    <div
      className={
        embedded
          ? 'sqc-thread-panel sqc-thread-panel--embedded relative flex min-h-0 flex-1 flex-col bg-white dark:bg-surface'
          : 'sqc-thread-panel relative flex shrink-0 flex-col border-l border-divider bg-white dark:bg-surface'
      }
      style={embedded ? undefined : { width: threadWidth }}
      {...panelHandlers}
    >
      {!embedded && (
        <div
          className="sqc-thread-resize"
          data-resizing={resizingThread}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize thread panel"
          title="Drag to resize — double-click to reset"
          onPointerDown={beginThreadResize}
          onPointerMove={moveThreadResize}
          onPointerUp={endThreadResize}
          onPointerCancel={endThreadResize}
          onDoubleClick={resetThreadWidth}
        />
      )}
      {dragActive && (
        <div aria-hidden className="sqc-drop-overlay">
          <div className="sqc-drop-overlay__label">Drop a file to attach</div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between border-b border-divider px-4 py-[9px]">
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="text-[18px] font-extrabold leading-tight text-foreground">{title}</h3>
          {contextLabel && (
            <span className="truncate text-[13px] text-foreground-muted">{contextLabel}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
        {isBotDoubt && doubtId && (
          <button
            type="button"
            onClick={toggleCloseDoubt}
            className={`rounded-[6px] px-2 py-1 text-[12px] font-semibold transition-colors border border-divider/40 ${
              isClosed
                ? 'bg-slate-500/10 text-slate-600 dark:text-slate-400 hover:bg-slate-500/20'
                : 'text-foreground-muted hover:bg-surface-alt hover:text-foreground'
            }`}
            title={isClosed ? 'Reopen this conversation' : 'Mark conversation as closed'}
          >
            {isClosed ? 'Closed · Reopen' : 'Mark as closed'}
          </button>
        )}
        {root && (
          <button
            type="button"
            onClick={() => openConvertToTask(sourceFromThread(root, replies, contextLabel || undefined))}
            className="rounded-[6px] px-2 py-1 text-[12.5px] font-semibold text-foreground-muted hover:bg-surface-alt hover:text-foreground"
            title="Create a task from this thread (message + all replies)"
          >
            Convert to task
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-[6px] p-1.5 text-foreground-muted hover:bg-surface-alt hover:text-foreground"
            aria-label="Close thread"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        </div>
      </div>

      {/* Scroll area: parent message + divider + replies */}
      <div ref={scrollRef} className="flex flex-1 flex-col overflow-y-auto pb-3">
        {root && (
          <>
            <div className="pt-2">
              <MessageBubble message={root} inThread highlighted={highlightId === root.id} />
            </div>
            {replies.length > 0 && (
              <div className="sqc-thread-divider">
                {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
              </div>
            )}
          </>
        )}
        {replies.map((r) => (
          <MessageBubble
            key={r.id}
            message={r}
            inThread
            highlighted={highlightId === r.id}
            animateIn={arrivingReplyIds.has(r.id)}
          />
        ))}
      </div>

      {/* Guidance banner for open bot doubt */}
      {isBotDoubt && isClosed && (
        <div className="mx-4 mb-2 flex items-center justify-between gap-2 rounded-lg border border-divider/60 bg-surface-alt/50 px-3 py-2 text-xs">
          <span className="text-foreground-muted">
            ✓ This conversation is closed. Reopen to resume chatting with Squad Bot.
          </span>
          <button
            type="button"
            onClick={toggleCloseDoubt}
            className="shrink-0 rounded-md border border-divider bg-surface px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-surface-alt transition cursor-pointer"
          >
            Reopen
          </button>
        </div>
      )}
      {isBotDoubt && doubtStatus === 'open' && !isClosed && (
        <div className="mx-4 mb-2 flex items-center justify-between gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs">
          <span className="text-foreground-muted">
            Chatting with Squad Bot. When ready, finalize guidance to queue the reply.
          </span>
          <button
            type="button"
            onClick={() => {
              // Prefill from the last teammate message, not the bot's reply.
              const lastHuman = [...replies].reverse().find((m) => m.sender_id !== root?.sender_id && (m.content || '').trim() && !m.content?.startsWith('🔒') && !m.content?.startsWith('🔓'));
              setFinalizeText(lastHuman?.content || '');
              setFinalizeOpen(true);
            }}
            className="shrink-0 rounded-md bg-foreground px-2.5 py-1 text-xs font-semibold text-surface shadow-2xs hover:opacity-90 transition cursor-pointer"
          >
            💡 Finalize guidance
          </button>
        </div>
      )}

      <TypingIndicator users={typingUsers} />
      {/* Composer (posts with parent_message_id) */}
      <MessageComposer
        ref={composerRef}
        channelId={channelId}
        kind={kind}
        parentMessageId={parentId}
        placeholder={isClosed ? 'This conversation is closed — reopen to resume…' : root?.metadata?.kind === 'bot_doubt' ? 'Chat with Squad Bot… (ask to search, check details, or guide)' : 'Reply…'}
        onSend={() => queryClient.invalidateQueries({ queryKey })}
      />

      {/* Finalize guidance modal */}
      {finalizeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-divider bg-surface p-4 shadow-xl">
            <h4 className="text-base font-bold text-foreground">Finalize guidance</h4>
            <p className="mt-1 text-xs text-foreground-muted">
              Save this guidance for Squad Bot and queue the reply to send to the candidate.
            </p>
            <textarea
              className="mt-3 w-full rounded-lg border border-divider bg-surface-alt/50 p-2.5 text-xs text-foreground placeholder:text-foreground-dim focus:outline-none focus:ring-1 focus:ring-foreground"
              rows={3}
              placeholder="e.g. Ask him to share a screenshot of the error..."
              value={finalizeText}
              onChange={(e) => setFinalizeText(e.target.value)}
              autoFocus
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFinalizeOpen(false)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-foreground-muted hover:bg-surface-alt transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={finalizing || !finalizeText.trim()}
                onClick={finalizeGuidance}
                className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-surface hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {finalizing ? 'Saving…' : 'Save & queue reply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
