import { useEffect, useMemo, useRef, useState } from 'react';
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

interface FilterBarProps {
  filters: TaskFilterState;
  onChange: (next: TaskFilterState) => void;
  statuses: SpaceStatus[];
  assigneeOptions: User[];
  tagOptions: TaskTag[];
}

export default function FilterBar({ filters, onChange, statuses, assigneeOptions, tagOptions }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const activeCount = countActiveFilters(filters);
  const statusOptions = useMemo(() => deriveStatusCategoryOptions(statuses), [statuses]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleArrayValue = <T,>(arr: T[] | undefined, val: T): T[] => {
    const cur = arr ?? [];
    return cur.includes(val) ? cur.filter((v) => v !== val) : [...cur, val];
  };

  const toggleStatus = (cat: string) => onChange({ ...filters, statusCategories: toggleArrayValue(filters.statusCategories, cat) });
  const togglePriority = (p: TaskPriority) => onChange({ ...filters, priorities: toggleArrayValue(filters.priorities, p) });
  const toggleAssignee = (id: string) => onChange({ ...filters, assigneeIds: toggleArrayValue(filters.assigneeIds, id) });
  const toggleTag = (id: string) => onChange({ ...filters, tagIds: toggleArrayValue(filters.tagIds, id) });
  const toggleDue = (p: DueDatePreset) => onChange({ ...filters, dueDate: toggleArrayValue(filters.dueDate, p) });
  const clearAll = () => onChange({});

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button
        ref={triggerRef}
        type="button"
        className="lv-toolbtn"
        data-active={activeCount > 0}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        title="Filter tasks"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        Filter
        {activeCount > 0 && <span className="lv-toolbtn-badge">{activeCount}</span>}
      </button>

      {activeCount > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className="pill"
          title="Clear all filters"
          style={{ background: 'transparent', border: 'none', color: 'var(--sh-ink-3)', fontSize: 11, padding: '2px 6px' }}
        >
          Clear
        </button>
      )}

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Filter tasks"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 50,
            width: 280,
            maxHeight: 'min(70vh, 480px)',
            overflowY: 'auto',
            background: 'var(--surface)',
            border: '1px solid var(--sh-hair)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            padding: 10,
            fontSize: 12,
          }}
        >
          <Section title="Status">
            {statusOptions.length === 0 ? (
              <EmptyHint text="No statuses available" />
            ) : (
              statusOptions.map((s) => (
                <CheckRow
                  key={s.category}
                  checked={filters.statusCategories?.includes(s.category) ?? false}
                  onToggle={() => toggleStatus(s.category)}
                  label={s.name}
                  swatchColor={s.color}
                />
              ))
            )}
          </Section>

          <Section title="Priority">
            {PRIORITY_OPTIONS.map((p) => (
              <CheckRow
                key={p}
                checked={filters.priorities?.includes(p) ?? false}
                onToggle={() => togglePriority(p)}
                label={PRIORITY_LABELS[p] ?? p}
                swatchColor={PRIORITY_DOT[p]}
              />
            ))}
          </Section>

          <Section title="Assignee">
            {assigneeOptions.length === 0 ? (
              <EmptyHint text="No assignees on visible tasks" />
            ) : (
              assigneeOptions.map((u) => (
                <CheckRow
                  key={u.id}
                  checked={filters.assigneeIds?.includes(u.id) ?? false}
                  onToggle={() => toggleAssignee(u.id)}
                  label={u.display_name || u.email}
                  avatar={(u.display_name || u.email || '?')[0]?.toUpperCase()}
                />
              ))
            )}
          </Section>

          <Section title="Tags">
            {tagOptions.length === 0 ? (
              <EmptyHint text="No tags on visible tasks" />
            ) : (
              tagOptions.map((t) => (
                <CheckRow
                  key={t.id}
                  checked={filters.tagIds?.includes(t.id) ?? false}
                  onToggle={() => toggleTag(t.id)}
                  label={t.name}
                  swatchColor={t.color}
                />
              ))
            )}
          </Section>

          <Section title="Due date" last>
            {DUE_DATE_PRESETS.map((opt) => (
              <CheckRow
                key={opt.value}
                checked={filters.dueDate?.includes(opt.value) ?? false}
                onToggle={() => toggleDue(opt.value)}
                label={opt.label}
              />
            ))}
          </Section>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, marginTop: 4, borderTop: '1px solid var(--sh-hair)' }}>
            <button
              type="button"
              onClick={clearAll}
              disabled={activeCount === 0}
              style={{
                background: 'transparent',
                border: 'none',
                color: activeCount === 0 ? 'var(--sh-ink-4)' : 'var(--sh-ink-3)',
                cursor: activeCount === 0 ? 'default' : 'pointer',
                fontSize: 11,
                padding: '4px 0',
              }}
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                background: 'var(--sh-ink)',
                color: 'var(--surface)',
                border: 'none',
                borderRadius: 999,
                fontSize: 11,
                padding: '4px 12px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children, last = false }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ marginBottom: last ? 0 : 8, paddingBottom: last ? 0 : 8, borderBottom: last ? 'none' : '1px solid var(--sh-hair-3)' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--sh-ink-4)', fontWeight: 600, marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{children}</div>
    </div>
  );
}

function CheckRow({
  checked,
  onToggle,
  label,
  swatchColor,
  avatar,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  swatchColor?: string;
  avatar?: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 6px',
        borderRadius: 4,
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sh-hair-3)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        style={{ margin: 0, accentColor: 'var(--sh-ink)' }}
      />
      {swatchColor && (
        <span
          aria-hidden="true"
          style={{ width: 8, height: 8, borderRadius: 999, background: swatchColor, flexShrink: 0 }}
        />
      )}
      {avatar && (
        <span
          aria-hidden="true"
          style={{
            width: 18,
            height: 18,
            borderRadius: 999,
            background: 'var(--sh-hair-3)',
            color: 'var(--sh-ink)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {avatar}
        </span>
      )}
      <span style={{ color: 'var(--sh-ink)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </label>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <div style={{ padding: '4px 6px', color: 'var(--sh-ink-4)', fontSize: 11, fontStyle: 'italic' }}>{text}</div>;
}
