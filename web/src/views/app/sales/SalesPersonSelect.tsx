import { useEffect, useRef, useState } from 'react';

export interface SalesPersonSelectOption {
  id: string;
  label: string;
  hint?: string;
}

interface SalesPersonSelectProps {
  value: string;
  onChange: (id: string) => void;
  options: SalesPersonSelectOption[];
  placeholder?: string;
  disabled?: boolean;
}

export default function SalesPersonSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled = false,
}: SalesPersonSelectProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onClickOutside(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (wrapRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [open]);

  const selected = options.find((o) => o.id === value);
  const showPlaceholder = !selected && !value;
  const displayText = selected
    ? selected.hint
      ? `${selected.label} (${selected.hint})`
      : selected.label
    : placeholder;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--sh-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--sh-ink)] disabled:opacity-50"
      >
        <span className={showPlaceholder ? 'text-[var(--sh-ink-3)]' : ''}>{displayText}</span>
        <svg
          className={`h-4 w-4 text-[var(--sh-ink-3)] transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] py-1 shadow-lg"
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-[var(--sh-ink-3)]">No options</div>
          ) : (
            options.map((o) => {
              const isSelected = o.id === value;
              return (
                <button
                  key={o.id || '__none__'}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-[var(--sh-ink)] hover:bg-[var(--sh-hair-3)]"
                >
                  <span>
                    {o.label}
                    {o.hint && <span className="ml-1 text-[var(--sh-ink-3)]">({o.hint})</span>}
                  </span>
                  {isSelected && (
                    <svg
                      className="h-4 w-4 text-[var(--sh-ink)]"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
