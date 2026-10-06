import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ListViewColumnId, ListViewColumnState } from '@squadhub/shared';
import {
  COLUMN_DEFS,
  moveColumn,
  normalizeColumns,
  toggleColumnVisibility,
} from '../../lib/columns';

function FieldIcon({ id }: { id: string }) {
  const stroke = 1.8;
  switch (id) {
    case 'name':
      return (
        <span className="flex h-4 w-4 items-center justify-center text-[12px] font-bold text-[var(--sh-ink-3)]">
          Aa
        </span>
      );
    case 'assignee':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );
    case 'status':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="9" x2="20" y2="9" />
          <line x1="4" y1="15" x2="20" y2="15" />
          <line x1="10" y1="3" x2="8" y2="21" />
          <line x1="16" y1="3" x2="14" y2="21" />
        </svg>
      );
    case 'priority':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
      );
    case 'labels':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      );
    case 'type':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      );
    case 'tracked':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="14" r="8" />
          <line x1="12" y1="2" x2="12" y2="5" />
          <line x1="10" y1="2" x2="14" y2="2" />
          <polyline points="12 10 12 14 15 14" />
        </svg>
      );
    case 'estimate':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case 'startDate':
    case 'workDate':
    case 'dueDate':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case 'latestComment':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'comments':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      );
    case 'createdBy':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <line x1="20" y1="8" x2="20" y2="14" />
          <line x1="23" y1="11" x2="17" y2="11" />
        </svg>
      );
    case 'dateCreated':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <line x1="12" y1="13" x2="12" y2="17" />
          <line x1="10" y1="15" x2="14" y2="15" />
        </svg>
      );
    case 'dateCompleted':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <polyline points="9 15 11 17 15 13" />
        </svg>
      );
    case 'taskId':
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="7" y1="8" x2="11" y2="8" />
          <line x1="7" y1="12" x2="13" y2="12" />
          <line x1="7" y1="16" x2="9" y2="16" />
        </svg>
      );
    default:
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}

function Toggle({
  on,
  onToggle,
  disabled = false,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
      className={`relative inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full transition-colors duration-150 ${
        disabled
          ? 'cursor-not-allowed opacity-60 bg-[#10b981]'
          : on
          ? 'cursor-pointer bg-[#10b981]'
          : 'cursor-pointer bg-[var(--sh-hair-2,#cbd5e1)]'
      }`}
    >
      <span
        aria-hidden
        className={`inline-block h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform duration-150 ${
          on ? 'translate-x-[15px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}

/**
 * ClickUp-style field manager: full-height right drawer with search, tabs,
 * a Shown section (toggles on + reorder arrows) and a Properties section (toggles off).
 * Opened from the "+" at the end of each group's column headers.
 */
export default function FieldManagerPanel({
  open,
  onClose,
  columns,
  onChange,
  onReset,
  hasOverride,
}: {
  open: boolean;
  onClose: () => void;
  columns: ListViewColumnState[];
  onChange: (next: ListViewColumnState[]) => void;
  onReset?: () => void;
  hasOverride?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [shownCollapsed, setShownCollapsed] = useState(false);
  const [hiddenCollapsed, setHiddenCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const normalized = normalizeColumns(columns);
  const q = query.trim().toLowerCase();
  const matches = (id: string) =>
    !q || (COLUMN_DEFS.find((d) => d.id === id)?.label ?? id).toLowerCase().includes(q);

  const shownAll = normalized.filter((c) => c.visible);
  const shown = shownAll.filter((c) => matches(c.id));
  const hiddenAll = normalized.filter((c) => !c.visible);
  const hidden = hiddenAll.filter((c) => matches(c.id));

  // Count includes the mandatory Task Name
  const totalShownCount = shownAll.length + 1;
  const totalHiddenCount = hiddenAll.length;

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setMenuOpen(false);
    const t = window.setTimeout(() => searchRef.current?.focus(), 80);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const labelFor = (id: string) => COLUMN_DEFS.find((d) => d.id === id)?.label ?? id;
  const toggle = (id: ListViewColumnId) => onChange(toggleColumnVisibility(normalized, id));

  const renderRow = (
    col: (typeof normalized)[number],
    orderIdx: number | null,
    isShown: boolean,
  ) => {
    const label = labelFor(col.id);
    return (
      <div
        key={col.id}
        onClick={() => toggle(col.id)}
        className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors cursor-pointer hover:bg-[var(--sh-hair-3)]"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--sh-ink-3)]">
          <FieldIcon id={col.id} />
        </span>
        <span className="flex-1 truncate text-[13px] font-normal text-[var(--sh-ink)]">
          {label}
        </span>
        {isShown && orderIdx !== null && (
          <span
            className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              disabled={orderIdx === 0}
              onClick={() => onChange(moveColumn(normalized, col.id, -1))}
              title={`Move ${label} left (earlier)`}
              aria-label={`Move ${label} left (earlier)`}
              className="flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-2)] hover:text-[var(--sh-ink)] disabled:opacity-30 disabled:pointer-events-none"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={orderIdx === shownAll.length - 1}
              onClick={() => onChange(moveColumn(normalized, col.id, 1))}
              title={`Move ${label} right (later)`}
              aria-label={`Move ${label} right (later)`}
              className="flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-2)] hover:text-[var(--sh-ink)] disabled:opacity-30 disabled:pointer-events-none"
            >
              ↓
            </button>
          </span>
        )}
        <Toggle
          on={col.visible}
          onToggle={() => toggle(col.id)}
          label={`${col.visible ? 'Hide' : 'Show'} ${label}`}
        />
      </div>
    );
  };

  const content = (
    <div className="fixed inset-0 z-[80] overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-[1px] transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className="cfm-panel absolute right-0 top-0 bottom-0 flex w-[330px] max-w-[90vw] flex-col border-l bg-[var(--surface)] shadow-2xl"
        style={{ borderColor: 'var(--sh-hair)' }}
        role="dialog"
        aria-label="Manage fields in this view"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2.5">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold tracking-tight text-[var(--sh-ink)] font-[family-name:var(--font-display)]">
              Fields
            </h2>
            {hasOverride && (
              <span className="rounded-full bg-[var(--sh-hair-3)] px-2 py-0.5 text-[10px] font-semibold text-[var(--sh-ink-3)]">
                Custom
              </span>
            )}
          </div>
          <div className="relative flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)] transition"
              title="Field settings"
              aria-label="Field settings"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div
                  className="sh-float absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border bg-[var(--surface)] py-1 shadow-lg"
                  style={{ borderColor: 'var(--sh-hair)' }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onChange(normalized.map((c) => ({ ...c, visible: true })));
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--sh-ink)] hover:bg-[var(--sh-hair-3)]"
                  >
                    Show all fields
                  </button>
                  {onReset && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onReset();
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
                    >
                      Reset to view default
                    </button>
                  )}
                </div>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)] transition"
              title="Close panel"
              aria-label="Close panel"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search Input */}
        <div className="px-4 pb-2">
          <div className="relative flex items-center">
            <svg
              className="pointer-events-none absolute left-3 text-[var(--sh-ink-4)]"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Task Fields"
              aria-label="Search Task Fields"
              className="w-full rounded-lg border bg-[var(--surface)] py-1.5 pl-8 pr-7 text-xs text-[var(--sh-ink)] placeholder-[var(--sh-ink-4)] outline-none transition focus:border-[#10b981] focus:ring-1 focus:ring-[#10b981]/30"
              style={{ borderColor: 'var(--sh-hair)' }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2.5 text-[var(--sh-ink-4)] hover:text-[var(--sh-ink)] text-xs"
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* List of fields: Shown + Properties */}
        <div className="flex-1 overflow-y-auto px-2.5 py-2 border-t" style={{ borderColor: 'var(--sh-hair-3)' }}>
          {/* ── Shown section ── */}
            <div>
              <button
                type="button"
                onClick={() => setShownCollapsed((v) => !v)}
                className="flex w-full items-center justify-between px-2 py-1.5 text-left"
              >
                <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--sh-ink-3)]">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    style={{
                      transform: shownCollapsed ? 'rotate(-90deg)' : 'none',
                      transition: 'transform 0.15s',
                    }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                  <span>Shown</span>
                </div>
                <span className="text-[11px] font-medium text-[var(--sh-ink-4)]">
                  {totalShownCount}
                </span>
              </button>

              {!shownCollapsed && (
                <div className="space-y-0.5">
                  {/* Task Name — mandatory primary column */}
                  {(!q || 'task name'.includes(q) || 'name'.includes(q)) && (
                    <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 opacity-80">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--sh-ink-3)]">
                        <FieldIcon id="name" />
                      </span>
                      <span className="flex-1 truncate text-[13px] font-normal text-[var(--sh-ink-3)]">
                        Task Name
                      </span>
                      <Toggle
                        on={true}
                        onToggle={() => {}}
                        disabled={true}
                        label="Task Name (always visible)"
                      />
                    </div>
                  )}

                  {shown.map((col) =>
                    renderRow(col, shownAll.findIndex((c) => c.id === col.id), true),
                  )}

                  {shown.length === 0 && !(!q || 'task name'.includes(q)) && (
                    <p className="px-3 py-2 text-xs text-[var(--sh-ink-4)]">
                      No shown fields match "{query}".
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* ── Properties (Hidden) section ── */}
            {hiddenAll.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setHiddenCollapsed((v) => !v)}
                  className="flex w-full items-center justify-between px-2 py-1.5 text-left"
                >
                  <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--sh-ink-3)]">
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      style={{
                        transform: hiddenCollapsed ? 'rotate(-90deg)' : 'none',
                        transition: 'transform 0.15s',
                      }}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                    <span>Properties</span>
                  </div>
                  <span className="text-[11px] font-medium text-[var(--sh-ink-4)]">
                    {totalHiddenCount}
                  </span>
                </button>

                {!hiddenCollapsed && (
                  <div className="space-y-0.5">
                    {hidden.map((col) => renderRow(col, null, false))}
                    {hidden.length === 0 && q && (
                      <p className="px-3 py-2 text-xs text-[var(--sh-ink-4)]">
                        No hidden properties match "{query}".
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between border-t px-4 py-3"
          style={{ borderColor: 'var(--sh-hair-3)' }}
        >
          <button
            type="button"
            onClick={() => onChange(normalized.map((c) => ({ ...c, visible: true })))}
            className="text-xs font-medium text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)] transition"
          >
            Show all
          </button>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="text-xs font-medium text-[var(--sh-ink-3)] hover:text-[var(--sh-ink)] transition"
              title="Reset to default columns"
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#10b981] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#059669] transition"
          >
            Done
          </button>
        </div>
      </aside>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : null;
}
