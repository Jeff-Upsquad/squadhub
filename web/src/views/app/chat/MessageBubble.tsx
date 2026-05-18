import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Message, Reaction } from '@squadhub/shared';
import api from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import EmojiPicker from './EmojiPicker';
import LinkUnfurlCard from './LinkUnfurlCard';

// ---- Mention rendering ----
function renderContent(text: string) {
  // Split on URLs, mentions, and newlines; keep them as standalone tokens.
  const parts = text.split(/(@\w+|https?:\/\/[^\s]+|\n)/g);
  return parts.map((part, i) => {
    if (part === '\n') return <br key={i} />;
    if (part.startsWith('@')) {
      return (
        <span
          key={i}
          className="inline-flex items-center justify-center rounded-[2px] bg-[rgba(18,100,163,0.1)] px-1 py-[2px] font-[Lato] text-[15px] leading-[22px] text-[#1264A3]"
        >
          {part}
        </span>
      );
    }
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#1264A3] underline decoration-[#1264A3]/40 hover:decoration-[#1264A3]"
        >
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ---- Date separator ----
export function DateSeparator({ date }: { date: string }) {
  return (
    <div className="relative h-[32px] w-full">
      <div className="absolute left-0 top-[15px] h-px w-full bg-divider" />
      <div className="absolute left-1/2 top-0 -translate-x-1/2 rounded-[100px] border border-divider bg-surface px-4 py-2">
        <span className="font-[Lato] text-[12px] font-bold leading-[16px] text-foreground whitespace-nowrap">{date}</span>
      </div>
    </div>
  );
}

// ---- Format bytes ----
function fmtBytes(b?: number | null) {
  if (!b || b <= 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

// ---- Audio duration formatter ----
function fmtDuration(ms?: number | null) {
  if (!ms || ms < 1000) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---- Reactions ----
function ReactionsRow({
  message,
  onToggle,
  onOpenPicker,
}: {
  message: Message;
  onToggle: (emoji: string) => void;
  onOpenPicker: () => void;
}) {
  const meId = useAuthStore((s) => s.user?.id);
  const reactions = message.reactions || [];
  if (reactions.length === 0) return null;

  // Group by emoji
  const groups = new Map<string, Reaction[]>();
  for (const r of reactions) {
    if (!groups.has(r.emoji)) groups.set(r.emoji, []);
    groups.get(r.emoji)!.push(r);
  }

  return (
    <div className="flex flex-wrap items-center gap-[4px]">
      {Array.from(groups.entries()).map(([emoji, rs]) => {
        const mine = !!meId && rs.some((r) => r.user_id === meId);
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onToggle(emoji)}
            className={`box-border flex items-center gap-[6px] rounded-[100px] border-[0.5px] px-[6px] py-[4px] transition ${
              mine
                ? 'border-[#1264A3] bg-[rgba(18,100,163,0.1)] hover:bg-[rgba(18,100,163,0.18)]'
                : 'border-divider bg-surface-alt hover:bg-divider'
            }`}
            title={mine ? 'Click to remove your reaction' : 'Click to add your reaction'}
          >
            <span className="text-[14px] leading-[16px]">{emoji}</span>
            <span className="font-[Lato] text-[12px] font-medium leading-[16px] text-foreground">{rs.length}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onOpenPicker}
        className="flex items-start rounded-[100px] bg-surface-alt px-[8px] py-[4px] hover:bg-divider transition"
        title="Add reaction"
      >
        <svg className="h-4 w-[15.5px]" viewBox="0 0 15.5 16" fill="none">
          <circle cx="7.75" cy="8" r="7" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="5.5" cy="6.5" r="0.8" fill="currentColor" />
          <circle cx="10" cy="6.5" r="0.8" fill="currentColor" />
          <path d="M5 10c.8 1.2 2.2 2 3.75 2s2.95-.8 3.75-2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" fill="none" />
        </svg>
      </button>
    </div>
  );
}

// ---- Hover action bar ----
function HoverActions({
  onAddReaction,
  onReplyInThread,
}: {
  onAddReaction: () => void;
  onReplyInThread?: () => void;
}) {
  return (
    <div className="absolute -top-3 right-4 hidden rounded-md border border-divider bg-surface shadow-sm group-hover:flex">
      <button
        type="button"
        onClick={onAddReaction}
        className="p-1.5 text-foreground-dim hover:bg-surface-alt hover:text-foreground transition"
        title="Add reaction"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75z" />
        </svg>
      </button>
      {onReplyInThread && (
        <button
          type="button"
          onClick={onReplyInThread}
          className="p-1.5 text-foreground-dim hover:bg-surface-alt hover:text-foreground transition"
          title="Reply in thread"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ---- Attachment renderers ----
function AttachmentBlock({ message }: { message: Message }) {
  if (!message.file_url) return null;
  const mime = message.file_mime || '';

  if (message.type === 'image' || mime.startsWith('image/')) {
    return (
      <a href={message.file_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block">
        <img
          src={message.file_url}
          alt={message.file_name || 'image'}
          className="max-h-[360px] max-w-[480px] rounded-[8px] border border-divider object-cover"
          loading="lazy"
        />
      </a>
    );
  }

  if (message.type === 'audio' || mime.startsWith('audio/')) {
    return (
      <div className="mt-2 flex items-center gap-3 rounded-[8px] border border-divider bg-surface-alt p-2">
        <audio controls src={message.file_url} className="h-8" />
        {message.duration_ms && (
          <span className="text-[12px] text-foreground-muted">{fmtDuration(message.duration_ms)}</span>
        )}
      </div>
    );
  }

  if (message.type === 'video' || mime.startsWith('video/')) {
    return (
      <video controls src={message.file_url} className="mt-2 max-h-[360px] max-w-[480px] rounded-[8px] border border-divider" />
    );
  }

  if (mime === 'application/pdf') {
    return (
      <div className="mt-2 flex max-w-[520px] flex-col gap-2">
        <object
          data={message.file_url}
          type="application/pdf"
          className="h-[420px] w-full rounded-[8px] border border-divider"
        >
          <a href={message.file_url} target="_blank" rel="noopener noreferrer" className="text-[#1264A3] underline">
            Open PDF
          </a>
        </object>
        <div className="flex items-center gap-2 text-[12px] text-foreground-muted">
          <span className="truncate">{message.file_name || 'document.pdf'}</span>
          <span>·</span>
          <span>{fmtBytes(message.file_size)}</span>
          <a
            href={message.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-[#1264A3] hover:underline"
          >
            Download
          </a>
        </div>
      </div>
    );
  }

  // Generic file
  return (
    <a
      href={message.file_url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex max-w-[420px] items-center gap-3 rounded-[8px] border border-divider bg-surface-alt p-3 hover:bg-divider transition"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-[#E2E8F0]">
        <svg className="h-5 w-5 text-[#0F172B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[14px] font-medium text-foreground">{message.file_name || 'attachment'}</span>
        <span className="text-[12px] text-foreground-muted">{fmtBytes(message.file_size)}</span>
      </span>
    </a>
  );
}

// ---- Thread bar (real, with reply_count) ----
function ThreadReplyBar({ replyCount, onClick }: { replyCount: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 flex w-fit items-center gap-[7px] rounded-[4px] border border-divider bg-surface px-[8px] py-[4px] hover:border-[#1264A3] hover:bg-[rgba(18,100,163,0.06)] transition"
    >
      <span className="font-[Lato] text-[12px] font-semibold leading-[16px] text-[#1364A3]">
        {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
      </span>
      <span className="font-[Lato] text-[12px] font-normal leading-[16px] text-foreground-muted">View thread</span>
      <svg className="h-[10px] w-[10px] text-foreground-muted" viewBox="0 0 12 12" fill="none">
        <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// ---- Main component ----
interface Props {
  message: Message;
  onOpenThread?: () => void;
  inThread?: boolean;
}

export default function MessageBubble({ message, onOpenThread, inThread }: Props) {
  const queryClient = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);
  const sender = message.sender;
  const time = useMemo(
    () => new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    [message.created_at],
  );

  const toggleReaction = async (emoji: string) => {
    try {
      await api.post(`/messages/${message.id}/reactions`, { emoji });
      // Optimistic refresh — socket will also fire new_reaction.
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['thread', message.parent_message_id || message.id] });
    } catch (err) {
      console.error('Reaction toggle failed:', err);
    }
  };

  const initials = (sender?.display_name?.[0] || '?').toUpperCase();
  const replyCount = message.reply_count || 0;
  const showThreadBar = !inThread && replyCount > 0 && onOpenThread;

  return (
    <div className="group relative flex gap-[6px] px-[20px] py-[10px] hover:bg-surface-alt">
      <HoverActions
        onAddReaction={() => setShowPicker(true)}
        onReplyInThread={!inThread && onOpenThread ? onOpenThread : undefined}
      />
      {showPicker && (
        <div className="absolute right-4 top-4 z-50">
          <EmojiPicker
            onPick={(em) => {
              toggleReaction(em);
              setShowPicker(false);
            }}
            onClose={() => setShowPicker(false)}
          />
        </div>
      )}

      {/* Avatar */}
      <div className="flex items-center py-[3px]">
        <div className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-[6px] bg-[#E2E8F0] text-sm font-bold text-[#0F172B] overflow-hidden">
          {sender?.avatar_url ? (
            <img src={sender.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            initials
          )}
        </div>
      </div>

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
        {/* Header row with name + time */}
        <div className="flex items-baseline gap-[10px]">
          <span className="font-[Lato] text-[15px] font-black leading-[22px] text-foreground">
            {sender?.display_name || 'Unknown'}
          </span>
          <span className="font-[Lato] text-[12px] font-normal leading-[16px] text-foreground-muted">{time}</span>
        </div>

        {/* Text content (with mentions + URL links) */}
        {message.content && (
          <p className="whitespace-pre-wrap break-words font-[Lato] text-[15px] font-normal leading-[22px] text-foreground">
            {renderContent(message.content)}
          </p>
        )}

        {/* Link unfurl */}
        {message.unfurl && <LinkUnfurlCard unfurl={message.unfurl} />}

        {/* Attachment */}
        <AttachmentBlock message={message} />

        {/* Reactions */}
        <ReactionsRow
          message={message}
          onToggle={toggleReaction}
          onOpenPicker={() => setShowPicker(true)}
        />

        {/* Thread reply bar */}
        {showThreadBar && (
          <ThreadReplyBar replyCount={replyCount} onClick={onOpenThread!} />
        )}
      </div>
    </div>
  );
}
