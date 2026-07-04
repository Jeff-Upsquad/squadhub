import { useEffect, useMemo, useRef, useState } from 'react';
import { useMessageSearch, type MessageSearchResult } from '../../../hooks/useMessageSearch';
import { useWorkspaceStore, type ChatKind } from '../../../stores/workspaceStore';

// Split a message body around the first match of `q` so it can be highlighted.
function highlightSnippet(content: string, q: string): React.ReactNode {
  const needle = q.trim();
  if (!needle) return content;
  const idx = content.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return content;
  // Keep a little context before the match so long messages don't bury it.
  const start = Math.max(0, idx - 24);
  const prefix = (start > 0 ? '…' : '') + content.slice(start, idx);
  const match = content.slice(idx, idx + needle.length);
  const suffix = content.slice(idx + needle.length);
  return (
    <>
      {prefix}
      <mark className="sqc-search__mark">{match}</mark>
      {suffix}
    </>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// In-conversation message search. Rendered inside the chat header actions; opens
// a dropdown that searches the CURRENT channel/DM and jumps to a picked message.
export default function ChatSearch({ channelId, kind }: { channelId: string; kind: ChatKind }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const requestMessageJump = useWorkspaceStore((s) => s.requestMessageJump);

  // Reset when switching conversations so a stale query/panel doesn't linger.
  useEffect(() => {
    setOpen(false);
    setQuery('');
  }, [channelId, kind]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Close on click-outside / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const { results, isSearching, isDebouncing } = useMessageSearch({
    channelId: kind === 'channel' ? channelId : undefined,
    dmId: kind === 'dm' ? channelId : undefined,
    query,
    enabled: open,
    limit: 30,
  });

  const trimmed = query.trim();
  const showEmpty = open && trimmed.length > 0 && !isSearching && !isDebouncing && results.length === 0;

  const pick = (r: MessageSearchResult) => {
    requestMessageJump({
      conversationId: channelId,
      kind,
      messageId: r.id,
      parentId: r.parent_message_id,
    });
    setOpen(false);
  };

  const label = useMemo(() => (kind === 'dm' ? 'this conversation' : 'this channel'), [kind]);

  return (
    <div className="sqc-search" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`sqc-pill ${open ? 'sqc-pill--active' : ''}`}
        title={`Search ${label}`}
        aria-label={`Search ${label}`}
        aria-expanded={open}
      >
        <svg className="h-4 w-4 text-[var(--sh-text-2)]" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </button>

      {open && (
        <div className="sqc-search__panel" role="dialog" aria-label={`Search ${label}`}>
          <div className="sqc-search__inputrow">
            <svg className="h-[15px] w-[15px] shrink-0 text-[var(--sh-text-3)]" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label}…`}
              className="sqc-search__input"
              spellCheck={false}
            />
            {query && (
              <button type="button" className="sqc-search__clear" onClick={() => setQuery('')} aria-label="Clear search">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <div className="sqc-search__results">
            {trimmed.length === 0 && (
              <div className="sqc-search__hint">Search messages in {label}.</div>
            )}
            {showEmpty && <div className="sqc-search__hint">No messages match “{trimmed}”.</div>}
            {results.map((r) => (
              <button key={r.id} type="button" className="sqc-search__row" onClick={() => pick(r)}>
                <span
                  className="sqc-search__avatar"
                  style={{ background: r.sender?.avatar_url ? undefined : avatarGradient(r.sender?.id || r.id) }}
                >
                  {r.sender?.avatar_url ? (
                    <img src={r.sender.avatar_url} alt="" />
                  ) : (
                    (r.sender?.display_name?.[0] || '?').toUpperCase()
                  )}
                </span>
                <span className="sqc-search__body">
                  <span className="sqc-search__meta">
                    <span className="sqc-search__name">{r.sender?.display_name || 'Unknown'}</span>
                    <span className="sqc-search__when">{formatWhen(r.created_at)}</span>
                    {r.parent_message_id && <span className="sqc-search__badge">thread</span>}
                  </span>
                  <span className="sqc-search__text">{highlightSnippet(r.content, trimmed)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function avatarGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 65% 45%))`;
}
