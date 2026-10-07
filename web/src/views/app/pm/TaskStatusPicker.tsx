import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getTaskStatusDef,
  type TaskStatusDef,
  type TaskStatusGroup,
  type TaskStatusKey,
} from '@squadhub/shared';
import { useTaskWorkflowCatalog, findTaskStatusDef } from '../../../hooks/useTaskWorkflowCatalog';

const GROUP_ORDER: TaskStatusGroup[] = [
  'priority_urgency',
  'in_motion',
  'up_next',
  'scheduled_queued',
  'routines',
  'blocked_paused',
  'not_started',
  'done',
];

// Pre-migration compat: legacy StatusCategory strings ('todo'/'active'/'done'/'closed')
// map to their catalog equivalents so the button shows a friendly label.
const LEGACY_TO_KEY: Record<string, TaskStatusKey> = {
  todo: 'open',
  active: 'in_progress',
  done: 'closed',
  closed: 'closed',
};

type Grouped = { group: TaskStatusGroup; label: string; emoji: string; items: TaskStatusDef[] };

function groupCatalog(items: TaskStatusDef[]): Grouped[] {
  const byGroup = new Map<TaskStatusGroup, Grouped>();
  for (const d of items) {
    let g = byGroup.get(d.group);
    if (!g) {
      g = { group: d.group, label: d.groupLabel, emoji: d.groupEmoji, items: [] };
      byGroup.set(d.group, g);
    }
    g.items.push(d);
  }
  // Known sections first (stable order), then any admin-added sections.
  const ordered = GROUP_ORDER.map((g) => byGroup.get(g)).filter((x): x is Grouped => !!x);
  for (const [key, g] of byGroup) {
    if (!GROUP_ORDER.includes(key)) ordered.push(g);
  }
  return ordered;
}

export default function TaskStatusPicker({
  value,
  originalStatus,
  onChange,
  buttonClassName,
}: {
  value: string | null | undefined;
  originalStatus?: string | null;
  onChange: (key: TaskStatusKey) => void;
  buttonClassName?: string;
}) {
  const { defs: catalog } = useTaskWorkflowCatalog();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Keep the popover anchored to the button when the viewport scrolls/resizes.
  useEffect(() => {
    if (!open) return;
    const reposition = (e?: Event) => {
      if (e?.target instanceof Node && popoverRef.current?.contains(e.target)) return;
      if (buttonRef.current) setAnchor(buttonRef.current.getBoundingClientRect());
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  const toggleOpen = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    if (buttonRef.current) setAnchor(buttonRef.current.getBoundingClientRect());
    setQuery('');
    setHighlightedIndex(0);
    setOpen(true);
  };

  const current = findTaskStatusDef(catalog, value)
    || getTaskStatusDef(value)
    || (value ? getTaskStatusDef(LEGACY_TO_KEY[value]) : null);

  const isWaitingOrUnblocked = value === 'waiting_on_dependency' || value === 'unblocked';
  const origDef = originalStatus
    ? (findTaskStatusDef(catalog, originalStatus) || getTaskStatusDef(originalStatus))
    : null;
  const origLabel = origDef?.label || originalStatus || null;
  const origColor = origDef?.color || '#6b7280';

  const { grouped: filtered, flatList } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = !q
      ? catalog
      : catalog.filter(
          (d) => d.label.toLowerCase().includes(q) || d.description.toLowerCase().includes(q)
        );
    const grouped = groupCatalog(matched);
    const flat: TaskStatusDef[] = [];
    for (const g of grouped) flat.push(...g.items);
    return { grouped, flatList: flat };
  }, [query, catalog]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  const pick = (key: TaskStatusKey) => {
    onChange(key);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1 < flatList.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : flatList.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatList[highlightedIndex]) {
        pick(flatList[highlightedIndex].key);
      }
    }
  };

  // Fixed popover position: default to anchor.bottom, but flip above the button
  // if there isn't enough room below. Matches TaskTypeDropdown sizing.
  const popoverStyle = useMemo<React.CSSProperties>(() => {
    if (!anchor || typeof window === 'undefined') return { visibility: 'hidden' };
    const width = 330;
    const maxHeight = Math.min(420, window.innerHeight - 24);
    const spaceBelow = window.innerHeight - anchor.bottom;
    const spaceAbove = anchor.top;
    const openUpward = spaceBelow < 320 && spaceAbove > spaceBelow;
    const top = openUpward
      ? Math.max(8, anchor.top - 8 - maxHeight)
      : anchor.bottom + 4;
    let left = anchor.left;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (left < 8) left = 8;
    return {
      position: 'fixed',
      top,
      left,
      width,
      maxHeight,
      borderColor: 'var(--sh-hair)',
      background: 'var(--surface)',
      zIndex: 100,
    };
  }, [anchor]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        className={
          buttonClassName ||
          'inline-flex items-center gap-2 px-2 py-0.5 rounded-full hover:bg-[color:var(--sh-hair-3)] transition td-focus'
        }
      >
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ background: current?.color || 'var(--sh-ink-4)' }}
        />
        <span className="text-[13px]">{current?.label || value || 'No status'}</span>
        {isWaitingOrUnblocked && origLabel && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] font-medium border shrink-0"
            style={{
              borderColor: 'var(--sh-hair)',
              background: 'var(--surface-alt)',
              color: 'var(--sh-ink-2)',
            }}
            title={`Original status: ${origLabel}`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ background: origColor }}
            />
            <span className="truncate max-w-[120px]">{origLabel}</span>
          </span>
        )}
        <svg
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="text-[color:var(--sh-ink-4)]"
        >
          <path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
        </svg>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onClick={() => setOpen(false)}
          />

          <div
            ref={popoverRef}
            className="flex flex-col rounded-xl border overflow-hidden overscroll-contain animate-in fade-in-0 zoom-in-95 duration-100"
            style={{
              ...popoverStyle,
              zIndex: 9999,
              boxShadow: '0 12px 36px -4px rgba(0,0,0,0.22), 0 4px 12px -2px rgba(0,0,0,0.12)',
              overscrollBehavior: 'contain',
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
          >
            {/* Search Header */}
            <div className="p-2.5 border-b border-[var(--sh-hair)] bg-[var(--surface)] shrink-0">
              <div className="relative flex items-center">
                <svg
                  className="absolute left-2.5 w-3.5 h-3.5 pointer-events-none text-[var(--sh-ink-4)]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search statuses (e.g. Focus, In Progress)..."
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-[var(--surface-alt)] border border-[var(--sh-hair)] rounded-lg text-[var(--sh-ink)] placeholder-[var(--sh-ink-4)] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]/20"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      searchRef.current?.focus();
                    }}
                    className="absolute right-2 text-xs text-[var(--sh-ink-4)] hover:text-[var(--sh-ink-2)]"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div
              className="overflow-y-auto overscroll-contain flex-1 py-1 divide-y divide-[var(--sh-hair)]/40 scrollbar-thin"
              style={{ overscrollBehavior: 'contain' }}
            >
              {filtered.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[var(--surface-alt)] text-[var(--sh-ink-4)] mb-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  </div>
                  <p className="text-xs font-medium text-[var(--sh-ink-2)]">No statuses match &ldquo;{query}&rdquo;</p>
                  <p className="text-[11px] text-[var(--sh-ink-4)] mt-0.5">Try searching with a different term</p>
                </div>
              ) : (
                filtered.map((g) => (
                  <div key={g.group} className="py-1">
                    {/* Group Header */}
                    <div className="px-3 py-1 flex items-center justify-between text-[10px] font-semibold tracking-wider uppercase text-[var(--sh-ink-4)] bg-[var(--surface)] select-none">
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden>{g.emoji}</span>
                        <span>{g.label}</span>
                      </span>
                      <span className="text-[9px] opacity-70 font-normal">{g.items.length}</span>
                    </div>

                    {/* Group Items */}
                    <div className="space-y-0.5 px-1">
                      {g.items.map((d) => {
                        const selected = d.key === value;
                        const flatIdx = flatList.indexOf(d);
                        const isHighlighted = flatIdx === highlightedIndex;
                        return (
                          <button
                            key={d.key}
                            type="button"
                            onClick={() => pick(d.key)}
                            onMouseEnter={() => setHighlightedIndex(flatIdx)}
                            className={`group w-full flex items-start gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                              selected
                                ? 'bg-[#2962FF]/10 text-[var(--sh-ink)]'
                                : isHighlighted
                                ? 'bg-[var(--sh-hair-3)] text-[var(--sh-ink)]'
                                : 'hover:bg-[var(--sh-hair-3)] text-[var(--sh-ink)]'
                            }`}
                          >
                            {/* Icon badge */}
                            <div
                              className="mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                              style={{
                                backgroundColor: `color-mix(in srgb, ${d.color || '#6b7280'} 16%, transparent)`,
                                color: d.color || 'var(--sh-ink-3)',
                              }}
                            >
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ background: d.color || 'var(--sh-ink-4)' }}
                              />
                            </div>

                            {/* Name + Description */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[12.5px] font-medium text-[var(--sh-ink)] leading-snug truncate">
                                  {d.label}
                                </span>
                              </div>
                              {d.description && (
                                <p className="text-[11px] text-[var(--sh-ink-3)] leading-tight mt-0.5 line-clamp-2 opacity-85">
                                  {d.description}
                                </p>
                              )}
                            </div>

                            {/* Selection checkmark */}
                            {selected && (
                              <svg
                                className="w-4 h-4 text-[#2962FF] shrink-0 mt-0.5"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="px-3 py-1.5 bg-[var(--surface-alt)] border-t border-[var(--sh-hair)] text-[10.5px] text-[var(--sh-ink-4)] flex items-center justify-between shrink-0">
              <span>{flatList.length} status{flatList.length !== 1 ? 'es' : ''} available</span>
              <span className="text-[9.5px]">Use ↑↓ to navigate, ↵ to pick</span>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
