import { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePMStore } from '../../../stores/pmStore';
import { useTask, useUpdateTask, useDeleteTask, useTaskComments, useAddComment, useCreateTask } from '../../../hooks/useTasks';
import { useTaskTypes } from '../../../hooks/useTaskTypes';
import {
  useChecklists,
  useCreateChecklist,
  useDeleteChecklist,
  useCreateChecklistItem,
  useUpdateChecklistItem,
  useDeleteChecklistItem,
} from '../../../hooks/useChecklists';
import api from '../../../services/api';
import type { SpaceStatus, TaskType, TaskTypeField, TaskMetadata, TaskPriority } from '@squadhub/shared';

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

function formatTracked(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function formatSeconds(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h) return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
  if (m) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

const PRIORITY_LABEL: Record<TaskPriority, string | null> = {
  urgent: 'P0',
  high: 'P1',
  normal: 'P2',
  low: 'P3',
  none: null,
};

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
  return parts.map(p => p[0]?.toUpperCase() || '').join('') || '?';
}

function formatDueRelative(iso: string | null | undefined): { text: string; accent: boolean } {
  if (!iso) return { text: 'No due date', accent: false };
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const delta = Math.round((that - today) / 86_400_000);
  const time = d.getHours() === 0 && d.getMinutes() === 0 ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  let prefix = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  if (delta === 0) prefix = 'Today';
  else if (delta === 1) prefix = 'Tomorrow';
  else if (delta === -1) prefix = 'Yesterday';
  const text = time ? `${prefix} · ${time}` : prefix;
  return { text, accent: delta <= 0 };
}

type AttachmentLike = { name?: string; size?: string | number };

export default function TaskDetailPanel({
  statuses,
  listId,
  canEdit = true,
  spaceName,
  spaceColor,
}: {
  statuses: SpaceStatus[];
  listId: string;
  canEdit?: boolean;
  spaceName?: string;
  spaceColor?: string | null;
}) {
  const { activeTaskId, setActiveTask, timer, startTimer: globalStartTimer, stopTimer: globalStopTimer } = usePMStore();
  const { data: task, isLoading } = useTask(activeTaskId);
  const { data: comments } = useTaskComments(activeTaskId);
  const { data: taskTypes } = useTaskTypes();
  const { data: checklists } = useChecklists(activeTaskId);
  const updateTask = useUpdateTask(listId);
  const deleteTask = useDeleteTask(listId);
  const createTask = useCreateTask(listId);
  const addComment = useAddComment(activeTaskId);
  const createChecklist = useCreateChecklist(activeTaskId);
  const deleteChecklist = useDeleteChecklist(activeTaskId);
  const createChecklistItem = useCreateChecklistItem(activeTaskId);
  const updateChecklistItem = useUpdateChecklistItem(activeTaskId);
  const deleteChecklistItem = useDeleteChecklistItem(activeTaskId);
  const qc = useQueryClient();

  const [editing, setEditing] = useState<'title' | 'description' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [commentText, setCommentText] = useState('');
  const [tab, setTab] = useState<'overview' | 'comments' | 'activity' | 'files'>('overview');
  const [estimateInput, setEstimateInput] = useState('');
  const [editingEstimate, setEditingEstimate] = useState(false);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [newItemDrafts, setNewItemDrafts] = useState<Record<string, string>>({});
  const [newChecklistTitle, setNewChecklistTitle] = useState<string | null>(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Enter animation: mount, then flip "open" on next frame
  useEffect(() => {
    if (activeTaskId) {
      const id = requestAnimationFrame(() => setMounted(true));
      return () => cancelAnimationFrame(id);
    }
    setMounted(false);
    return undefined;
  }, [activeTaskId]);

  // ESC to close — but not when focus is in an input/textarea (let the field handle it)
  useEffect(() => {
    if (!activeTaskId) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      setActiveTask(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTaskId, setActiveTask]);

  const currentType = useMemo<TaskType | null>(() => {
    if (!task || !taskTypes) return null;
    return taskTypes.find((t) => t.id === (task as any).task_type_id) || null;
  }, [task, taskTypes]);

  const customFields: TaskTypeField[] = currentType?.fields || [];
  const customValues = ((task?.metadata as TaskMetadata | undefined)?.custom || {}) as Record<string, unknown>;

  function updateCustomField(key: string, value: unknown) {
    if (!task) return;
    const nextCustom = { ...customValues, [key]: value };
    const nextMetadata: TaskMetadata = { ...(task.metadata || {}), custom: nextCustom };
    updateTask.mutate({ id: task.id, metadata: nextMetadata });
  }

  const isTimerForThisTask = timer?.taskId === activeTaskId;

  useEffect(() => {
    if (!isTimerForThisTask || !timer) { setTimerElapsed(0); return; }
    const tick = () => setTimerElapsed(Math.floor((Date.now() - timer.startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isTimerForThisTask, timer]);

  const handleStartTimer = async () => {
    if (!task) return;
    const prev = globalStartTimer(task.id, task.title, listId, task.time_tracked || 0);
    if (prev) {
      const elapsedSecs = Math.floor((Date.now() - prev.startedAt) / 1000);
      const newTracked = prev.baseTracked + elapsedSecs;
      try {
        await api.put(`/pm/tasks/${prev.taskId}`, { time_tracked: newTracked });
        qc.invalidateQueries({ queryKey: ['tasks', prev.listId] });
        qc.invalidateQueries({ queryKey: ['task', prev.taskId] });
      } catch (err) {
        console.error('Failed to save previous timer:', err);
      }
    }
  };

  const handleStopTimer = async () => {
    const stopped = globalStopTimer();
    if (!stopped) return;
    const elapsedSecs = Math.floor((Date.now() - stopped.startedAt) / 1000);
    const newTracked = stopped.baseTracked + elapsedSecs;
    try {
      await api.put(`/pm/tasks/${stopped.taskId}`, { time_tracked: newTracked });
      qc.invalidateQueries({ queryKey: ['tasks', stopped.listId] });
      qc.invalidateQueries({ queryKey: ['task', stopped.taskId] });
    } catch (err) {
      console.error('Failed to save tracked time:', err);
    }
  };

  if (!activeTaskId) return null;

  const status = task ? statuses.find((s) => s.category === (task as any).status) : undefined;
  const taskStatusCategory = task ? (task as any).status as string | undefined : undefined;
  const isDone = taskStatusCategory === 'done' || taskStatusCategory === 'closed';

  const handleSave = (field: 'title' | 'description') => {
    if (!task) return;
    if (field === 'title' && editValue.trim()) {
      updateTask.mutate({ id: task.id, title: editValue.trim() });
    } else if (field === 'description') {
      updateTask.mutate({ id: task.id, description: editValue.trim() || null });
    }
    setEditing(null);
  };

  const handleDelete = () => {
    if (!task) return;
    deleteTask.mutate(task.id, { onSuccess: () => setActiveTask(null) });
  };

  const handleAddComment = () => {
    if (!commentText.trim()) return;
    addComment.mutate(commentText.trim(), { onSuccess: () => setCommentText('') });
  };

  const handleToggleDone = () => {
    if (!task || !canEdit) return;
    const next = isDone ? 'todo' : 'done';
    updateTask.mutate({ id: task.id, status: next } as any);
  };

  const addSubtask = (rawTitle: string, keepInputOpen: boolean) => {
    if (!task) return;
    const val = rawTitle.trim();
    if (!val) {
      setNewSubtaskTitle(null);
      return;
    }
    // Optimistic: prepend a temp subtask so it shows instantly
    const tempId = `temp-${Date.now()}`;
    qc.setQueryData(['task', task.id], (prev: any) => {
      if (!prev) return prev;
      const nextSubtasks = [...(prev.subtasks || []), { id: tempId, title: val, status: 'todo', _optimistic: true }];
      return { ...prev, subtasks: nextSubtasks };
    });
    setNewSubtaskTitle(keepInputOpen ? '' : null);
    createTask.mutate(
      { title: val, parent_task_id: task.id, list_id: task.list_id },
      {
        onError: () => {
          // Rollback: strip the temp subtask
          qc.setQueryData(['task', task.id], (prev: any) => {
            if (!prev) return prev;
            return { ...prev, subtasks: (prev.subtasks || []).filter((s: any) => s.id !== tempId) };
          });
        },
      }
    );
  };

  const handleCopyLink = async () => {
    if (!task) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${window.location.pathname}?task=${task.id}`
      );
    } catch { /* noop */ }
  };

  const priorityLabel = task ? PRIORITY_LABEL[(task.priority || 'none') as TaskPriority] : null;
  const assignee = task?.assignees?.[0];
  const due = formatDueRelative(task?.due_date);
  const attachments: AttachmentLike[] = (task?.metadata as TaskMetadata | undefined)?.attachments || [];
  const subtasks = task?.subtasks || [];
  const subtaskDone = subtasks.filter((s: any) => s.status === 'done' || s.status === 'closed').length;

  // Build a simple activity feed from what we know
  const activityItems: { icon: string; body: React.ReactNode; t: string }[] = task ? [
    ...(comments || []).map((c) => ({
      icon: '○',
      body: <><b>{c.user?.display_name || c.user?.email}</b> <span className="text-[color:var(--sh-ink-3)]">commented</span></>,
      t: c.created_at,
    })),
    ...(status ? [{
      icon: '●',
      body: <><span className="text-[color:var(--sh-ink-3)]">status is</span> <b>{status.name}</b></>,
      t: task.updated_at,
    }] : []),
    {
      icon: '○',
      body: <><b>{task.creator?.display_name || task.creator?.email || 'Someone'}</b> <span className="text-[color:var(--sh-ink-3)]">created the task</span></>,
      t: task.created_at,
    },
  ] : [];

  return (
    <div className="fixed inset-0 z-[90]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/10 transition-opacity duration-300"
        style={{ opacity: mounted ? 1 : 0 }}
        onClick={() => setActiveTask(null)}
      />

      {/* Drawer */}
      <aside
        onClick={(e) => e.stopPropagation()}
        className="td-panel absolute top-0 right-0 bottom-0 w-[min(620px,94vw)] flex flex-col border-l"
        style={{
          background: 'var(--surface)',
          borderLeftColor: 'var(--sh-hair)',
          boxShadow: '-24px 0 48px -16px rgba(0,0,0,0.12)',
          transform: mounted ? 'translateX(0)' : 'translateX(102%)',
          transition: 'transform .32s cubic-bezier(0.22, 0.8, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div
          className="td-head flex items-center gap-2.5 px-5 py-3.5 shrink-0 border-b"
          style={{ borderBottomColor: 'var(--sh-hair-3)' }}
        >
          <span className="td-mono text-[11px] tracking-[0.06em] text-[color:var(--sh-ink-4)]">
            SQ-{String(task?.display_number ?? 0).padStart(3, '0')}
          </span>
          {spaceName && (
            <span
              className="text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded"
              style={{
                background: spaceColor || 'var(--sh-ink)',
                color: 'var(--surface)',
                fontFamily: "'Instrument Serif', serif",
                letterSpacing: '0.03em',
              }}
            >
              {spaceName}
            </span>
          )}
          {priorityLabel && (
            <span className="td-mono text-[11px] text-[color:var(--sh-ink-3)]">{priorityLabel}</span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            title="Copy link"
            onClick={handleCopyLink}
            className="td-icon-btn"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
          </button>
          <div className="relative">
            <button
              type="button"
              title="More"
              onClick={() => setMoreMenuOpen((v) => !v)}
              className="td-icon-btn"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="19" cy="12" r="1.5" />
              </svg>
            </button>
            {moreMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMoreMenuOpen(false)} />
                <div
                  className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border bg-white shadow-lg"
                  style={{ borderColor: 'var(--sh-hair)' }}
                >
                  {canEdit && (
                    <button
                      onClick={() => { handleDelete(); setMoreMenuOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[color:var(--sh-hair-3)] text-[color:var(--sh-ink-2)]"
                    >
                      Delete task
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            title="Close"
            onClick={() => setActiveTask(null)}
            className="td-icon-btn"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="td-scroll flex-1 overflow-y-auto px-6 pt-5 pb-20">
          {(!task || isLoading) ? (
            <div className="flex items-center justify-center py-20 text-[color:var(--sh-ink-3)] text-sm">Loading…</div>
          ) : (
            <>
              {/* Title row */}
              <div className="flex items-start gap-3 mb-5">
                <button
                  type="button"
                  onClick={handleToggleDone}
                  disabled={!canEdit}
                  className="mt-[6px] td-checkbox shrink-0"
                  data-done={isDone ? 'true' : 'false'}
                  aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
                />
                {editing === 'title' ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSave('title');
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    onBlur={() => handleSave('title')}
                    className="flex-1 bg-transparent border-b outline-none text-[28px] leading-[1.15] tracking-[-0.01em] text-[color:var(--sh-ink)] py-1"
                    style={{ fontFamily: "'Instrument Serif', serif", fontWeight: 400, borderColor: 'var(--sh-ink)' }}
                  />
                ) : (
                  <h2
                    onClick={canEdit ? () => { setEditing('title'); setEditValue(task.title); } : undefined}
                    className={`flex-1 text-[28px] leading-[1.15] tracking-[-0.01em] text-[color:var(--sh-ink)] m-0 ${canEdit ? 'cursor-text' : ''}`}
                    style={{ fontFamily: "'Instrument Serif', serif", fontWeight: 400 }}
                  >
                    {task.title}
                  </h2>
                )}
              </div>

              {/* Meta grid */}
              <div
                className="td-meta grid grid-cols-1 mb-5 border-t"
                style={{ borderTopColor: 'var(--sh-hair-3)' }}
              >
                <MetaRow k="Assignee">
                  {assignee ? (
                    <>
                      <span className="td-ava-xs" style={{ background: avatarColor(assignee.id || assignee.email) }}>
                        {initialOf(assignee.display_name || assignee.email)}
                      </span>
                      <span>{assignee.display_name || assignee.email}</span>
                    </>
                  ) : (
                    <span className="text-[color:var(--sh-ink-3)]">Unassigned</span>
                  )}
                </MetaRow>

                <MetaRow k="Due">
                  <input
                    type="date"
                    value={task.due_date ? new Date(task.due_date).toISOString().split('T')[0] : ''}
                    onChange={canEdit ? (e) => updateTask.mutate({ id: task.id, due_date: e.target.value || null }) : undefined}
                    disabled={!canEdit}
                    className={`td-mono text-[12px] bg-transparent outline-none ${due.accent && task.due_date ? 'font-semibold text-[color:var(--sh-ink)]' : 'text-[color:var(--sh-ink-2)]'}`}
                  />
                  {task.due_date && (
                    <span className="td-mono text-[11px] text-[color:var(--sh-ink-3)]">· {due.text}</span>
                  )}
                </MetaRow>

                <MetaRow k="Status">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={canEdit ? () => setStatusMenuOpen((v) => !v) : undefined}
                      className="inline-flex items-center gap-2 text-[12.5px] text-[color:var(--sh-ink)] px-1 py-0.5 rounded hover:bg-[color:var(--sh-hair-3)] transition"
                    >
                      <span className="td-dot" style={{ background: status?.color || 'var(--sh-ink-4)' }} />
                      {status?.name || taskStatusCategory || 'No status'}
                    </button>
                    {statusMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setStatusMenuOpen(false)} />
                        <div
                          className="absolute left-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border bg-white shadow-lg"
                          style={{ borderColor: 'var(--sh-hair)' }}
                        >
                          {statuses.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => {
                                updateTask.mutate({ id: task.id, status: s.category } as any);
                                setStatusMenuOpen(false);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-[color:var(--sh-hair-3)]"
                            >
                              <span className="td-dot" style={{ background: s.color }} />
                              {s.name}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </MetaRow>

                {spaceName && (
                  <MetaRow k="Space">
                    <span
                      className="td-space-emblem-xs"
                      style={{ background: spaceColor || 'var(--sh-ink)' }}
                    >
                      {initialOf(spaceName)[0]}
                    </span>
                    <span>{spaceName}</span>
                  </MetaRow>
                )}

                <MetaRow k="Reporter">
                  {task.creator ? (
                    <>
                      <span className="td-ava-xs" style={{ background: avatarColor(task.creator.id || task.creator.email) }}>
                        {initialOf(task.creator.display_name || task.creator.email)}
                      </span>
                      <span>{task.creator.display_name || task.creator.email}</span>
                    </>
                  ) : (
                    <span className="text-[color:var(--sh-ink-3)]">—</span>
                  )}
                </MetaRow>

                <MetaRow k="Estimate">
                  {editingEstimate ? (
                    <input
                      autoFocus
                      value={estimateInput}
                      onChange={(e) => setEstimateInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const mins = parseTimeInput(estimateInput);
                          updateTask.mutate({ id: task.id, time_estimate: mins });
                          setEditingEstimate(false);
                        }
                        if (e.key === 'Escape') setEditingEstimate(false);
                      }}
                      onBlur={() => {
                        const mins = parseTimeInput(estimateInput);
                        updateTask.mutate({ id: task.id, time_estimate: mins });
                        setEditingEstimate(false);
                      }}
                      placeholder="e.g. 2h 30m"
                      className="td-mono text-[12px] bg-transparent border-b outline-none w-28"
                      style={{ borderColor: 'var(--sh-ink)' }}
                    />
                  ) : (
                    <span
                      onClick={canEdit ? () => { setEditingEstimate(true); setEstimateInput(formatMinutes(task.time_estimate)); } : undefined}
                      className={`td-mono text-[12px] text-[color:var(--sh-ink-2)] ${canEdit ? 'cursor-pointer' : ''}`}
                    >
                      {task.time_estimate ? formatMinutes(task.time_estimate) : '—'}
                      {task.time_tracked ? ` · logged ${formatTracked(isTimerForThisTask ? (task.time_tracked + timerElapsed) : task.time_tracked)}` : ''}
                    </span>
                  )}
                </MetaRow>

                {task.tags && task.tags.length > 0 && (
                  <MetaRow k="Labels">
                    <span className="flex flex-wrap gap-1">
                      {task.tags.map((t) => (
                        <span key={t.id} className="td-label">{t.name}</span>
                      ))}
                    </span>
                  </MetaRow>
                )}
              </div>

              {/* Tabs */}
              <div
                className="flex gap-0.5 mb-4 border-b"
                style={{ borderBottomColor: 'var(--sh-hair-3)' }}
              >
                {([
                  { id: 'overview', l: 'Overview' },
                  { id: 'comments', l: `Comments · ${comments?.length ?? 0}` },
                  { id: 'activity', l: 'Activity' },
                  { id: 'files', l: `Files · ${attachments.length}` },
                ] as const).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id as any)}
                    data-active={tab === t.id}
                    className="td-tab px-3.5 py-2.5 text-[12.5px] cursor-pointer transition"
                  >
                    {t.l}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              {tab === 'overview' && (
                <div>
                  {/* Task Type picker — only show if task types exist */}
                  {taskTypes && taskTypes.length > 0 && (
                    <div className="mb-4">
                      <div className="td-h4">Type</div>
                      <div className="relative inline-block">
                        <button
                          type="button"
                          onClick={canEdit ? () => setTypeMenuOpen((v) => !v) : undefined}
                          disabled={!canEdit}
                          className="inline-flex items-center gap-2 text-[13px] text-[color:var(--sh-ink)] px-2 py-1 rounded border"
                          style={{ borderColor: 'var(--sh-hair)' }}
                        >
                          {currentType ? (
                            <>
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: currentType.color }} />
                              {currentType.name}
                            </>
                          ) : (
                            <span className="text-[color:var(--sh-ink-3)]">Select type</span>
                          )}
                        </button>
                        {typeMenuOpen && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setTypeMenuOpen(false)} />
                            <div
                              className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border bg-white shadow-lg"
                              style={{ borderColor: 'var(--sh-hair)' }}
                            >
                              {taskTypes.map((t) => (
                                <button
                                  key={t.id}
                                  onClick={() => {
                                    updateTask.mutate({ id: task.id, task_type_id: t.id });
                                    setTypeMenuOpen(false);
                                  }}
                                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-[color:var(--sh-hair-3)] ${
                                    currentType?.id === t.id ? 'bg-[color:var(--sh-hair-3)]' : ''
                                  }`}
                                >
                                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                                  <span className="flex-1 text-[color:var(--sh-ink)]">{t.name}</span>
                                  {t.is_default && <span className="text-[10px] text-[color:var(--sh-ink-4)]">Default</span>}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Custom fields */}
                  {customFields.length > 0 && (
                    <div className="mb-5">
                      {customFields.map((field) => (
                        <CustomFieldRow
                          key={field.id}
                          field={field}
                          value={customValues[field.key]}
                          onChange={(v) => updateCustomField(field.key, v)}
                          canEdit={canEdit}
                        />
                      ))}
                    </div>
                  )}

                  <div className="td-h4">Description</div>
                  {editing === 'description' ? (
                    <textarea
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => handleSave('description')}
                      onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); }}
                      rows={6}
                      className="td-desc w-full resize-none bg-transparent outline-none rounded border p-2"
                      style={{ borderColor: 'var(--sh-hair)' }}
                    />
                  ) : (
                    <div
                      onClick={canEdit ? () => { setEditing('description'); setEditValue(task.description || ''); } : undefined}
                      className={`td-desc whitespace-pre-wrap ${canEdit ? 'cursor-text' : ''}`}
                    >
                      {task.description || (
                        <span className="text-[color:var(--sh-ink-3)]">{canEdit ? 'Add a description…' : 'No description'}</span>
                      )}
                    </div>
                  )}

                  {/* Subtasks */}
                  <div className="mt-6">
                    <div className="td-h4 flex items-center gap-2">
                      Subtasks
                      {subtasks.length > 0 && (
                        <span className="td-mono text-[11px] text-[color:var(--sh-ink-4)] font-normal normal-case tracking-normal">
                          {subtaskDone} / {subtasks.length}
                        </span>
                      )}
                      {canEdit && newSubtaskTitle === null && (
                        <button
                          onClick={() => setNewSubtaskTitle('')}
                          className="ml-auto text-[11px] text-[color:var(--sh-ink-3)] hover:text-[color:var(--sh-ink)] normal-case tracking-normal"
                        >
                          + Add
                        </button>
                      )}
                    </div>
                    {subtasks.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        {subtasks.map((st: any) => {
                          const stDone = st.status === 'done' || st.status === 'closed';
                          return (
                            <div key={st.id} className="td-sub">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!canEdit) return;
                                  updateTask.mutate({ id: st.id, status: stDone ? 'todo' : 'done' } as any);
                                }}
                                className="td-checkbox shrink-0"
                                data-done={stDone ? 'true' : 'false'}
                                aria-label="Toggle subtask"
                              />
                              <button
                                type="button"
                                onClick={() => setActiveTask(st.id)}
                                className={`flex-1 text-left text-[13px] truncate ${stDone ? 'line-through text-[color:var(--sh-ink-3)]' : 'text-[color:var(--sh-ink)]'}`}
                              >
                                {st.title}
                              </button>
                              {st.due_date && (
                                <span className="td-mono text-[11px] text-[color:var(--sh-ink-4)]">
                                  {new Date(st.due_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {canEdit && newSubtaskTitle !== null && (
                      <input
                        autoFocus
                        value={newSubtaskTitle}
                        onChange={(e) => setNewSubtaskTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addSubtask(newSubtaskTitle, true);
                          } else if (e.key === 'Escape') {
                            e.stopPropagation();
                            setNewSubtaskTitle(null);
                          }
                        }}
                        onBlur={() => addSubtask(newSubtaskTitle, false)}
                        placeholder="Subtask title, Enter to add"
                        className="mt-2 w-full rounded border bg-transparent px-2 py-1 text-[13px] outline-none"
                        style={{ borderColor: 'var(--sh-hair)' }}
                      />
                    )}
                  </div>

                  {/* Checklists */}
                  {(checklists && checklists.length > 0) || (canEdit && newChecklistTitle !== null) ? (
                    <div className="mt-6">
                      <div className="td-h4 flex items-center gap-2">
                        Checklists
                        {canEdit && newChecklistTitle === null && (
                          <button
                            onClick={() => setNewChecklistTitle('')}
                            className="ml-auto text-[11px] text-[color:var(--sh-ink-3)] hover:text-[color:var(--sh-ink)] normal-case tracking-normal"
                          >
                            + Add
                          </button>
                        )}
                      </div>
                      {canEdit && newChecklistTitle !== null && (
                        <input
                          autoFocus
                          value={newChecklistTitle}
                          onChange={(e) => setNewChecklistTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const t = newChecklistTitle.trim();
                              if (t) createChecklist.mutate(t, { onSuccess: () => setNewChecklistTitle(null) });
                              else setNewChecklistTitle(null);
                            } else if (e.key === 'Escape') setNewChecklistTitle(null);
                          }}
                          onBlur={() => {
                            const t = newChecklistTitle.trim();
                            if (t) createChecklist.mutate(t, { onSuccess: () => setNewChecklistTitle(null) });
                            else setNewChecklistTitle(null);
                          }}
                          placeholder="Checklist name, Enter to create"
                          className="mb-2 w-full rounded border bg-transparent px-2 py-1 text-[13px] outline-none"
                          style={{ borderColor: 'var(--sh-hair)' }}
                        />
                      )}
                      <div className="flex flex-col gap-3">
                        {checklists?.map((cl) => {
                          const items = cl.items || [];
                          const done = items.filter((i) => i.is_done).length;
                          return (
                            <div key={cl.id} className="rounded-md border p-3" style={{ borderColor: 'var(--sh-hair-3)' }}>
                              <div className="mb-2 flex items-center justify-between">
                                <div className="flex items-center gap-2 text-[13px] font-medium text-[color:var(--sh-ink)]">
                                  <span>{cl.title}</span>
                                  <span className="td-mono text-[11px] text-[color:var(--sh-ink-4)]">{done}/{items.length}</span>
                                </div>
                                {canEdit && (
                                  <button
                                    onClick={() => { if (confirm(`Delete checklist "${cl.title}"?`)) deleteChecklist.mutate(cl.id); }}
                                    className="text-[color:var(--sh-ink-4)] hover:text-[color:var(--sh-ink)] text-sm"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                              <ul className="flex flex-col gap-1">
                                {items.map((item) => (
                                  <li key={item.id} className="group flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => updateChecklistItem.mutate({ id: item.id, is_done: !item.is_done })}
                                      disabled={!canEdit}
                                      className="td-checkbox shrink-0"
                                      data-done={item.is_done ? 'true' : 'false'}
                                      aria-label="Toggle checklist item"
                                    />
                                    <span className={`flex-1 text-[13px] ${item.is_done ? 'line-through text-[color:var(--sh-ink-3)]' : 'text-[color:var(--sh-ink)]'}`}>
                                      {item.content}
                                    </span>
                                    {canEdit && (
                                      <button
                                        onClick={() => deleteChecklistItem.mutate(item.id)}
                                        className="text-[color:var(--sh-ink-4)] opacity-0 group-hover:opacity-100 hover:text-[color:var(--sh-ink)]"
                                      >
                                        ×
                                      </button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                              {canEdit && (
                                <input
                                  placeholder="+ Add item"
                                  value={newItemDrafts[cl.id] || ''}
                                  onChange={(e) => setNewItemDrafts((prev) => ({ ...prev, [cl.id]: e.target.value }))}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      const val = (newItemDrafts[cl.id] || '').trim();
                                      if (val) {
                                        createChecklistItem.mutate({ checklistId: cl.id, content: val });
                                        setNewItemDrafts((prev) => ({ ...prev, [cl.id]: '' }));
                                      }
                                    }
                                  }}
                                  className="mt-2 w-full bg-transparent px-1 py-0.5 text-[12px] outline-none border-b"
                                  style={{ borderBottomColor: 'transparent' }}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : canEdit ? (
                    <div className="mt-6">
                      <button
                        onClick={() => setNewChecklistTitle('')}
                        className="td-h4 hover:text-[color:var(--sh-ink)]"
                        style={{ cursor: 'pointer' }}
                      >
                        + Add checklist
                      </button>
                    </div>
                  ) : null}
                </div>
              )}

              {tab === 'comments' && (
                <div className="flex flex-col gap-4">
                  {comments && comments.length > 0 ? comments.map((c) => (
                    <div key={c.id} className="td-comment flex gap-3">
                      <span
                        className="td-ava-sm shrink-0"
                        style={{ background: avatarColor(c.user?.id || c.user?.email) }}
                      >
                        {initialOf(c.user?.display_name || c.user?.email)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2.5">
                          <b className="text-[13px] text-[color:var(--sh-ink)]">{c.user?.display_name || c.user?.email}</b>
                          <span className="td-mono text-[11px] text-[color:var(--sh-ink-4)]">
                            {new Date(c.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                          </span>
                        </div>
                        <div className="text-[13px] leading-[1.5] text-[color:var(--sh-ink-2)] mt-1 whitespace-pre-wrap">{c.content}</div>
                      </div>
                    </div>
                  )) : (
                    <div className="text-[13px] text-[color:var(--sh-ink-3)]">No comments yet.</div>
                  )}
                </div>
              )}

              {tab === 'activity' && (
                <div className="flex flex-col gap-3.5">
                  {activityItems.map((a, i) => (
                    <div key={i} className="td-act-item grid items-baseline" style={{ gridTemplateColumns: 'auto 1fr auto', gap: 12 }}>
                      <div className="text-[color:var(--sh-ink-3)] text-[10px] w-3 text-center">{a.icon}</div>
                      <div className="text-[13px] text-[color:var(--sh-ink-2)]">{a.body}</div>
                      <div className="td-mono text-[11px] text-[color:var(--sh-ink-4)]">
                        {new Date(a.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'files' && (
                <div className="flex flex-col gap-0.5">
                  {attachments.length > 0 ? attachments.map((f, i) => {
                    const ext = (f.name || '').split('.').pop()?.toUpperCase() || 'FILE';
                    return (
                      <div
                        key={i}
                        className="td-file flex items-center gap-3 p-2.5 rounded-md border"
                        style={{ borderColor: 'var(--sh-hair-3)', background: 'var(--surface-alt)' }}
                      >
                        <div className="td-doc-icon">{ext}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium text-[color:var(--sh-ink)] truncate">{f.name || 'untitled'}</div>
                          {f.size && <div className="text-[11px] text-[color:var(--sh-ink-3)]">{f.size}</div>}
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="td-mono text-[12px] text-[color:var(--sh-ink-3)] py-4">No files yet.</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {task && (
          <div
            className="td-foot shrink-0 border-t px-5 py-3 flex gap-2 items-center"
            style={{ borderTopColor: 'var(--sh-hair)', background: 'var(--surface)' }}
          >
            <button
              type="button"
              onClick={handleToggleDone}
              disabled={!canEdit}
              className="td-btn"
            >
              {isDone ? 'Reopen' : 'Mark complete'}
            </button>
            {isTimerForThisTask ? (
              <button type="button" onClick={handleStopTimer} className="td-btn">
                Stop timer · {formatSeconds((task.time_tracked || 0) + timerElapsed)}
              </button>
            ) : (
              <button type="button" onClick={handleStartTimer} disabled={!canEdit} className="td-btn">
                Start timer
              </button>
            )}
            <div className="flex-1" />
            {/* Comment quick input on comments tab, otherwise hidden */}
            {tab === 'comments' && (
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
                placeholder="Reply or @mention someone…"
                className="flex-1 rounded-md border bg-transparent px-3 py-1.5 text-[13px] outline-none"
                style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface-alt)' }}
              />
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function MetaRow({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div
      className="td-meta-row grid py-2.5 border-b items-center text-[13px]"
      style={{ gridTemplateColumns: '120px 1fr', borderBottomColor: 'var(--sh-hair-3)' }}
    >
      <span className="td-meta-k td-mono text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--sh-ink-4)] font-medium">
        {k}
      </span>
      <span className="td-meta-v flex items-center gap-2 text-[color:var(--sh-ink)]">
        {children}
      </span>
    </div>
  );
}

function CustomFieldRow({
  field,
  value,
  onChange,
  canEdit,
}: {
  field: TaskTypeField;
  value: unknown;
  onChange: (v: unknown) => void;
  canEdit: boolean;
}) {
  const baseInputCls = `rounded border bg-transparent px-2 py-1 text-[12.5px] outline-none ${canEdit ? '' : 'cursor-default opacity-70'}`;
  const baseStyle: React.CSSProperties = { borderColor: 'var(--sh-hair)' };

  let control: React.ReactNode = null;
  const str = typeof value === 'string' ? value : value == null ? '' : String(value);

  switch (field.field_type) {
    case 'textarea':
      control = (
        <textarea
          defaultValue={str}
          placeholder={field.placeholder || ''}
          disabled={!canEdit}
          onBlur={(e) => e.target.value !== str && onChange(e.target.value || null)}
          rows={2}
          className={`${baseInputCls} w-full resize-none`}
          style={baseStyle}
        />
      );
      break;
    case 'select':
      control = (
        <select
          value={str}
          disabled={!canEdit}
          onChange={(e) => onChange(e.target.value || null)}
          className={baseInputCls}
          style={baseStyle}
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
      break;
    case 'multi_select': {
      const arr: string[] = Array.isArray(value) ? (value as string[]) : [];
      control = (
        <div className="flex flex-wrap gap-1.5">
          {field.options.map((o) => {
            const on = arr.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                disabled={!canEdit}
                onClick={() => {
                  const next = on ? arr.filter((v) => v !== o.value) : [...arr, o.value];
                  onChange(next);
                }}
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  on ? 'bg-[color:var(--sh-ink)] text-[color:var(--surface)]' : 'bg-[color:var(--sh-hair-3)] text-[color:var(--sh-ink-2)]'
                } ${canEdit ? '' : 'cursor-default opacity-70'}`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
      break;
    }
    case 'number':
      control = (
        <input
          type="number"
          defaultValue={str}
          placeholder={field.placeholder || ''}
          disabled={!canEdit}
          onBlur={(e) => {
            const v = e.target.value;
            onChange(v === '' ? null : Number(v));
          }}
          className={baseInputCls}
          style={baseStyle}
        />
      );
      break;
    case 'date':
      control = (
        <input
          type="date"
          value={str}
          disabled={!canEdit}
          onChange={(e) => onChange(e.target.value || null)}
          className={baseInputCls}
          style={baseStyle}
        />
      );
      break;
    case 'url':
      control = (
        <input
          type="url"
          defaultValue={str}
          placeholder={field.placeholder || 'https://'}
          disabled={!canEdit}
          onBlur={(e) => e.target.value !== str && onChange(e.target.value || null)}
          className={`${baseInputCls} min-w-[240px]`}
          style={baseStyle}
        />
      );
      break;
    case 'checkbox':
      control = (
        <input
          type="checkbox"
          checked={!!value}
          disabled={!canEdit}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3.5 w-3.5 cursor-pointer rounded"
        />
      );
      break;
    case 'text':
    default:
      control = (
        <input
          type="text"
          defaultValue={str}
          placeholder={field.placeholder || ''}
          disabled={!canEdit}
          onBlur={(e) => e.target.value !== str && onChange(e.target.value || null)}
          className={`${baseInputCls} min-w-[200px]`}
          style={baseStyle}
        />
      );
  }

  return (
    <div className="td-meta-row grid py-2.5 border-b items-start text-[13px]" style={{ gridTemplateColumns: '120px 1fr', borderBottomColor: 'var(--sh-hair-3)' }}>
      <span className="td-meta-k td-mono text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--sh-ink-4)] font-medium pt-1">
        {field.label}
        {field.is_required && <span className="text-red-500">*</span>}
      </span>
      <div className="min-w-0 flex-1">{control}</div>
    </div>
  );
}
