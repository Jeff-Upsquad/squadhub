import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';

export type MentionUser = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  user_type?: string;
};

type Props = {
  value: string;
  onChange: (value: string, mentions: string[]) => void;
  mentions: string[];
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  className?: string;
  onSubmit?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

// We scan the text for `@<token>` patterns and keep only mention IDs whose
// resolved display_name still appears in the text. This lets backspacing
// `@Alice` drop the mention — no stale payloads.
function reconcileMentions(text: string, mentions: string[], resolve: Map<string, string>): string[] {
  return mentions.filter((id) => {
    const name = resolve.get(id);
    if (!name) return true;
    return text.includes(`@${name}`);
  });
}

export default function MentionPicker({
  value,
  onChange,
  mentions,
  placeholder,
  multiline,
  rows = 3,
  className,
  onSubmit,
  disabled,
  autoFocus,
}: Props) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [results, setResults] = useState<MentionUser[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const resolveRef = useRef<Map<string, string>>(new Map());

  const pickerOpen = query !== null;

  useEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (query === null) return;
    let cancel = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.get('/users/search', { params: { q: query, limit: 8 } });
        if (cancel) return;
        const users: MentionUser[] = res.data.data || [];
        setResults(users);
        setHighlight(0);
        users.forEach((u) => resolveRef.current.set(u.id, u.display_name));
      } catch {
        if (!cancel) setResults([]);
      } finally {
        if (!cancel) setLoading(false);
      }
    }, 150);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [query]);

  const detectMentionQuery = useCallback((text: string, caret: number): string | null => {
    const slice = text.slice(0, caret);
    const at = slice.lastIndexOf('@');
    if (at === -1) return null;
    // Must be at start or preceded by whitespace
    if (at > 0 && !/\s/.test(slice[at - 1])) return null;
    const token = slice.slice(at + 1);
    if (/\s/.test(token)) return null;
    if (token.length > 40) return null;
    return token;
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const el = e.target;
    const text = el.value;
    const caret = el.selectionStart ?? text.length;
    const q = detectMentionQuery(text, caret);
    setQuery(q);
    const nextMentions = reconcileMentions(text, mentions, resolveRef.current);
    onChange(text, nextMentions);
  };

  const selectUser = (u: MentionUser) => {
    const el = inputRef.current;
    if (!el) return;
    const text = el.value;
    const caret = el.selectionStart ?? text.length;
    const slice = text.slice(0, caret);
    const at = slice.lastIndexOf('@');
    if (at === -1) return;
    const before = text.slice(0, at);
    const after = text.slice(caret);
    const insertion = `@${u.display_name} `;
    const nextText = before + insertion + after;
    resolveRef.current.set(u.id, u.display_name);
    const nextMentions = Array.from(new Set([...mentions, u.id]));
    onChange(nextText, nextMentions);
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = before.length + insertion.length;
      el.setSelectionRange(pos, pos);
      el.focus();
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (pickerOpen && results.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => (h + 1) % results.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => (h - 1 + results.length) % results.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectUser(results[highlight]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setQuery(null);
        return;
      }
    }

    if (!multiline && e.key === 'Enter' && !e.shiftKey && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
    if (multiline && e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  const baseClass =
    className ||
    'w-full bg-transparent font-[Lato] text-[15px] font-normal leading-[22px] text-foreground placeholder:text-foreground-dim focus:outline-none';

  return (
    <div className="relative w-full">
      {multiline ? (
        <textarea
          ref={(r) => { inputRef.current = r; }}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className={baseClass}
        />
      ) : (
        <input
          ref={(r) => { inputRef.current = r; }}
          type="text"
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={baseClass}
        />
      )}

      {pickerOpen && (results.length > 0 || loading) && (
        <div
          className="absolute bottom-full left-0 z-50 mb-2 w-[min(260px,calc(100vw-32px))] overflow-hidden rounded-[6px] border border-divider bg-surface shadow-lg"
          role="listbox"
        >
          {loading && results.length === 0 ? (
            <div className="px-3 py-2 text-[13px] text-foreground-dim">Searching…</div>
          ) : (
            results.map((u, i) => (
              <button
                type="button"
                key={u.id}
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectUser(u);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition ${
                  i === highlight ? 'bg-sidebar-hover' : ''
                }`}
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground/10 text-[10px] font-semibold text-foreground">
                  {u.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
                  ) : (
                    u.display_name.slice(0, 2).toUpperCase()
                  )}
                </div>
                <span className="flex-1 truncate text-foreground">{u.display_name}</span>
                {u.user_type && (
                  <span className="text-[10px] text-foreground-dim">{u.user_type}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
