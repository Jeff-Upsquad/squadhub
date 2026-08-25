import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdateTask } from '../../../hooks/useTasks';
import { useReviewTask, type NewTask } from '../../../hooks/useNewTasks';
import { useFocusTask } from '../../../hooks/useDayPlanner';
import { isTaskFocused } from '../../../lib/taskGrouping';
import { usePMStore } from '../../../stores/pmStore';
import AssigneePicker from '../pm/AssigneePicker';
import TaskStatusPicker from '../pm/TaskStatusPicker';
import DatePicker from '../pm/DatePicker';

// ---- small display helpers (mirrors DashboardTaskRow's avatar logic) ----
function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}
function avatarColor(seed: string | undefined | null): string {
  if (!seed) return 'oklch(0.6 0.1 260)';
  return `oklch(0.6 0.12 ${hashHue(seed)})`;
}
function initialOf(name: string | undefined | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}
function fmtDateCell(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const delta = Math.round((that - today) / 86_400_000);
  let datePart = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  if (delta === 0) datePart = 'Today';
  else if (delta === 1) datePart = 'Tomorrow';
  else if (delta === -1) datePart = 'Yesterday';
  const hasTime = !(d.getHours() === 0 && d.getMinutes() === 0);
  if (!hasTime) return datePart;
  const timePart = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

// Time-estimate parse/format — mirrors TaskDetailPanel / TaskCreatePanel so the
// "2h 30m" shorthand reads and writes the same everywhere.
function parseTimeInput(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  let totalMinutes = 0;
  const hourMatch = trimmed.match(/(\d+)\s*h/);
  const minMatch = trimmed.match(/(\d+)\s*m/);
  if (hourMatch) totalMinutes += parseInt(hourMatch[1]) * 60;
  if (minMatch) totalMinutes += parseInt(minMatch[1]);
  if (!hourMatch && !minMatch) {
    const num = parseFloat(trimmed);
    if (!isNaN(num)) totalMinutes = Math.round(num * 60);
    else return null;
  }
  return totalMinutes > 0 ? totalMinutes : null;
}

function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

const PRIORITIES: { key: string; label: string; color: string }[] = [
  { key: 'emergency', label: 'Emergency', color: '#DC2626' },
  { key: 'urgent', label: 'Urgent', color: '#F97316' },
  { key: 'high', label: 'High', color: '#F59E0B' },
  { key: 'normal', label: 'Normal', color: '#3B82F6' },
  { key: 'low', label: 'Low', color: '#9CA3AF' },
  { key: 'none', label: 'None', color: 'transparent' },
];

// A compact priority menu — no standalone PrioritySelect exists in the app, so this
// mirrors the look of the other anchored popovers (fixed position from a cell rect).
function PriorityMenu({
  anchorRect,
  value,
  onPick,
  onClose,
}: {
  anchorRect: DOMRect | null;
  value: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  if (!anchorRect || typeof document === 'undefined') return null;
  const width = 176;
  let left = anchorRect.left;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  const top = anchorRect.bottom + 4;

  return createPortal(
    <div
      ref={ref}
      className="nt-menu"
      style={{ position: 'fixed', top, left, width, zIndex: 100 }}
    >
      {PRIORITIES.map((p) => (
        <button
          key={p.key}
          type="button"
          className="nt-menu-item"
          data-active={p.key === value || undefined}
          onClick={() => onPick(p.key)}
        >
          <span
            className="nt-pri-dot"
            style={{ background: p.color, borderColor: p.key === 'none' ? 'var(--sh-hair-2)' : p.color }}
          />
          {p.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

// A tiny inline editor for the time estimate — accepts the same "2h 30m" shorthand
// as the task detail panel. Commits on Enter or click-away; Escape discards.
function EstimateMenu({
  anchorRect,
  value,
  onApply,
  onClose,
}: {
  anchorRect: DOMRect | null;
  value: number | null;
  onApply: (mins: number | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState(() => formatMinutes(value));

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onApply(parseTimeInput(input));
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [input, onApply]);

  if (!anchorRect || typeof document === 'undefined') return null;
  const width = 168;
  let left = anchorRect.left;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  const top = anchorRect.bottom + 4;

  return createPortal(
    <div ref={ref} className="nt-menu nt-estimate-menu" style={{ position: 'fixed', top, left, width, zIndex: 100 }}>
      <input
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onApply(parseTimeInput(input));
          if (e.key === 'Escape') onClose();
        }}
        placeholder="e.g. 2h 30m"
        className="nt-estimate-input"
      />
      <div className="nt-estimate-hint">Enter to save · Esc to cancel</div>
    </div>,
    document.body,
  );
}

type Editor = null | 'assignee' | 'priority' | 'work' | 'start' | 'due' | 'estimate';

export default function NewTaskRow({
  task,
  showReviewed,
}: {
  task: NewTask;
  showReviewed: boolean;
}) {
  const qc = useQueryClient();
  const updateTask = useUpdateTask(null);
  const reviewTask = useReviewTask();
  const focusTask = useFocusTask();
  // Opening a task sets activeTaskId → the global TaskDetailPanel renders on top of
  // this popup (which stays mounted underneath). See z-index note in globals.css.
  const setActiveTask = usePMStore((s) => s.setActiveTask);

  const [editor, setEditor] = useState<Editor>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [fading, setFading] = useState(false);
  const [hidden, setHidden] = useState(false);

  const t = task as any;
  const assignees = (task.assignees || []) as Array<{ id: string; display_name?: string; email?: string }>;
  const assigneeIds = useMemo(() => assignees.map((a) => a.id), [assignees]);
  const priority = (t.priority as string) || 'none';
  const priDef = PRIORITIES.find((p) => p.key === priority);
  const breadcrumb = [t.space?.name, t.folder?.name, t.list?.name].filter(Boolean).join(' / ') || t.parent_task?.title || '';
  const isFocused = isTaskFocused(task);

  // Optimistically patch both queue caches so a cell updates instantly, then let the
  // server be the source of truth (a refetch may legitimately drop the row — e.g.
  // assigning a task I created hands it off and it leaves my queue).
  const applyEdit = (patch: Record<string, unknown>) => {
    for (const key of [['new-tasks', false], ['new-tasks', true]] as const) {
      qc.setQueryData(key, (old: NewTask[] | undefined) =>
        Array.isArray(old) ? old.map((row) => (row.id === task.id ? { ...row, ...patch } : row)) : old);
    }
    updateTask.mutate({ id: task.id, ...patch } as any, {
      onSettled: () => qc.invalidateQueries({ queryKey: ['new-tasks'] }),
    });
  };

  const openEditor = (kind: Exclude<Editor, null>, e: React.MouseEvent) => {
    setAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect());
    setEditor(kind);
  };
  const closeEditor = () => { setEditor(null); setAnchorRect(null); };

  // Toggle the persistent "focus today" star. useFocusTask patches the day-planner /
  // my-tasks caches but not the new-tasks queue, so patch those here for an instant
  // flip; the mutation persists tasks.focused_at server-side.
  const onToggleFocus = (e: React.MouseEvent) => {
    e.stopPropagation();
    const focused = !isFocused;
    const focused_at = focused ? new Date().toISOString() : null;
    for (const key of [['new-tasks', false], ['new-tasks', true]] as const) {
      qc.setQueryData(key, (old: NewTask[] | undefined) =>
        Array.isArray(old) ? old.map((row) => (row.id === task.id ? { ...row, focused_at } : row)) : old);
    }
    focusTask.mutate({ id: task.id, focused });
  };

  const onToggleReview = () => {
    if (showReviewed) {
      // "Show reviewed" mode: toggle the flag in place, no removal.
      const next = !task.reviewed;
      qc.setQueryData(['new-tasks', true], (old: NewTask[] | undefined) =>
        Array.isArray(old) ? old.map((row) => (row.id === task.id ? { ...row, reviewed: next } : row)) : old);
      reviewTask.mutate({ taskId: task.id, reviewed: next });
      return;
    }
    // Default queue: ticking means "I've reviewed this" → fade out and drop.
    setFading(true);
    reviewTask.mutate(
      { taskId: task.id, reviewed: true },
      { onError: () => { setFading(false); setHidden(false); } },
    );
  };

  const onRowTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.propertyName === 'transform' && fading) setHidden(true);
  };

  if (hidden) return null;

  const checked = showReviewed ? !!task.reviewed : false;

  return (
    <div className="nt-row" data-fading={fading || undefined} onTransitionEnd={onRowTransitionEnd}>
      <div className="nt-row-grid">
      {/* Review */}
      <div className="nt-cell nt-c-review">
        <button
          type="button"
          className="nt-check"
          data-checked={checked || undefined}
          aria-label={checked ? 'Mark as not reviewed' : 'Mark as reviewed'}
          title={checked ? 'Reviewed — click to undo' : 'Mark reviewed'}
          onClick={onToggleReview}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </button>
      </div>

      {/* Task */}
      <div className="nt-cell nt-c-task">
        <div className="nt-task-main">
          <button
            type="button"
            className="nt-focus-star"
            data-active={isFocused || undefined}
            aria-label={isFocused ? 'Focused for today — click to remove' : 'Focus today'}
            title={isFocused ? 'Focused for today — click to remove' : 'Focus today'}
            onClick={onToggleFocus}
          >
            {isFocused ? '★' : '☆'}
          </button>
          <div className="nt-task-text">
            <button type="button" className="nt-title" title={`Open “${t.title}”`} onClick={() => setActiveTask(task.id)}>{t.title}</button>
            {breadcrumb && <div className="nt-breadcrumb" title={breadcrumb}>{breadcrumb}</div>}
          </div>
        </div>
      </div>

      {/* Assignee */}
      <div className="nt-cell nt-c-assignee">
        <button type="button" className="nt-cellbtn" onClick={(e) => openEditor('assignee', e)}>
          {assignees.length === 0 ? (
            <span className="nt-placeholder">Assign</span>
          ) : (
            <span className="nt-avatars">
              {assignees.slice(0, 3).map((a) => (
                <span
                  key={a.id}
                  className="nt-ava"
                  style={{ background: avatarColor(a.display_name || a.email || a.id) }}
                  title={a.display_name || a.email}
                >
                  {initialOf(a.display_name || a.email)}
                </span>
              ))}
              {assignees.length > 3 && <span className="nt-ava nt-ava-more">+{assignees.length - 3}</span>}
            </span>
          )}
        </button>
      </div>

      {/* Priority */}
      <div className="nt-cell nt-c-priority">
        <button type="button" className="nt-cellbtn" onClick={(e) => openEditor('priority', e)}>
          {priority === 'none' ? (
            <span className="nt-placeholder">Priority</span>
          ) : (
            <>
              <span className="nt-pri-dot" style={{ background: priDef?.color }} />
              <span>{priDef?.label}</span>
            </>
          )}
        </button>
      </div>

      {/* Status (self-contained picker) */}
      <div className="nt-cell nt-c-status">
        <TaskStatusPicker
          value={t.status}
          onChange={(key) => applyEdit({ status: key })}
          buttonClassName="nt-cellbtn nt-status-btn"
        />
      </div>

      {/* Estimate */}
      <div className="nt-cell nt-c-estimate">
        <button type="button" className="nt-cellbtn" onClick={(e) => openEditor('estimate', e)}>
          {t.time_estimate ? <span>{formatMinutes(t.time_estimate)}</span> : <span className="nt-placeholder">Estimate</span>}
        </button>
      </div>

      {/* Work date */}
      <div className="nt-cell nt-c-date">
        <button type="button" className="nt-cellbtn" onClick={(e) => openEditor('work', e)}>
          {t.work_date ? <span>{fmtDateCell(t.work_date)}</span> : <span className="nt-placeholder">—</span>}
        </button>
      </div>

      {/* Start date */}
      <div className="nt-cell nt-c-date">
        <button type="button" className="nt-cellbtn" onClick={(e) => openEditor('start', e)}>
          {t.start_date ? <span>{fmtDateCell(t.start_date)}</span> : <span className="nt-placeholder">—</span>}
        </button>
      </div>

      {/* Due date */}
      <div className="nt-cell nt-c-date">
        <button type="button" className="nt-cellbtn" onClick={(e) => openEditor('due', e)}>
          {t.due_date ? <span>{fmtDateCell(t.due_date)}</span> : <span className="nt-placeholder">—</span>}
        </button>
      </div>

      </div>

      {/* ---- editors (rendered outside the grid so fixed popovers don't shift columns) ---- */}
      {editor === 'assignee' && (
        <AssigneePicker
          taskId={task.id}
          currentAssigneeIds={assigneeIds}
          anchorRect={anchorRect}
          onChange={(ids) => applyEdit({ assignee_ids: ids })}
          onClose={closeEditor}
        />
      )}
      {editor === 'priority' && (
        <PriorityMenu
          anchorRect={anchorRect}
          value={priority}
          onPick={(p) => { applyEdit({ priority: p }); closeEditor(); }}
          onClose={closeEditor}
        />
      )}
      {editor === 'estimate' && (
        <EstimateMenu
          anchorRect={anchorRect}
          value={(t.time_estimate as number | null) ?? null}
          onApply={(mins) => { applyEdit({ time_estimate: mins }); closeEditor(); }}
          onClose={closeEditor}
        />
      )}
      {editor === 'work' && (
        <DatePicker anchorRect={anchorRect} value={t.work_date ?? null} mode="datetime" onChange={(v) => applyEdit({ work_date: v })} onClose={closeEditor} />
      )}
      {editor === 'start' && (
        <DatePicker anchorRect={anchorRect} value={t.start_date ?? null} mode="datetime" onChange={(v) => applyEdit({ start_date: v })} onClose={closeEditor} />
      )}
      {editor === 'due' && (
        <DatePicker anchorRect={anchorRect} value={t.due_date ?? null} mode="datetime" onChange={(v) => applyEdit({ due_date: v })} onClose={closeEditor} />
      )}
    </div>
  );
}
