import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Message } from '@squadhub/shared';
import api from '../../../services/api';
import { openExternalUrl } from '../../../lib/openExternal';

type BotDoubtMeta = {
  kind: 'bot_doubt';
  doubt_id: string;
  bot_id: string;
  question?: string;
  context?: string;
  source_url?: string;
  status: 'open' | 'instructed' | 'executing' | 'taken_over' | 'completed' | 'failed' | string;
  instruction?: string | null;
  outcome_note?: string | null;
  is_closed?: boolean;
  closed_at?: string | null;
  closed_by?: string | null;
};

const STATUS_CONFIG: Record<string, { label: string; badgeCls: string; dotCls: string }> = {
  open: {
    label: 'Needs your help',
    badgeCls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    dotCls: 'bg-amber-500',
  },
  instructed: {
    label: 'Guidance saved · awaiting bot',
    badgeCls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    dotCls: 'bg-blue-500 animate-pulse',
  },
  executing: {
    label: 'Bot is taking action',
    badgeCls: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
    dotCls: 'bg-indigo-500 animate-pulse',
  },
  taken_over: {
    label: 'Taken over by teammate',
    badgeCls: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
    dotCls: 'bg-slate-500',
  },
  completed: {
    label: 'Action completed',
    badgeCls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    dotCls: 'bg-emerald-500',
  },
  failed: {
    label: 'Action failed',
    badgeCls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    dotCls: 'bg-rose-500',
  },
};

function sanitizeSourceUrl(value?: string | null): string | null {
  if (!value) return null;
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? value : null;
  } catch {
    return null;
  }
}

export default function BotDoubtCard({
  message,
  onOpenThread,
  inThread,
}: {
  message: Message;
  onOpenThread?: () => void;
  inThread?: boolean;
}) {
  const qc = useQueryClient();
  const [contextOpen, setContextOpen] = useState(false);
  const meta = message.metadata as BotDoubtMeta | undefined;

  const doubtId = meta?.doubt_id;
  const channelId = message.channel_id;
  const status = meta?.status || 'open';
  const source = sanitizeSourceUrl(meta?.source_url);
  const context = meta?.context;
  const outcomeNote = meta?.outcome_note;
  const savedInstruction = meta?.instruction;

  const isClosed = !!meta?.is_closed;
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizeText, setFinalizeText] = useState(savedInstruction || '');

  // savedInstruction arrives with the message payload — keep the draft in sync
  // until the user opens the modal and starts typing.
  useEffect(() => {
    if (!finalizeOpen) setFinalizeText(savedInstruction || '');
  }, [savedInstruction, finalizeOpen]);

  const statusInfo = STATUS_CONFIG[status] || {
    label: status,
    badgeCls: 'bg-muted/30 text-foreground-muted border-border',
    dotCls: 'bg-foreground-muted',
  };

  const closeMutation = useMutation({
    mutationFn: (closed: boolean) =>
      api.post(`/bot-channels/${channelId}/doubts/${doubtId}/close`, { closed }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['thread', message.id] });
    },
    onError: (err: any) => {
      console.error('Toggle closed failed:', err);
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: (instruction: string) =>
      api.post(`/bot-channels/${channelId}/doubts/${doubtId}/resolve`, {
        mode: 'instruct',
        instruction: instruction.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['thread', message.id] });
      setFinalizeOpen(false);
    },
    onError: (err: any) => {
      console.error('Finalize guidance failed:', err);
    },
  });

  const takeoverMutation = useMutation({
    mutationFn: () =>
      api.post(`/bot-channels/${channelId}/doubts/${doubtId}/resolve`, {
        mode: 'takeover',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      qc.invalidateQueries({ queryKey: ['thread', message.id] });
      if (source) {
        openExternalUrl(source);
      }
    },
    onError: (err: any) => {
      console.error('Takeover failed:', err);
    },
  });

  const canTakeover = source && ['open', 'instructed', 'failed'].includes(status);

  return (
    <div className="mt-2.5 max-w-xl rounded-xl border border-divider/70 bg-surface/50 p-3.5 shadow-xs backdrop-blur-xs transition-colors hover:border-divider">
      {/* Top row: Status pill + Closed toggle */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusInfo.badgeCls}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusInfo.dotCls}`} />
            {statusInfo.label}
          </span>
          {isClosed && (
            <span className="inline-flex items-center gap-1 rounded-full border border-divider/60 bg-surface px-2 py-0.5 text-[10px] font-semibold text-foreground-muted">
              ✓ Closed
            </span>
          )}
        </div>

        {doubtId && (
          <button
            type="button"
            disabled={closeMutation.isPending}
            onClick={() => closeMutation.mutate(!isClosed)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-foreground-muted hover:bg-surface-alt hover:text-foreground transition-colors cursor-pointer border border-divider/40"
            title={isClosed ? 'Reopen this conversation' : 'Mark this conversation as closed'}
          >
            <span>{isClosed ? 'Reopen conversation' : 'Mark as closed'}</span>
          </button>
        )}
      </div>

      {/* Context collapsible section */}
      {context && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setContextOpen((o) => !o)}
            className="group flex items-center gap-1.5 text-xs text-foreground-muted hover:text-foreground"
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform duration-150 ${contextOpen ? 'rotate-90' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                clipRule="evenodd"
              />
            </svg>
            <span>{contextOpen ? 'Hide context' : 'Show context'}</span>
          </button>
          {contextOpen && (
            <div className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-alt/70 p-2.5 text-xs text-foreground-muted border border-divider/40">
              {context}
            </div>
          )}
        </div>
      )}

      {/* Saved instruction note if present */}
      {savedInstruction && (
        <div className="mt-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5 p-2.5 text-xs text-foreground">
          <span className="font-semibold text-blue-600 dark:text-blue-400">Saved guidance: </span>
          <span className="whitespace-pre-wrap">{savedInstruction}</span>
        </div>
      )}

      {/* Outcome note if present */}
      {outcomeNote && (
        <div className="mt-2.5 rounded-lg border border-divider/50 bg-surface-alt/60 p-2.5 text-xs text-foreground">
          <span className="font-semibold text-foreground-muted">Outcome: </span>
          <span className="whitespace-pre-wrap">{outcomeNote}</span>
        </div>
      )}

      {/* The Action Buttons */}
      <div className="mt-3 flex flex-wrap items-center gap-2 pt-1 border-t border-divider/40">
        {/* Button 1: Open source */}
        {source && (
          <button
            type="button"
            onClick={() => openExternalUrl(source)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-divider bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-alt transition-colors cursor-pointer"
            title="Open original conversation in CRM"
          >
            <span>Open source</span>
            <span className="text-[11px] opacity-70">↗</span>
          </button>
        )}

        {/* Button 2: Tell bot what to do (fixed readable colors) */}
        {!inThread && onOpenThread && (
          <button
            type="button"
            onClick={onOpenThread}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              status === 'open'
                ? 'bg-foreground text-surface hover:opacity-90 shadow-2xs'
                : 'border border-divider bg-surface text-foreground hover:bg-surface-alt'
            }`}
            title="Open a thread chat with the bot to discuss or give instructions"
          >
            <span>💬 Tell bot what to do</span>
          </button>
        )}

        {/* Button: Finalize guidance inside thread */}
        {inThread && status === 'open' && !isClosed && doubtId && (
          <button
            type="button"
            onClick={() => setFinalizeOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-semibold text-surface hover:opacity-90 shadow-2xs transition-colors cursor-pointer"
            title="Save guidance and queue reply to candidate"
          >
            <span>💡 Finalize guidance</span>
          </button>
        )}

        {/* Button 3: Take over */}
        {canTakeover && (
          <button
            type="button"
            disabled={takeoverMutation.isPending}
            onClick={() => takeoverMutation.mutate()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-divider bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-alt transition-colors disabled:opacity-50 cursor-pointer"
            title="Take over this conversation and stop bot automation"
          >
            <span>{takeoverMutation.isPending ? 'Taking over…' : 'Take over'}</span>
            <span className="text-[11px] opacity-70">↗</span>
          </button>
        )}
      </div>

      {takeoverMutation.isError && (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
          {(takeoverMutation.error as any)?.response?.data?.error || 'Could not take over conversation'}
        </p>
      )}
      {closeMutation.isError && (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
          {(closeMutation.error as any)?.response?.data?.error || 'Could not update conversation status'}
        </p>
      )}

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
            {finalizeMutation.isError && (
              <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
                {(finalizeMutation.error as any)?.response?.data?.error || 'Could not save guidance'}
              </p>
            )}
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
                disabled={finalizeMutation.isPending || !finalizeText.trim()}
                onClick={() => finalizeMutation.mutate(finalizeText)}
                className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-surface hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {finalizeMutation.isPending ? 'Saving…' : 'Save & queue reply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
