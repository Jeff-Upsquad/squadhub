import { useRef, useState } from 'react';
import MentionPicker from '../../../components/MentionPicker';

/**
 * Slack-style reply composer: formatting toolbar on top (markdown insertions),
 * the reply input, and a bottom row with emoji/@ shortcuts and a round send
 * button. Shared by the inbox thread + task detail panes.
 */

const EMOJI = ['👍', '🎉', '❤️', '🙌', '👀', '✅', '😄', '🔥'];

type Props = {
  value: string;
  mentions: string[];
  onChange: (value: string, mentions: string[]) => void;
  onSubmit: () => void;
  pending?: boolean;
  placeholder?: string;
};

export default function ThreadComposer({
  value,
  mentions,
  onChange,
  onSubmit,
  pending,
  placeholder = 'Reply…',
}: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const textarea = () =>
    boxRef.current?.querySelector('textarea') as HTMLTextAreaElement | null;

  const applyToSelection = (transform: (sel: string) => string) => {
    const el = textarea();
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const sel = value.slice(start, end);
    const next = value.slice(0, start) + transform(sel) + value.slice(end);
    onChange(next, mentions);
    const caret = start + transform(sel).length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const wrap = (mark: string) => (sel: string) =>
    `${mark}${sel || 'text'}${mark}`;

  const prefixLines = (prefix: string) => (sel: string) =>
    (sel || 'text')
      .split('\n')
      .map((l) => `${prefix}${l}`)
      .join('\n');

  const insertAtCaret = (text: string) => {
    const el = textarea();
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + text + value.slice(end), mentions);
    const caret = start + text.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const insertEmoji = (emo: string) => {
    insertAtCaret(emo);
    setEmojiOpen(false);
  };

  const canSend = Boolean(value.trim()) && !pending;

  const tools = [
    {
      label: 'Bold',
      title: 'Bold',
      node: <text x="12" y="16.5" textAnchor="middle" fontSize="13" fontWeight={700} fill="currentColor" stroke="none">B</text>,
      act: () => applyToSelection(wrap('**')),
    },
    {
      label: 'Italic',
      title: 'Italic',
      node: <text x="12" y="16.5" textAnchor="middle" fontSize="13" fontStyle="italic" fill="currentColor" stroke="none">I</text>,
      act: () => applyToSelection(wrap('*')),
    },
    {
      label: 'Strikethrough',
      title: 'Strikethrough',
      node: <text x="12" y="16.5" textAnchor="middle" fontSize="13" textDecoration="line-through" fill="currentColor" stroke="none">S</text>,
      act: () => applyToSelection(wrap('~')),
    },
    {
      label: 'Link',
      title: 'Link',
      node: (
        <path d="M10 14a5 5 0 0 0 7.07 0l3.18-3.18a5 5 0 0 0-7.07-7.07L11.5 5.4M14 10a5 5 0 0 0-7.07 0l-3.18 3.18a5 5 0 0 0 7.07 7.07l1.68-1.65" />
      ),
      act: () => applyToSelection((sel) => `[${sel || 'text'}](url)`),
    },
    {
      label: 'Bulleted list',
      title: 'Bulleted list',
      node: (
        <>
          <path d="M9 6h12M9 12h12M9 18h12" />
          <path d="M4 6h.01M4 12h.01M4 18h.01" />
        </>
      ),
      act: () => applyToSelection(prefixLines('- ')),
    },
    {
      label: 'Numbered list',
      title: 'Numbered list',
      node: (
        <>
          <path d="M10 6h11M10 12h11M10 18h11" />
          <path d="M4 6h1v4M4 10h2" />
          <path d="M4 16c2 0 2.5 1 1 2l-1.5 2h3" />
        </>
      ),
      act: () => applyToSelection(prefixLines('1. ')),
    },
  ];

  return (
    <div className="thc-box" ref={boxRef}>
      <div className="thc-toolbar">
        {tools.map((t) => (
          <button key={t.label} type="button" title={t.title} aria-label={t.label} className="thc-tool" onClick={t.act}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {t.node}
            </svg>
          </button>
        ))}
      </div>
      <MentionPicker
        value={value}
        mentions={mentions}
        onChange={onChange}
        onSubmit={onSubmit}
        multiline
        rows={2}
        placeholder={placeholder}
        className="thc-input"
      />
      <div className="thc-bottom">
        <span className="ib-reply-hint">⌘↵ to send</span>
        <div className="thc-bottom-tools">
          <button
            type="button"
            className="thc-tool"
            title="Emoji"
            aria-label="Emoji"
            onClick={() => setEmojiOpen((v) => !v)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <path d="M9 9h.01M15 9h.01" />
            </svg>
          </button>
          <button
            type="button"
            className="thc-tool"
            title="Mention someone"
            aria-label="Mention someone"
            onClick={() => insertAtCaret('@')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="4" />
              <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
            </svg>
          </button>
          <button
            type="button"
            className="thc-send"
            title="Send"
            aria-label="Send"
            disabled={!canSend}
            data-ready={canSend}
            onClick={onSubmit}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
            </svg>
          </button>
        </div>
      </div>
      {emojiOpen && (
        <div className="thc-emoji" role="menu">
          {EMOJI.map((emo) => (
            <button key={emo} type="button" role="menuitem" onClick={() => insertEmoji(emo)}>
              {emo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
