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
  'not_started',
  'scheduled_queued',
  'in_motion',
  'routines',
  'blocked_paused',
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
    const reposition = () => {
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groupCatalog(catalog);
    const matched = catalog.filter(
      (d) => d.label.toLowerCase().includes(q) || d.description.toLowerCase().includes(q)
    );
    return groupCatalog(matched);
  }, [query, catalog]);

  const pick = (key: TaskStatusKey) => {
    onChange(key);
    setOpen(false);
    setQuery('');
  };

  // Fixed popover position: default to anchor.bottom, but flip above the button
  // if there isn't enough room below.
  const popoverStyle = useMemo<React.CSSProperties>(() => {
    if (!anchor || typeof window === 'undefined') return { visibility: 'hidden' };
    const width = 320;
    const maxHeight = Math.min(460, window.innerHeight - 24);
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
        <div
          ref={popoverRef}
          className="flex flex-col overflow-hidden rounded-xl border shadow-xl"
          style={popoverStyle}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="p-3">
            <div
              className="flex items-center gap-2 rounded-md border px-2 py-1.5"
              style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface)' }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[color:var(--sh-ink-4)]"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search statuses…"
                className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-[color:var(--sh-ink-4)]"
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
            {filtered.length === 0 ? (
              <div className="px-2 py-4 text-center text-[12px] text-[color:var(--sh-ink-4)]">
                No statuses match &ldquo;{query}&rdquo;
              </div>
            ) : (
              filtered.map((g) => (
                <div key={g.group} className="mb-1">
                  <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[11px] uppercase tracking-wider text-[color:var(--sh-ink-4)]">
                    <span aria-hidden>{g.emoji}</span>
                    <span>{g.label}</span>
                  </div>
                  {g.items.map((d) => {
                    const selected = d.key === value;
                    return (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => pick(d.key)}
                        className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition ${
                          selected
                            ? 'bg-[color:rgba(34,197,94,0.12)] text-[#16a34a]'
                            : 'hover:bg-[color:var(--sh-hair-3)]'
                        }`}
                      >
                        <span
                          className="mt-1 h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ background: d.color }}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] font-medium truncate">{d.label}</span>
                          <span className="block text-[11px] text-[color:var(--sh-ink-4)] truncate">
                            {d.description}
                          </span>
                        </span>
                        {selected && (
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="mt-0.5 shrink-0"
                          >
                            <path d="M5 12l5 5 9-11" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
