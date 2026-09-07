import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SpaceStatus, TaskPriority, TaskTag, User } from '@squadhub/shared';
import {
  type TaskFilterState,
  type DueDatePreset,
  DUE_DATE_PRESETS,
  PRIORITY_OPTIONS,
  countActiveFilters,
  deriveStatusCategoryOptions,
} from '../../lib/filters';
import { PRIORITY_LABELS } from '../../lib/taskGrouping';

const PRIORITY_DOT: Record<TaskPriority, string> = {
  emergency: '#b91c1c',
  urgent: '#ef4444',
  high: '#f97316',
  normal: '#3b82f6',
  low: '#22c55e',
  none: '#9ca3af',
};

interface MinimalGroupFilterBarProps {
  groupOptions: { value: string; label: string }[];
  groupBy: string;
  onGroupChange: (v: string) => void;
  filters: TaskFilterState;
  onFiltersChange: (next: TaskFilterState) => void;
  statuses: SpaceStatus[];
  assigneeOptions: User[];
  tagOptions: TaskTag[];
  sortOptions?: { value: string; label: string }[];
  sortBy?: string;
  onSortChange?: (v: string) => void;
  /** Extra right-side controls (Focus today, My tasks, Save view…). Rendered minimal. */
  extraRight?: ReactNode;
  hideGroup?: boolean;
}

const LAYERS_ICON = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2 2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
  </svg>
);

const FILTER_ICON = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

const SORT_ICON = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h13M3 12h9M3 18h5M17 8v12m0 0l-3-3m3 3l3-3" />
  </svg>
);

const CHECK = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export default function MinimalGroupFilterBar({
  groupOptions,
  groupBy,
  onGroupChange,
  filters,
  onFiltersChange,
  statuses,
  assigneeOptions,
  tagOptions,
  sortOptions,
  sortBy,
  onSortChange,
  extraRight,
  hideGroup = false,
}: MinimalGroupFilterBarProps) {
  const [groupOpen, setGroupOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const groupTriggerRef = useRef<HTMLButtonElement | null>(null);
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null);

  const activeCount = countActiveFilters(filters);
  const statusOptions = useMemo(() => deriveStatusCategoryOptions(statuses), [statuses]);
  const currentGroup = groupOptions.find((o) => o.value === groupBy) ?? groupOptions[0];
  const currentSort = sortOptions?.find((o) => o.value === sortBy);

  useEffect(() => {
    if (!groupOpen && !filterOpen && !sortOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setGroupOpen(false);
        setFilterOpen(false);
        setSortOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setGroupOpen(false);
        setFilterOpen(false);
        setSortOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [groupOpen, filterOpen, sortOpen]);

  const toggleArr = <T,>(arr: T[] | undefined, val: T): T[] => {
    const cur = arr ?? [];
    return cur.includes(val) ? cur.filter((v) => v !== val) : [...cur, val];
  };

  const set = (patch: Partial<TaskFilterState>) => onFiltersChange({ ...filters, ...patch });
  const clearAll = () => onFiltersChange({});

  return (
    <div ref={rootRef} className="mgf-bar">
      {/* Right-aligned: Group + Sort + extras + Filter */}
      <div className="mgf-right">
        {!hideGroup && (
        <>
        <div className="mgf-anchor">
          <button
            ref={groupTriggerRef}
            type="button"
            className="mgf-pill"
            data-active={groupBy !== 'none' || undefined}
            aria-expanded={groupOpen}
            aria-haspopup="listbox"
            onClick={() => {
              setGroupOpen((v) => !v);
              setFilterOpen(false);
              setSortOpen(false);
            }}
            title="Group tasks"
          >
            {LAYERS_ICON}
            <span>{currentGroup?.label ?? 'Group'}</span>
          </button>
          {groupOpen && (
            <div className="mgf-menu" role="listbox" aria-label="Group tasks by">
              <div className="mgf-menu-head">Group by</div>
              {groupOptions.map((opt) => {
                const active = opt.value === groupBy;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className="mgf-item"
                    data-active={active || undefined}
                    onClick={() => {
                      onGroupChange(opt.value);
                      setGroupOpen(false);
                      groupTriggerRef.current?.focus();
                    }}
                  >
                    <span>{opt.label}</span>
                    {active && <span className="mgf-check">{CHECK}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {sortOptions && onSortChange && (
          <div className="mgf-anchor">
            <button
              type="button"
              className="mgf-iconbtn"
              data-active={sortBy && sortBy !== 'manual' ? true : undefined}
              aria-expanded={sortOpen}
              aria-label={currentSort ? `Sort: ${currentSort.label}` : 'Sort tasks'}
              title={currentSort ? `Sort: ${currentSort.label}` : 'Sort tasks'}
              onClick={() => {
                setSortOpen((v) => !v);
                setGroupOpen(false);
                setFilterOpen(false);
              }}
            >
              {SORT_ICON}
              {currentSort && sortBy !== 'manual' && <span className="mgf-sortlbl">{currentSort.label}</span>}
            </button>
            {sortOpen && (
              <div className="mgf-menu" role="listbox" aria-label="Sort tasks by">
                <div className="mgf-menu-head">Sort by</div>
                {sortOptions.map((opt) => {
                  const active = opt.value === sortBy;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className="mgf-item"
                      data-active={active || undefined}
                      onClick={() => {
                        onSortChange(opt.value);
                        setSortOpen(false);
                      }}
                    >
                      <span>{opt.label}</span>
                      {active && <span className="mgf-check">{CHECK}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        </>
        )}
        {extraRight}
        <div className="mgf-anchor">
          <button
            ref={filterTriggerRef}
            type="button"
            className="mgf-pill mgf-filter"
            data-active={activeCount > 0 || undefined}
            aria-expanded={filterOpen}
            aria-haspopup="dialog"
            onClick={() => {
              setFilterOpen((v) => !v);
              setGroupOpen(false);
              setSortOpen(false);
            }}
            title="Filter tasks"
          >
            {FILTER_ICON}
            <span>{activeCount > 0 ? `${activeCount} Filter${activeCount === 1 ? '' : 's'}` : 'Filter'}</span>
          </button>
          {filterOpen && (
            <div className="mgf-pop" role="dialog" aria-label="Filter tasks">
              <MgfSection title="Status">
                {statusOptions.length === 0 ? (
                  <MgfEmpty text="No statuses" />
                ) : (
                  statusOptions.map((s) => (
                    <MgfRow
                      key={s.category}
                      checked={filters.statusCategories?.includes(s.category) ?? false}
                      onToggle={() => set({ statusCategories: toggleArr(filters.statusCategories, s.category) })}
                      label={s.name}
                      swatch={s.color}
                    />
                  ))
                )}
              </MgfSection>
              <MgfSection title="Priority">
                {PRIORITY_OPTIONS.map((p) => (
                  <MgfRow
                    key={p}
                    checked={filters.priorities?.includes(p) ?? false}
                    onToggle={() => set({ priorities: toggleArr(filters.priorities, p) })}
                    label={PRIORITY_LABELS[p] ?? p}
                    swatch={PRIORITY_DOT[p]}
                  />
                ))}
              </MgfSection>
              <MgfSection title="Assignee">
                {assigneeOptions.length === 0 ? (
                  <MgfEmpty text="No assignees" />
                ) : (
                  assigneeOptions.map((u) => (
                    <MgfRow
                      key={u.id}
                      checked={filters.assigneeIds?.includes(u.id) ?? false}
                      onToggle={() => set({ assigneeIds: toggleArr(filters.assigneeIds, u.id) })}
                      label={u.display_name || u.email}
                      avatar={(u.display_name || u.email || '?')[0]?.toUpperCase()}
                    />
                  ))
                )}
              </MgfSection>
              <MgfSection title="Labels">
                {tagOptions.length === 0 ? (
                  <MgfEmpty text="No labels" />
                ) : (
                  tagOptions.map((t) => (
                    <MgfRow
                      key={t.id}
                      checked={filters.tagIds?.includes(t.id) ?? false}
                      onToggle={() => set({ tagIds: toggleArr(filters.tagIds, t.id) })}
                      label={t.name}
                      swatch={t.color}
                    />
                  ))
                )}
              </MgfSection>
              <MgfSection title="Due date" last>
                {DUE_DATE_PRESETS.map((opt: { value: DueDatePreset; label: string }) => (
                  <MgfRow
                    key={opt.value}
                    checked={filters.dueDate?.includes(opt.value) ?? false}
                    onToggle={() => set({ dueDate: toggleArr(filters.dueDate, opt.value) })}
                    label={opt.label}
                  />
                ))}
              </MgfSection>
              <div className="mgf-foot">
                <button type="button" className="mgf-clear" onClick={clearAll} disabled={activeCount === 0}>
                  Clear all
                </button>
                <button type="button" className="mgf-done" onClick={() => setFilterOpen(false)}>
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MgfSection({ title, children, last = false }: { title: string; children: ReactNode; last?: boolean }) {
  return (
    <div className="mgf-sec" data-last={last || undefined}>
      <div className="mgf-sec-t">{title}</div>
      <div className="mgf-sec-b">{children}</div>
    </div>
  );
}

function MgfRow({
  checked,
  onToggle,
  label,
  swatch,
  avatar,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  swatch?: string;
  avatar?: string;
}) {
  return (
    <label className="mgf-row">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      {swatch && <span className="mgf-dot" style={{ background: swatch }} aria-hidden="true" />}
      {avatar && <span className="mgf-ava" aria-hidden="true">{avatar}</span>}
      <span className="mgf-row-lbl">{label}</span>
    </label>
  );
}

function MgfEmpty({ text }: { text: string }) {
  return <div className="mgf-empty">{text}</div>;
}
