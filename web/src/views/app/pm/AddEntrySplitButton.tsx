import { useEffect, useRef, useState } from 'react';

type Props = {
  label: string;
  sectionLabel: string;
  onAdd: () => void;
  onAddSection: () => void;
  disabled?: boolean;
  compact?: boolean;
};

/**
 * The primary action starts a new item immediately. The chevron keeps the less
 * common grouping action available without adding an extra button to the row.
 */
export default function AddEntrySplitButton({
  label,
  sectionLabel,
  onAdd,
  onAddSection,
  disabled = false,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="td-entry-split" data-compact={compact ? 'true' : undefined}>
      <button
        type="button"
        className="td-entry-split-main"
        onClick={onAdd}
        disabled={disabled}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        {label}
      </button>
      <button
        type="button"
        className="td-entry-split-toggle"
        aria-label={`${label} options`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
      >
        <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m5 7 5 5 5-5" />
        </svg>
      </button>
      {open && (
        <div className="td-entry-split-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onAddSection();
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M5 7h14M5 12h10M5 17h14" />
            </svg>
            {sectionLabel}
          </button>
        </div>
      )}
    </div>
  );
}
