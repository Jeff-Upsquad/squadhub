import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseDuration, formatDuration, MINUTES_PER_DAY } from '../../lib/timeDuration';

const PRESETS = [15, 30, 60, 120, 240, MINUTES_PER_DAY];

/**
 * The one estimate editor. A shorthand field ("1d 4h") with a live readback of
 * what it parsed to, plus one-tap presets — so setting an estimate is usually a
 * single click, and typing never leaves you guessing how it was read.
 *
 * Commits on Enter, on a preset click, or on click-away (matching how the old
 * inline field behaved). Escape discards.
 */
export default function EstimatePopover({
  anchorRect,
  value,
  onApply,
  onClose,
}: {
  anchorRect: DOMRect | null;
  value: number | null;
  onApply: (minutes: number | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState(() => formatDuration(value));
  // Keep the latest draft readable from the click-away listener without
  // re-binding it on every keystroke.
  const inputRef2 = useRef(input);
  inputRef2.current = input;

  const parsed = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed) return { minutes: null as number | null, invalid: false };
    const minutes = parseDuration(trimmed);
    if (minutes == null || minutes < 0) return { minutes: null, invalid: true };
    return { minutes, invalid: false };
  }, [input]);

  const commit = (minutes: number | null) => {
    onApply(minutes && minutes > 0 ? minutes : null);
    onClose();
  };

  const commitTyped = () => {
    if (parsed.invalid) { onClose(); return; }
    commit(parsed.minutes);
  };

  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        const minutes = parseDuration(inputRef2.current.trim());
        if (!inputRef2.current.trim()) onApply(null);
        else if (minutes != null && minutes > 0) onApply(minutes);
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const id = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // onApply/onClose are stable enough for this panel's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useMemo<React.CSSProperties>(() => {
    if (!anchorRect) return { top: 0, left: 0 };
    const width = 268;
    const vw = window.innerWidth;
    let left = anchorRect.left;
    if (left + width > vw - 8) left = vw - width - 8;
    if (left < 8) left = 8;
    return { top: anchorRect.bottom + 6, left, width };
  }, [anchorRect]);

  // Place against the measured height so the presets and Save never fall off
  // the bottom of the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchorRect) return;
    const margin = 8;
    const vh = window.innerHeight;
    const height = Math.min(el.offsetHeight, vh - margin * 2);
    let top = anchorRect.bottom + 6;
    if (top + height > vh - margin) {
      const above = anchorRect.top - height - 6;
      top = above >= margin ? above : Math.max(margin, vh - height - margin);
    }
    el.style.top = `${top}px`;
  });

  if (!anchorRect || typeof document === 'undefined') return null;

  return createPortal(
    <div ref={ref} className="tp-pop" style={style} role="dialog" aria-label="Estimate">
      <div className="tp-head">
        <span className="tp-head-title">Estimate</span>
        <span className="tp-head-note">1d = 8h · 1w = 5d</span>
      </div>

      <div className="tp-field">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitTyped(); }
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
          placeholder="2h 30m"
          className="tp-input"
          aria-invalid={parsed.invalid}
        />
        <span className={`tp-readback${parsed.invalid ? ' is-bad' : ''}`}>
          {parsed.invalid ? "can't read that" : formatDuration(parsed.minutes) || '—'}
        </span>
      </div>

      <div className="tp-chips">
        {PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            className={`tp-chip${value === m ? ' is-on' : ''}`}
            onClick={() => commit(m)}
          >
            {formatDuration(m)}
          </button>
        ))}
      </div>

      <div className="tp-foot">
        {value ? (
          <button type="button" className="tp-link" onClick={() => commit(null)}>
            Clear
          </button>
        ) : (
          <span className="tp-foot-hint">Enter to save</span>
        )}
        <button
          type="button"
          className="tp-btn"
          disabled={parsed.invalid}
          onClick={commitTyped}
        >
          Save
        </button>
      </div>
    </div>,
    document.body,
  );
}
