import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { formatDuration } from '../../lib/timeDuration';

/**
 * Small inline confirmation shown right at the duration edit when the task
 * repeats. Confirm → new duration applies to future recurrences too.
 * Cancel → only the edited item changes.
 */
export default function RecurrenceDurationConfirm({
  anchorRect,
  minutes,
  onConfirm,
  onCancel,
}: {
  anchorRect: DOMRect | null;
  minutes: number | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const style = useMemo<React.CSSProperties>(() => {
    if (!anchorRect) return { top: 0, left: 0 };
    const width = 264;
    const vw = window.innerWidth;
    let left = anchorRect.left;
    if (left + width > vw - 8) left = vw - width - 8;
    if (left < 8) left = 8;
    return { top: anchorRect.bottom + 6, left, width };
  }, [anchorRect]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchorRect) return;
    const margin = 8;
    const vh = window.innerHeight;
    let top = anchorRect.bottom + 6;
    if (top + el.offsetHeight > vh - margin) {
      const above = anchorRect.top - el.offsetHeight - 6;
      top = above >= margin ? above : Math.max(margin, vh - el.offsetHeight - margin);
    }
    el.style.top = `${top}px`;
  });

  if (!anchorRect || typeof document === 'undefined') return null;

  return createPortal(
    <div ref={ref} className="tp-pop" style={style} role="dialog" aria-label="Update future recurrences?">
      <div className="tp-head">
        <span className="tp-head-title">Repeating task</span>
      </div>
      <p style={{ fontSize: 12.5, lineHeight: 1.45, opacity: 0.85, margin: '2px 0 8px' }}>
        Update future recurrences to {minutes ? formatDuration(minutes) : 'no estimate'} too?
      </p>
      <div className="tp-foot" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="tp-link" onClick={onCancel}>
          Only this one
        </button>
        <button type="button" className="tp-btn" onClick={onConfirm} autoFocus>
          Update future
        </button>
      </div>
    </div>,
    document.body,
  );
}
