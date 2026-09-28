import { useState } from 'react';
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

  const statusInfo = STATUS_CONFIG[status] || {
    label: status,
    badgeCls: 'bg-muted/30 text-foreground-muted border-border',
    dotCls: 'bg-foreground-muted',
  };

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
      {/* Top row: Status pill */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusInfo.badgeCls}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${statusInfo.dotCls}`} />
          {statusInfo.label}
        </span>
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

      {/* The Three Action Buttons */}
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

        {/* Button 2: Tell bot what to do */}
        {!inThread && onOpenThread && (
          <button
            type="button"
            onClick={onOpenThread}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              status === 'open'
                ? 'bg-foreground text-background hover:opacity-90 shadow-2xs'
                : 'border border-divider bg-surface text-foreground hover:bg-surface-alt'
            }`}
            title="Open a thread chat with the bot to give instructions"
          >
            <span>💬 Tell bot what to do</span>
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
    </div>
  );
}
