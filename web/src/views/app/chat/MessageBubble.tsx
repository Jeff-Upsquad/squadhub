import { Fragment, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Message, Reaction } from '@squadhub/shared';
import api from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import EmojiPicker from './EmojiPicker';
import LinkUnfurlCard from './LinkUnfurlCard';

// ---- Markdown rendering ----
// Supports the formatting available in the composer toolbar:
//   **bold**, _italic_, ~~strike~~, `code`, [text](url),
//   ```code fence```, > blockquote, - bullet list, 1. numbered list,
//   plus @mentions and bare URLs.
const SELF_MENTIONS = new Set(['@channel', '@here', '@everyone']);
const INLINE_RE = /(\*\*[^*\n]+\*\*|_[^_\n]+_|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)|@\w+|https?:\/\/[^\s]+)/g;

function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(INLINE_RE);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('_') && part.endsWith('_') && part.length >= 3) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('~~') && part.endsWith('~~') && part.length >= 4) {
      return <del key={key}>{part.slice(2, -2)}</del>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return <code key={key} className="sqc-inline-code">{part.slice(1, -1)}</code>;
    }
    const linkM = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (linkM) {
      return (
        <a key={key} href={linkM[2]} target="_blank" rel="noopener noreferrer" className="sqc-link">
          {linkM[1]}
        </a>
      );
    }
    if (part.startsWith('@')) {
      const isSelf = SELF_MENTIONS.has(part.toLowerCase());
      return (
        <span key={key} className={`sqc-mention${isSelf ? ' sqc-mention--self' : ''}`}>
          {part}
        </span>
      );
    }
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={key} href={part} target="_blank" rel="noopener noreferrer" className="sqc-link">
          {part}
        </a>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

function isBullet(line: string) {
  return line.startsWith('- ') || line === '-';
}
function isNumbered(line: string) {
  return /^\d+\.\s/.test(line);
}
function isQuote(line: string) {
  return line.startsWith('> ') || line === '>';
}

function renderContent(text: string) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let bk = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code fence
    if (line.trim() === '```') {
      const start = i + 1;
      let end = start;
      while (end < lines.length && lines[end].trim() !== '```') end++;
      blocks.push(
        <pre key={`b${bk++}`} className="sqc-codeblock">
          <code>{lines.slice(start, end).join('\n')}</code>
        </pre>,
      );
      i = end < lines.length ? end + 1 : end;
      continue;
    }

    // Blockquote
    if (isQuote(line)) {
      const items: string[] = [];
      while (i < lines.length && isQuote(lines[i])) {
        items.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote key={`b${bk++}`} className="sqc-quote">
          {items.map((l, j) => (
            <Fragment key={j}>
              {renderInline(l, `q${bk}-${j}`)}
              {j < items.length - 1 && <br />}
            </Fragment>
          ))}
        </blockquote>,
      );
      continue;
    }

    // Bullet list
    if (isBullet(line)) {
      const items: string[] = [];
      while (i < lines.length && isBullet(lines[i])) {
        items.push(lines[i].replace(/^-\s?/, ''));
        i++;
      }
      blocks.push(
        <ul key={`b${bk++}`} className="sqc-list">
          {items.map((l, j) => <li key={j}>{renderInline(l, `ul${bk}-${j}`)}</li>)}
        </ul>,
      );
      continue;
    }

    // Numbered list
    if (isNumbered(line)) {
      const items: string[] = [];
      while (i < lines.length && isNumbered(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ''));
        i++;
      }
      blocks.push(
        <ol key={`b${bk++}`} className="sqc-list">
          {items.map((l, j) => <li key={j}>{renderInline(l, `ol${bk}-${j}`)}</li>)}
        </ol>,
      );
      continue;
    }

    // Paragraph: collect consecutive plain lines
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '```' &&
      !isQuote(lines[i]) &&
      !isBullet(lines[i]) &&
      !isNumbered(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`b${bk++}`} className="sqc-paragraph">
        {para.map((l, j) => (
          <Fragment key={j}>
            {renderInline(l, `p${bk}-${j}`)}
            {j < para.length - 1 && <br />}
          </Fragment>
        ))}
      </p>,
    );
  }
  return blocks;
}

// ---- Date separator ----
export function DateSeparator({ date }: { date: string }) {
  return (
    <div className="sqc-day-divider">
      <div className="sqc-day-divider__label">{date}</div>
    </div>
  );
}

// ---- Format helpers ----
function fmtBytes(b?: number | null) {
  if (!b || b <= 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
function fmtDuration(ms?: number | null) {
  if (!ms || ms < 1000) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---- Reactions row (pill chips with hover-to-see-reactors) ----
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

  const groups = new Map<string, Reaction[]>();
  for (const r of reactions) {
    if (!groups.has(r.emoji)) groups.set(r.emoji, []);
    groups.get(r.emoji)!.push(r);
  }

  const reactorLabel = (rs: Reaction[]) => {
    const names = rs.map((r) => {
      if (r.user_id === meId) return 'You';
      const u = (r as Reaction & { user?: { display_name?: string | null } }).user;
      return u?.display_name || 'Someone';
    });
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
  };

  return (
    <div className="sqc-reactions">
      {Array.from(groups.entries()).map(([emoji, rs]) => {
        const mine = !!meId && rs.some((r) => r.user_id === meId);
        return (
          <span key={emoji} className="sqc-reaction-wrap">
            <button
              type="button"
              onClick={() => onToggle(emoji)}
              className={`sqc-reaction${mine ? ' is-mine' : ''}`}
              title={mine ? 'Click to remove your reaction' : 'Click to add your reaction'}
            >
              <span className="sqc-reaction__emoji">{emoji}</span>
              <span>{rs.length}</span>
            </button>
            <span className="sqc-reaction__tip" role="tooltip">
              <span className="sqc-reaction__tip-emoji">{emoji}</span>
              <span className="sqc-reaction__tip-names">{reactorLabel(rs)}</span>
              <span className="sqc-reaction__tip-action">{mine ? 'Click to remove' : 'Click to react'}</span>
            </span>
          </span>
        );
      })}
      <button type="button" onClick={onOpenPicker} className="sqc-reaction__add" title="Add reaction">
        <svg className="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75z" />
        </svg>
      </button>
    </div>
  );
}

// ---- Hover actions toolbar ----
function HoverActions({
  onAddReaction,
  onReplyInThread,
}: {
  onAddReaction: () => void;
  onReplyInThread?: () => void;
}) {
  return (
    <div className="sqc-msg__hover" onClick={(e) => e.stopPropagation()}>
      <button type="button" title="Mark as complete">
        <span style={{ fontSize: 14 }}>✓</span>
      </button>
      <button type="button" onClick={onAddReaction} title="Add reaction">
        <svg className="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75z" />
        </svg>
      </button>
      {onReplyInThread && (
        <button type="button" onClick={onReplyInThread} title="Reply in thread">
          <svg className="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
          </svg>
        </button>
      )}
      <button type="button" title="Save">
        <svg className="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
        </svg>
      </button>
      <button type="button" title="More">
        <span style={{ fontSize: 16, lineHeight: 0.7 }}>⋯</span>
      </button>
    </div>
  );
}

// ---- Attachment renderers (unchanged behavior, restyled with sh tokens) ----
function AttachmentBlock({ message }: { message: Message }) {
  if (!message.file_url) return null;
  const mime = message.file_mime || '';

  if (message.type === 'image' || mime.startsWith('image/')) {
    return (
      <a href={message.file_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block">
        <img
          src={message.file_url}
          alt={message.file_name || 'image'}
          className="max-h-[360px] max-w-[480px] rounded-[8px] border border-[var(--sh-border)] object-cover"
          loading="lazy"
        />
      </a>
    );
  }

  if (message.type === 'audio' || mime.startsWith('audio/')) {
    return (
      <div className="mt-2 flex items-center gap-3 rounded-[8px] border border-[var(--sh-border)] bg-[var(--sh-bg-soft)] p-2">
        <audio controls src={message.file_url} className="h-8" />
        {message.duration_ms && (
          <span className="text-[12px] text-[var(--sh-text-2)]">{fmtDuration(message.duration_ms)}</span>
        )}
      </div>
    );
  }

  if (message.type === 'video' || mime.startsWith('video/')) {
    return (
      <video
        controls
        src={message.file_url}
        className="mt-2 max-h-[360px] max-w-[480px] rounded-[8px] border border-[var(--sh-border)]"
      />
    );
  }

  if (mime === 'application/pdf') {
    return (
      <div className="mt-2 flex max-w-[520px] flex-col gap-2">
        <object data={message.file_url} type="application/pdf" className="h-[420px] w-full rounded-[8px] border border-[var(--sh-border)]">
          <a href={message.file_url} target="_blank" rel="noopener noreferrer" className="sqc-link underline">
            Open PDF
          </a>
        </object>
        <div className="flex items-center gap-2 text-[12px] text-[var(--sh-text-2)]">
          <span className="truncate">{message.file_name || 'document.pdf'}</span>
          <span>·</span>
          <span>{fmtBytes(message.file_size)}</span>
          <a href={message.file_url} target="_blank" rel="noopener noreferrer" className="ml-auto sqc-link hover:underline">
            Download
          </a>
        </div>
      </div>
    );
  }

  return (
    <a
      href={message.file_url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex max-w-[420px] items-center gap-3 rounded-[8px] border border-[var(--sh-border)] bg-[var(--sh-bg-soft)] p-3 hover:bg-[var(--sh-bg-hover)] transition"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-[#E2E8F0]">
        <svg className="h-5 w-5 text-[#0F172B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[14px] font-medium text-[var(--sh-text)]">{message.file_name || 'attachment'}</span>
        <span className="text-[12px] text-[var(--sh-text-2)]">{fmtBytes(message.file_size)}</span>
      </span>
    </a>
  );
}

// ---- Thread footer ----
type ThreadParticipant = { id: string; display_name?: string | null; avatar_url?: string | null };

function ParticipantAvatar({ p }: { p: ThreadParticipant }) {
  const initials = (p.display_name?.[0] || '?').toUpperCase();
  const bg = (() => {
    if (p.avatar_url) return undefined;
    let h = 0;
    for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) % 360;
    return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 65% 45%))`;
  })();
  return (
    <span style={{ background: bg }} title={p.display_name || ''}>
      {p.avatar_url ? <img src={p.avatar_url} alt="" /> : initials}
    </span>
  );
}

function fmtReplyTime(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today at ${time}`;
  if (isYesterday) return `Yesterday at ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' at ' + time;
}

function ThreadFoot({
  replyCount,
  participants,
  lastReplyAt,
  onClick,
}: {
  replyCount: number;
  participants?: ThreadParticipant[];
  lastReplyAt?: string | null;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="sqc-thread-foot">
      {participants && participants.length > 0 && (
        <div className="sqc-thread-foot__avs">
          {participants.slice(0, 4).map((p) => (
            <ParticipantAvatar key={p.id} p={p} />
          ))}
        </div>
      )}
      <span className="sqc-thread-foot__count">
        {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
      </span>
      <span className="sqc-thread-foot__last">
        {lastReplyAt ? `Last reply ${fmtReplyTime(lastReplyAt)}` : 'View thread'}
      </span>
    </button>
  );
}

// ---- Main ----
interface ThreadMeta {
  count: number;
  participants: ThreadParticipant[];
  lastReplyAt: string;
}
interface Props {
  message: Message;
  onOpenThread?: () => void;
  inThread?: boolean;
  grouped?: boolean;
  threadMeta?: ThreadMeta;
}

export default function MessageBubble({ message, onOpenThread, inThread, grouped, threadMeta }: Props) {
  const queryClient = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);
  const sender = message.sender;
  const meId = useAuthStore((s) => s.user?.id);
  const time = useMemo(
    () => new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    [message.created_at],
  );
  const timeMini = time.replace(/\s?[AP]M/i, '');

  const toggleReaction = async (emoji: string) => {
    try {
      await api.post(`/messages/${message.id}/reactions`, { emoji });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['thread', message.parent_message_id || message.id] });
    } catch (err) {
      console.error('Reaction toggle failed:', err);
    }
  };

  const initials = (sender?.display_name?.[0] || '?').toUpperCase();
  // Prefer client-computed thread meta (works even if DB reply_count is missing),
  // fall back to the server's denormalized count.
  const serverReplyCount = (message as Message & { reply_count?: number }).reply_count || 0;
  const replyCount = threadMeta?.count ?? serverReplyCount;
  const threadParticipants = threadMeta?.participants
    ?? (message as unknown as { thread_participants?: ThreadParticipant[] }).thread_participants
    ?? [];
  const lastReplyAt = threadMeta?.lastReplyAt
    ?? (message as unknown as { last_reply_at?: string | null }).last_reply_at
    ?? null;
  const showThreadBar = !inThread && replyCount > 0 && onOpenThread;
  const isMentioned = useMemo(() => {
    if (!message.mentions || !meId) return false;
    return message.mentions.includes(meId);
  }, [message.mentions, meId]);

  // Stable avatar gradient when there's no avatar_url
  const avatarBg = useMemo(() => {
    if (sender?.avatar_url) return undefined;
    const id = sender?.id || message.sender_id || 'x';
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 65% 45%))`;
  }, [sender, message.sender_id]);

  const cls =
    'sqc-msg' + (grouped ? ' is-grouped' : '') + (isMentioned ? ' is-mentioned' : '');

  return (
    <div className={cls}>
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

      <div className="sqc-msg__gutter">
        {grouped ? (
          <div className="sqc-msg__time-mini">{timeMini}</div>
        ) : (
          <div className="sqc-msg__avatar" style={{ background: avatarBg }} title={sender?.display_name || ''}>
            {sender?.avatar_url ? <img src={sender.avatar_url} alt="" /> : initials}
          </div>
        )}
      </div>

      <div className="sqc-msg__body">
        {!grouped && (
          <div className="sqc-msg__header">
            <span className="sqc-msg__author">{sender?.display_name || 'Unknown'}</span>
            <span className="sqc-msg__time">{time}</span>
          </div>
        )}

        {message.content && <div className="sqc-msg__content">{renderContent(message.content)}</div>}

        {message.unfurl && <LinkUnfurlCard unfurl={message.unfurl} />}
        <AttachmentBlock message={message} />

        <ReactionsRow message={message} onToggle={toggleReaction} onOpenPicker={() => setShowPicker(true)} />

        {showThreadBar && (
          <ThreadFoot
            replyCount={replyCount}
            participants={threadParticipants}
            lastReplyAt={lastReplyAt}
            onClick={onOpenThread!}
          />
        )}
      </div>
    </div>
  );
}
