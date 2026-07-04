import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Message, Reaction } from '@squadhub/shared';
import api from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import EmojiPicker from './EmojiPicker';
import ImageLightbox from './ImageLightbox';
import LinkUnfurlCard from './LinkUnfurlCard';
import MeetingPollCard from './MeetingPollCard';
import { URL_PATTERN, URL_TEST, splitTrailingPunct, toHref } from '../../../lib/urlPattern';

// ---- Markdown rendering ----
// Supports the formatting available in the composer toolbar:
//   **bold**, _italic_, ~~strike~~, `code`, [text](url),
//   ```code fence```, > blockquote, - bullet list, 1. numbered list,
//   plus @mentions and bare URLs.
const SELF_MENTIONS = new Set(['@channel', '@here', '@everyone']);

// Inline markdown + @mentions + URLs. URL matching is shared with the rest of
// the app via URL_PATTERN (which contributes no capture groups, so the outer
// group below stays the single capture that String.split relies on).
const INLINE_RE = new RegExp(
  String.raw`(\*\*[^*\n]+\*\*|_[^_\n]+_|~~[^~\n]+~~|` +
    '`[^`\\n]+`' +
    String.raw`|\[[^\]\n]+\]\([^)\s]+\)|@\w+|${URL_PATTERN})`,
  'gi',
);

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
    if (URL_TEST.test(part)) {
      const { url, tail } = splitTrailingPunct(part);
      return (
        <Fragment key={key}>
          <a href={toHref(url)} target="_blank" rel="noopener noreferrer" className="sqc-link">
            {url}
          </a>
          {tail}
        </Fragment>
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
  onMore,
  showMore,
}: {
  onAddReaction: () => void;
  onReplyInThread?: () => void;
  onMore?: () => void;
  showMore?: boolean;
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
      {showMore && (
        <button type="button" onClick={onMore} title="More">
          <span style={{ fontSize: 16, lineHeight: 0.7 }}>⋯</span>
        </button>
      )}
    </div>
  );
}

// ---- Message action menu (⋯) ----
function MessageActionMenu({
  canEdit,
  canDelete,
  canViewHistory,
  onEdit,
  onDelete,
  onHistory,
  onClose,
}: {
  canEdit: boolean;
  canDelete: boolean;
  canViewHistory: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onHistory: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* click-away backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute right-3 top-9 z-50 min-w-[160px] overflow-hidden rounded-[8px] border border-[var(--sh-border)] bg-[var(--sh-bg)] py-1 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="menu"
      >
        {canEdit && (
          <button type="button" className="sqc-msg__menu-item" onClick={onEdit} role="menuitem">
            Edit
          </button>
        )}
        {canViewHistory && (
          <button type="button" className="sqc-msg__menu-item" onClick={onHistory} role="menuitem">
            Edit history
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            className="sqc-msg__menu-item sqc-msg__menu-item--danger"
            onClick={onDelete}
            role="menuitem"
          >
            Delete
          </button>
        )}
      </div>
    </>
  );
}

// ---- Admin edit-history modal (view prior versions + restore) ----
type EditHistoryEntry = {
  id: number;
  previous_content: string;
  replaced_at: string;
  editor?: { id: string; display_name?: string | null } | null;
};

function EditHistoryModal({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState<{ content: string | null; edited_at?: string | null } | null>(null);
  const [history, setHistory] = useState<EditHistoryEntry[]>([]);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get(`/messages/${messageId}/history`)
      .then((r) => {
        if (!alive) return;
        const d = r.data?.data;
        setCurrent(d?.current ?? null);
        setHistory(d?.history ?? []);
      })
      .catch((e) => {
        if (alive) setError(e?.response?.data?.error || 'Failed to load edit history');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [messageId]);

  const restore = async (historyId: number) => {
    setRestoringId(historyId);
    setError('');
    try {
      await api.post(`/messages/${messageId}/restore`, { history_id: historyId });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['thread'] });
      onClose();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to restore version';
      setError(msg);
      setRestoringId(null);
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-[#E2E8F0] bg-[#F1F5F9] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[#0F172B]">Edit history</h3>
          <button onClick={onClose} className="text-2xl leading-none text-[#666666] hover:text-[#0F172B]" title="Close">
            ×
          </button>
        </div>

        {loading && <p className="text-sm text-[#666666]">Loading…</p>}
        {error && (
          <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        {!loading && !error && (
          <div className="flex flex-col gap-3 overflow-auto">
            <div className="rounded-md border border-[#CAD5E2] bg-white p-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#2962FF]">Current</div>
              <div className="whitespace-pre-wrap text-sm text-[#0F172B]">
                {current?.content || <span className="italic text-[#999999]">(empty)</span>}
              </div>
            </div>

            {history.length === 0 ? (
              <p className="text-sm text-[#666666]">
                No prior versions — this message hasn&apos;t been edited since history tracking started.
              </p>
            ) : (
              history.map((h) => (
                <div key={h.id} className="rounded-md border border-[#CAD5E2] bg-white p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[#666666]">
                      {h.editor?.display_name || 'Unknown'} · {fmt(h.replaced_at)}
                    </span>
                    <button
                      type="button"
                      onClick={() => restore(h.id)}
                      disabled={restoringId !== null}
                      className="rounded-md border border-[#CAD5E2] px-2.5 py-1 text-xs font-medium text-[#0F172B] transition hover:border-[#2962FF] hover:text-[#2962FF] disabled:opacity-50"
                    >
                      {restoringId === h.id ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                  <div className="whitespace-pre-wrap text-sm text-[#0F172B]">{h.previous_content}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Chat image: sized to fit its container (so it stays fully visible inside the
// narrow thread panel) and opens in an in-app full-screen viewer on click
// instead of a new browser tab.
function ImageAttachment({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 block max-w-[480px] cursor-zoom-in"
        title="Click to view"
      >
        <img
          src={src}
          alt={alt}
          className="max-h-[360px] w-auto max-w-full rounded-[8px] border border-[var(--sh-border)] object-contain"
          loading="lazy"
        />
      </button>
      {open && <ImageLightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

// ---- Attachment renderers (unchanged behavior, restyled with sh tokens) ----
function AttachmentBlock({ message }: { message: Message }) {
  if (!message.file_url) return null;
  const mime = message.file_mime || '';

  if (message.type === 'image' || mime.startsWith('image/')) {
    return <ImageAttachment src={message.file_url} alt={message.file_name || 'image'} />;
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

  // Documents and generic files render as a Slack-style card: a "TYPE ⌄"
  // collapse toggle, then [icon · bold name · type], with an inline preview
  // below for PDFs.
  return <FileCard message={message} />;
}

const FILE_KIND: Record<string, { label: string; iconClass: string }> = {
  pdf: { label: 'PDF', iconClass: '' },
  doc: { label: 'Word', iconClass: 'sqc-file-card__icon--doc' },
  docx: { label: 'Word', iconClass: 'sqc-file-card__icon--doc' },
  xls: { label: 'Excel', iconClass: 'sqc-file-card__icon--sheet' },
  xlsx: { label: 'Excel', iconClass: 'sqc-file-card__icon--sheet' },
  csv: { label: 'CSV', iconClass: 'sqc-file-card__icon--sheet' },
  ppt: { label: 'PowerPoint', iconClass: 'sqc-file-card__icon--doc' },
  pptx: { label: 'PowerPoint', iconClass: 'sqc-file-card__icon--doc' },
  zip: { label: 'Zip', iconClass: 'sqc-file-card__icon--zip' },
  txt: { label: 'Text', iconClass: 'sqc-file-card__icon--generic' },
};

function FileCard({ message }: { message: Message }) {
  const [collapsed, setCollapsed] = useState(false);
  const isPdf = (message.file_mime || '') === 'application/pdf';
  const ext = (message.file_name || '').split('.').pop()?.toLowerCase() || '';
  const kind = isPdf
    ? FILE_KIND.pdf
    : FILE_KIND[ext] || { label: ext ? ext.toUpperCase() : 'File', iconClass: 'sqc-file-card__icon--generic' };
  const size = fmtBytes(message.file_size);

  return (
    <div>
      <button
        type="button"
        className="sqc-file-toggle"
        data-collapsed={collapsed ? 'true' : 'false'}
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? 'Show file' : 'Hide file'}
      >
        {kind.label}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {!collapsed && (
        <div className="sqc-file-card">
          <a className="sqc-file-card__head" href={message.file_url!} target="_blank" rel="noopener noreferrer">
            <span className={`sqc-file-card__icon ${kind.iconClass}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v4a1 1 0 001 1h4M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2z" />
              </svg>
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="sqc-file-card__name">{message.file_name || 'attachment'}</span>
              <span className="sqc-file-card__type">{kind.label}{size ? ` · ${size}` : ''}</span>
            </span>
          </a>
          {isPdf && (
            <div className="sqc-file-card__preview">
              <object data={message.file_url!} type="application/pdf">
                <a href={message.file_url!} target="_blank" rel="noopener noreferrer" className="sqc-link block p-3 underline">
                  Open PDF
                </a>
              </object>
            </div>
          )}
        </div>
      )}
    </div>
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
      {lastReplyAt && <span className="sqc-thread-foot__last">{fmtReplyTime(lastReplyAt)}</span>}
      <span className="sqc-thread-foot__view">View thread</span>
      <span className="sqc-thread-foot__chev">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
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

  const isAdmin = useAuthStore((s) => s.user?.is_admin) ?? false;
  const editedAt = (message as Message & { edited_at?: string | null }).edited_at ?? null;

  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content || '');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  // Mirror the server rules (routes/messages.ts): a sender can edit/delete their
  // own message within 10 minutes; edits are text-only. Admins can view the edit
  // history and restore prior versions of any message.
  const EDIT_WINDOW_MS = 10 * 60 * 1000;
  const isOwn = !!meId && message.sender_id === meId;
  const withinWindow = Date.now() - new Date(message.created_at).getTime() < EDIT_WINDOW_MS;
  const canEdit = isOwn && message.type === 'text' && withinWindow;
  const canDelete = isOwn && withinWindow;
  const canViewHistory = isAdmin;
  const showMore = canEdit || canDelete || canViewHistory;

  const saveEdit = async () => {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setActionError('');
    try {
      await api.patch(`/messages/${message.id}`, { content });
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['thread', message.parent_message_id || message.id] });
      setEditing(false);
    } catch (err: unknown) {
      setActionError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to edit message',
      );
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setMenuOpen(false);
    if (busy || !window.confirm('Delete this message?')) return;
    setBusy(true);
    setActionError('');
    try {
      await api.delete(`/messages/${message.id}`);
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      queryClient.invalidateQueries({ queryKey: ['thread', message.parent_message_id || message.id] });
    } catch (err: unknown) {
      setActionError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to delete message',
      );
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => {
    setDraft(message.content || '');
    setActionError('');
    setEditing(true);
    setMenuOpen(false);
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
        onMore={() => setMenuOpen((v) => !v)}
        showMore={showMore}
      />
      {menuOpen && (
        <MessageActionMenu
          canEdit={canEdit}
          canDelete={canDelete}
          canViewHistory={canViewHistory}
          onEdit={startEdit}
          onDelete={doDelete}
          onHistory={() => {
            setHistoryOpen(true);
            setMenuOpen(false);
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}
      {historyOpen && <EditHistoryModal messageId={message.id} onClose={() => setHistoryOpen(false)} />}
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

        {editing ? (
          <div className="sqc-msg__edit">
            <textarea
              className="sqc-msg__edit-input"
              value={draft}
              autoFocus
              rows={Math.min(8, Math.max(1, draft.split('\n').length))}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false);
                  setActionError('');
                }
              }}
            />
            <div className="sqc-msg__edit-actions">
              <span className="sqc-msg__edit-hint">Enter to save · Esc to cancel</span>
              <button
                type="button"
                className="sqc-msg__edit-btn"
                onClick={() => {
                  setEditing(false);
                  setActionError('');
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sqc-msg__edit-btn sqc-msg__edit-btn--primary"
                onClick={saveEdit}
                disabled={busy || !draft.trim()}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          message.content && (
            <div className="sqc-msg__content">
              {renderContent(message.content)}
              {editedAt && (
                <span className="sqc-msg__edited" title={`Edited ${new Date(editedAt).toLocaleString()}`}>
                  {' '}(edited)
                </span>
              )}
            </div>
          )
        )}
        {actionError && !editing && <div className="sqc-msg__edit-error">{actionError}</div>}

        {message.meeting_event_id && <MeetingPollCard meetingEventId={message.meeting_event_id} />}
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
