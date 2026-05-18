import { useEffect, useMemo, useRef, useState } from 'react';

// Curated emoji set covering the most-used Slack reactions across categories.
// Zero deps; keeps bundle small and fully offline. If we later need full
// search, swap in emoji-mart.
const EMOJI_CATEGORIES: { name: string; emojis: { e: string; n: string }[] }[] = [
  {
    name: 'Smileys',
    emojis: [
      { e: '😀', n: 'grinning' }, { e: '😃', n: 'smiley' }, { e: '😄', n: 'smile' }, { e: '😁', n: 'grin' },
      { e: '😆', n: 'laughing' }, { e: '😂', n: 'joy' }, { e: '🤣', n: 'rofl' }, { e: '😊', n: 'blush' },
      { e: '😇', n: 'innocent' }, { e: '🙂', n: 'slight smile' }, { e: '🙃', n: 'upside down' }, { e: '😉', n: 'wink' },
      { e: '😍', n: 'heart eyes' }, { e: '🥰', n: 'smiling hearts' }, { e: '😘', n: 'kiss' }, { e: '😎', n: 'sunglasses' },
      { e: '🤩', n: 'star struck' }, { e: '🥳', n: 'partying' }, { e: '🤔', n: 'thinking' }, { e: '🤨', n: 'raised brow' },
      { e: '😐', n: 'neutral' }, { e: '😑', n: 'expressionless' }, { e: '😶', n: 'no mouth' }, { e: '🙄', n: 'eye roll' },
      { e: '😏', n: 'smirk' }, { e: '😣', n: 'persevere' }, { e: '😥', n: 'sad relieved' }, { e: '😮', n: 'open mouth' },
      { e: '😯', n: 'hushed' }, { e: '😪', n: 'sleepy' }, { e: '😫', n: 'tired' }, { e: '🥱', n: 'yawn' },
      { e: '😴', n: 'sleeping' }, { e: '😌', n: 'relieved' }, { e: '😛', n: 'tongue' }, { e: '😜', n: 'wink tongue' },
      { e: '🤤', n: 'drool' }, { e: '😒', n: 'unamused' }, { e: '😓', n: 'sweat' }, { e: '😔', n: 'pensive' },
      { e: '🤐', n: 'zipper mouth' }, { e: '🥴', n: 'woozy' }, { e: '😕', n: 'confused' }, { e: '🙁', n: 'frown' },
      { e: '😢', n: 'cry' }, { e: '😭', n: 'sob' }, { e: '😤', n: 'triumph' }, { e: '😠', n: 'angry' },
      { e: '🤯', n: 'mind blown' }, { e: '🥺', n: 'pleading' },
    ],
  },
  {
    name: 'Gestures',
    emojis: [
      { e: '👍', n: '+1 thumbsup yes' }, { e: '👎', n: '-1 thumbsdown no' }, { e: '👌', n: 'ok' }, { e: '🤝', n: 'handshake' },
      { e: '🙏', n: 'pray thanks' }, { e: '👏', n: 'clap' }, { e: '🙌', n: 'raised hands' }, { e: '💪', n: 'flex' },
      { e: '✊', n: 'fist' }, { e: '👊', n: 'punch' }, { e: '🤞', n: 'fingers crossed' }, { e: '✌️', n: 'peace' },
      { e: '🤘', n: 'rock' }, { e: '🤟', n: 'love you' }, { e: '🤙', n: 'call me' }, { e: '👋', n: 'wave' },
      { e: '🫡', n: 'salute' }, { e: '🫶', n: 'heart hands' }, { e: '☝️', n: 'point up' }, { e: '👇', n: 'point down' },
      { e: '👈', n: 'point left' }, { e: '👉', n: 'point right' }, { e: '🖖', n: 'spock' }, { e: '🖐️', n: 'hand' },
    ],
  },
  {
    name: 'Hearts',
    emojis: [
      { e: '❤️', n: 'heart love' }, { e: '🧡', n: 'orange heart' }, { e: '💛', n: 'yellow heart' }, { e: '💚', n: 'green heart' },
      { e: '💙', n: 'blue heart' }, { e: '💜', n: 'purple heart' }, { e: '🖤', n: 'black heart' }, { e: '🤍', n: 'white heart' },
      { e: '🤎', n: 'brown heart' }, { e: '❤️‍🔥', n: 'fire heart' }, { e: '💖', n: 'sparkling heart' }, { e: '💗', n: 'growing heart' },
      { e: '💘', n: 'heart arrow' }, { e: '💝', n: 'heart gift' }, { e: '💞', n: 'revolving hearts' }, { e: '💕', n: 'two hearts' },
      { e: '💓', n: 'beating' }, { e: '💔', n: 'broken' },
    ],
  },
  {
    name: 'Objects',
    emojis: [
      { e: '🔥', n: 'fire lit' }, { e: '⭐', n: 'star' }, { e: '🌟', n: 'glowing star' }, { e: '✨', n: 'sparkles' },
      { e: '💯', n: '100' }, { e: '🎉', n: 'party tada celebrate' }, { e: '🎊', n: 'confetti' }, { e: '🎁', n: 'gift' },
      { e: '🚀', n: 'rocket launch ship' }, { e: '⚡', n: 'zap lightning' }, { e: '💡', n: 'idea bulb' }, { e: '✅', n: 'check done' },
      { e: '❌', n: 'x cross' }, { e: '⚠️', n: 'warning' }, { e: '❓', n: 'question' }, { e: '❗', n: 'exclamation' },
      { e: '👀', n: 'eyes look' }, { e: '🧠', n: 'brain' }, { e: '🎯', n: 'target dart' }, { e: '🏆', n: 'trophy' },
      { e: '☕', n: 'coffee' }, { e: '🍕', n: 'pizza' }, { e: '🍻', n: 'beers cheers' }, { e: '🌈', n: 'rainbow' },
    ],
  },
];

interface Props {
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** Anchor-aligned: left/right/top offsets are caller's responsibility. */
  className?: string;
}

export default function EmojiPicker({ onPick, onClose, className }: Props) {
  const [q, setQ] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!q.trim()) return EMOJI_CATEGORIES;
    const needle = q.toLowerCase();
    return EMOJI_CATEGORIES.map((c) => ({
      ...c,
      emojis: c.emojis.filter((em) => em.n.includes(needle)),
    })).filter((c) => c.emojis.length > 0);
  }, [q]);

  return (
    <div
      ref={containerRef}
      className={`z-50 w-[320px] rounded-[8px] border border-divider bg-surface shadow-xl ${className || ''}`}
    >
      <div className="border-b border-divider p-2">
        <input
          ref={inputRef}
          type="text"
          placeholder="Search emoji…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-[4px] border border-divider bg-background px-2 py-[6px] text-[13px] text-foreground outline-none focus:border-[#1264A3]"
        />
      </div>
      <div className="max-h-[280px] overflow-y-auto p-2">
        {filtered.length === 0 && (
          <p className="py-6 text-center text-[12px] text-foreground-muted">No emoji match &ldquo;{q}&rdquo;.</p>
        )}
        {filtered.map((cat) => (
          <div key={cat.name} className="mb-2 last:mb-0">
            <p className="px-1 pb-1 text-[10px] uppercase tracking-wide text-foreground-muted">{cat.name}</p>
            <div className="grid grid-cols-8 gap-[2px]">
              {cat.emojis.map((em) => (
                <button
                  key={em.e}
                  type="button"
                  onClick={() => {
                    onPick(em.e);
                    onClose();
                  }}
                  title={em.n}
                  className="rounded-[4px] p-1 text-[20px] leading-none transition hover:bg-surface-alt"
                >
                  {em.e}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
