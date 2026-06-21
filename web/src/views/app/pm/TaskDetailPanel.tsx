import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { usePMStore } from '../../../stores/pmStore';
import { useTask, useUpdateTask, useDeleteTask, useTaskComments, useAddComment, useCreateTask, useUpdateTaskTimeTracked } from '../../../hooks/useTasks';
import { useTimeStats } from '../../../hooks/useTimer';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { useAuthStore } from '../../../stores/authStore';
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
import type { SpaceStatus, TaskType, TaskTypeField, TaskMetadata, TaskPriority, TaskStatusKey } from '@squadhub/shared';
import { getTaskStatusDef } from '@squadhub/shared';
import AssigneePicker from './AssigneePicker';
import MentionPicker from '../../../components/MentionPicker';
import DatePicker from './DatePicker';
import { nextQuickDate } from './taskHelpers';
import EmergencyConfirm from './EmergencyConfirm';
import TaskStatusPicker from './TaskStatusPicker';
import ListPickerCombobox from './ListPickerCombobox';
import TaskAttachments, { type TaskAttachmentsHandle } from './TaskAttachments';
import { useTaskAttachments, useDeleteTaskAttachment } from '../../../hooks/useTaskAttachments';
import { usePanelFileDrop } from './usePanelFileDrop';
import { linkifyText } from '../../../lib/linkify';
import WorkBlockSections from './WorkBlockSections';
import {
  useStartWorkBlockRun,
  useStopWorkBlockRun,
  useActiveWorkBlockRun,
  useRecordWorkBlockCompletion,
  useOpenWorkBlockTaskTime,
  useCloseWorkBlockTaskTime,
} from '../../../hooks/useWorkBlocks';

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

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString([], sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date} · ${time}`;
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
  emergency: 'EMG',
  urgent: 'P0',
  high: 'P1',
  normal: 'P2',
  low: 'P3',
  none: null,
};

const PRIORITY_NAME: Record<TaskPriority, string> = {
  emergency: 'Emergency',
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
  none: 'None',
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
  // Date-only strings ("YYYY-MM-DD") must be parsed as LOCAL dates — otherwise
  // new Date(...) interprets them as UTC midnight and shifts them by the local
  // timezone offset (e.g. in IST they render as 05:30 the same day).
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = dateOnlyMatch
    ? new Date(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]))
    : new Date(iso);
  const isDateOnly = !!dateOnlyMatch;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const delta = Math.round((that - today) / 86_400_000);
  const hasTime = !isDateOnly && !(d.getHours() === 0 && d.getMinutes() === 0);
  const time = hasTime
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
    : '';
  let prefix = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  if (delta === 0) prefix = 'Today';
  else if (delta === 1) prefix = 'Tomorrow';
  else if (delta === -1) prefix = 'Yesterday';
  const text = time ? `${prefix} · ${time}` : prefix;
  return { text, accent: delta <= 0 };
}

export default function TaskDetailPanel({
  statuses,
  listId,
  canEdit = true,
  spaceName,
  spaceColor,
  spaceId,
  folderName,
  listName,
  taskIdOverride,
  isPeek = false,
}: {
  statuses: SpaceStatus[];
  listId: string;
  canEdit?: boolean;
  spaceName?: string;
  spaceColor?: string | null;
  spaceId?: string | null;
  folderName?: string | null;
  listName?: string | null;
  /** When set, this panel renders the given task instead of the global active task.
   *  Used by the side-by-side peek so a second panel can coexist with the main one. */
  taskIdOverride?: string | null;
  /** When true, the panel positions itself on the left, marks itself with
   *  data-peek="true" for CSS, and routes close + subtask-open through the
   *  peek slot rather than the global active slot. */
  isPeek?: boolean;
}) {
  const pmStore = usePMStore();
  const { activeTaskId, timer, startTimer: globalStartTimer, stopTimer: globalStopTimer, toggleFocusToday, isFocusedToday: checkIsFocusedToday } = pmStore;
  // effectiveTaskId — primary uses the global activeTaskId; peek uses the override.
  const effectiveTaskId = taskIdOverride ?? activeTaskId;
  // Close routes: peek closes peekTaskId, primary closes activeTaskId. Opening
  // a subtask from inside a peek opens it into the peek slot (replacing the
  // current peek task) — that matches the user's mental model of "this side
  // is for drilling in without losing the host on the other side."
  const setActiveTask = isPeek ? pmStore.setPeekTask : pmStore.setActiveTask;
  const isFocusedToday = effectiveTaskId ? checkIsFocusedToday(effectiveTaskId) : false;
  const { data: task, isLoading } = useTask(effectiveTaskId);
  const { data: comments } = useTaskComments(effectiveTaskId);
  const { data: taskTypes } = useTaskTypes();
  const { data: checklists } = useChecklists(effectiveTaskId);
  const updateTask = useUpdateTask(listId);

  const attachmentsRef = useRef<TaskAttachmentsHandle>(null);
  const { dragActive: panelDragActive, panelHandlers } = usePanelFileDrop((files) => {
    attachmentsRef.current?.addFiles(files);
  });

  // Track in-flight quick-date values so rapid clicks read the most recent
  // sent value rather than the stale React Query cache.
  const pendingDates = useRef<{ work?: string | null; start?: string | null; due?: string | null }>({});
  useEffect(() => { pendingDates.current.work = undefined; }, [task?.work_date]);
  useEffect(() => { pendingDates.current.start = undefined; }, [task?.start_date]);
  useEffect(() => { pendingDates.current.due = undefined; }, [task?.due_date]);
  const updateTaskTimeTracked = useUpdateTaskTimeTracked(listId);
  const deleteTask = useDeleteTask(listId);
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const currentUser = useAuthStore((s) => s.user);
  const { data: timeStats } = useTimeStats({ workspaceId, context: 'default' });
  const canEditTimeLogs = timeStats?.data?.time_log_edit?.can_edit === true;
  const createTask = useCreateTask(listId);
  const addComment = useAddComment(effectiveTaskId);
  const createChecklist = useCreateChecklist(effectiveTaskId);
  const deleteChecklist = useDeleteChecklist(effectiveTaskId);
  const createChecklistItem = useCreateChecklistItem(effectiveTaskId);
  const updateChecklistItem = useUpdateChecklistItem(effectiveTaskId);
  const deleteChecklistItem = useDeleteChecklistItem(effectiveTaskId);
  const qc = useQueryClient();

  const [editing, setEditing] = useState<'title' | 'description' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentMentions, setCommentMentions] = useState<string[]>([]);
  const [showActivity, setShowActivity] = useState(false);
  const [commentFocus, setCommentFocus] = useState(false);
  const [estimateInput, setEstimateInput] = useState('');
  const [editingEstimate, setEditingEstimate] = useState(false);
  const [loggedHours, setLoggedHours] = useState('');
  const [loggedMinutes, setLoggedMinutes] = useState('');
  const [editingLogged, setEditingLogged] = useState(false);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const [priorityAnchor, setPriorityAnchor] = useState<DOMRect | null>(null);
  const [pendingEmergency, setPendingEmergency] = useState(false);
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [assigneeAnchorRect, setAssigneeAnchorRect] = useState<DOMRect | null>(null);
  const [workDateOpen, setWorkDateOpen] = useState(false);
  const [workDateAnchor, setWorkDateAnchor] = useState<DOMRect | null>(null);
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [startDateAnchor, setStartDateAnchor] = useState<DOMRect | null>(null);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [dueDateAnchor, setDueDateAnchor] = useState<DOMRect | null>(null);
  const [newItemDrafts, setNewItemDrafts] = useState<Record<string, string>>({});
  const [newChecklistTitle, setNewChecklistTitle] = useState<string | null>(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [mainCelebrating, setMainCelebrating] = useState(false);
  const [celebratingSubtaskId, setCelebratingSubtaskId] = useState<string | null>(null);

  useEffect(() => {
    if (!effectiveTaskId) { setMounted(false); return undefined; }
    // Defer one tick so the initial off-screen transform paints before the
    // mounted state flips — keeps the slide-in animation visible.
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, [effectiveTaskId]);

  useEffect(() => {
    if (!effectiveTaskId) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      setActiveTask(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [effectiveTaskId, setActiveTask]);

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

  // /pm/tasks/:id doesn't hydrate the task_type join — resolve via the cached
  // useTaskTypes() list (already loaded for the type picker) so the work-block
  // branch fires when expected.
  const isWorkBlock =
    task?.task_type?.key === 'work_block' ||
    (!!task?.task_type_id && taskTypes?.some((t) => t.id === task.task_type_id && t.key === 'work_block')) ||
    false;
  const startWorkBlockRun = useStartWorkBlockRun();
  const stopWorkBlockRun = useStopWorkBlockRun();
  const activeWorkBlock = useActiveWorkBlockRun();
  const recordCompletion = useRecordWorkBlockCompletion();
  const openTaskTime = useOpenWorkBlockTaskTime();
  const closeTaskTime = useCloseWorkBlockTaskTime();

  // Two independent "is running for this task?" predicates: the per-task
  // timer (regular tasks) and the work-block run (work-block tasks). They
  // never overlap on the *same* task, but a regular task's timer can run
  // alongside a work-block run on a different task — that's the whole point.
  const isTimerForThisTask = !isWorkBlock && timer?.taskId === effectiveTaskId;
  const isWorkBlockRunForThisTask =
    isWorkBlock && activeWorkBlock.data?.task.id === effectiveTaskId && !activeWorkBlock.data?.run.ended_at;
  const isAnyRunningForThisTask = isTimerForThisTask || isWorkBlockRunForThisTask;

  useEffect(() => {
    if (isTimerForThisTask && timer) {
      const tick = () => setTimerElapsed(Math.floor((Date.now() - timer.startedAt) / 1000));
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    }
    if (isWorkBlockRunForThisTask && activeWorkBlock.data) {
      const startMs = new Date(activeWorkBlock.data.run.started_at).getTime();
      const tick = () => setTimerElapsed(Math.floor((Date.now() - startMs) / 1000));
      tick();
      const id = setInterval(tick, 1000);
      return () => clearInterval(id);
    }
    setTimerElapsed(0);
    return undefined;
  }, [isTimerForThisTask, timer, isWorkBlockRunForThisTask, activeWorkBlock.data]);

  const handleStartTimer = async () => {
    if (!task) return;

    // ---- Work-block path: only manage the work-block run, leave the
    // per-task timer alone so the user can still run one on a regular task
    // at the same time.
    if (isWorkBlock) {
      try {
        const run = await startWorkBlockRun.mutateAsync({ task_id: task.id });
        // If a per-task timer is already running on a regular task, log the
        // overlap immediately so the work block shows it from second 0.
        if (timer && timer.taskId !== task.id) {
          openTaskTime.mutate({ run_id: run.id, task_id: timer.taskId });
        }
      } catch (err) { console.error('Failed to start work-block run:', err); }
      return;
    }

    // ---- Regular-task path: existing per-task timer flow + (if a work-
    // block run is active) bracket the overlap with task-time rows.
    const prev = globalStartTimer(task.id, task.title, listId, task.time_tracked || 0);
    const active = activeWorkBlock.data;
    if (prev) {
      const elapsedSecs = Math.floor((Date.now() - prev.startedAt) / 1000);
      // Close the prev task's overlap row first — any new row for the same
      // (run, task) would otherwise hit the partial unique index.
      if (active && prev.taskId !== task.id) {
        closeTaskTime.mutate({ run_id: active.run.id, task_id: prev.taskId });
      }
      if (elapsedSecs >= 1) {
        try {
          await api.post(`/pm/tasks/${prev.taskId}/time-entries`, {
            started_at: new Date(prev.startedAt).toISOString(),
            duration_seconds: elapsedSecs,
          });
          qc.invalidateQueries({ queryKey: ['task-time-entries'] });
          qc.invalidateQueries({ queryKey: ['tasks', prev.listId] });
          qc.invalidateQueries({ queryKey: ['task', prev.taskId] });
        } catch (err) {
          console.error('Failed to save previous timer:', err);
        }
      }
    }
    if (active) {
      openTaskTime.mutate({ run_id: active.run.id, task_id: task.id });
    }
  };

  const handleStopTimer = async () => {
    if (!task) return;

    // ---- Work-block path: close the run; the server auto-closes any
    // open task-time rows so we don't have to enumerate them client-side.
    if (isWorkBlock) {
      const active = activeWorkBlock.data;
      if (active && active.task.id === task.id) {
        try { await stopWorkBlockRun.mutateAsync({ run_id: active.run.id, task_id: task.id }); }
        catch (err) { console.error('Failed to stop work-block run:', err); }
      }
      return;
    }

    // ---- Regular-task path: existing per-task time entry + close the
    // corresponding overlap row if a work-block run is active.
    const stopped = globalStopTimer();
    if (!stopped) return;
    const active = activeWorkBlock.data;
    if (active) {
      closeTaskTime.mutate({ run_id: active.run.id, task_id: stopped.taskId });
    }
    const elapsedSecs = Math.floor((Date.now() - stopped.startedAt) / 1000);
    if (elapsedSecs < 1) return;
    try {
      await api.post(`/pm/tasks/${stopped.taskId}/time-entries`, {
        started_at: new Date(stopped.startedAt).toISOString(),
        duration_seconds: elapsedSecs,
      });
      qc.invalidateQueries({ queryKey: ['task-time-entries'] });
      qc.invalidateQueries({ queryKey: ['tasks', stopped.listId] });
      qc.invalidateQueries({ queryKey: ['task', stopped.taskId] });
    } catch (err) {
      console.error('Failed to save tracked time:', err);
    }
  };

  if (!effectiveTaskId) return null;

  const taskStatusCategory = task ? (task as any).status as string | undefined : undefined;
  const catalogDef = getTaskStatusDef(taskStatusCategory);
  const isTaskType = currentType?.key === 'task';
  const status = task
    ? isTaskType
      ? (catalogDef
          ? ({ color: catalogDef.color, name: catalogDef.label } as Pick<SpaceStatus, 'color' | 'name'> as SpaceStatus)
          : undefined)
      : statuses.find((s) => s.name === taskStatusCategory) || statuses.find((s) => s.category === taskStatusCategory)
    : undefined;
  const matchedStatus = !isTaskType ? (statuses.find((s) => s.name === taskStatusCategory) || statuses.find((s) => s.category === taskStatusCategory)) : null;
  const isDone = catalogDef?.category === 'closed' || taskStatusCategory === 'done' || taskStatusCategory === 'closed' || matchedStatus?.category === 'done' || matchedStatus?.category === 'closed';

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
    addComment.mutate(
      { content: commentText.trim(), mentions: commentMentions },
      { onSuccess: () => { setCommentText(''); setCommentMentions([]); } },
    );
  };

  const handleToggleDone = () => {
    if (!task || !canEdit) return;
    const next = isDone ? 'todo' : 'done';
    if (!isDone) {
      setMainCelebrating(true);
      setTimeout(() => setMainCelebrating(false), 650);
      // If a work-block run is active and this isn't the work block itself,
      // log this completion against the active run. Idempotent server-side.
      const active = activeWorkBlock.data;
      if (active && active.task.id !== task.id) {
        recordCompletion.mutate({ run_id: active.run.id, completed_task_id: task.id });
      }
    }
    updateTask.mutate({ id: task.id, status: next } as any);
  };

  const addSubtask = (rawTitle: string, keepInputOpen: boolean) => {
    if (!task) return;
    const val = rawTitle.trim();
    if (!val) {
      setNewSubtaskTitle(null);
      return;
    }
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
  const assignees = task?.assignees || [];
  const due = formatDueRelative(task?.due_date);
  const { data: attachmentsData = [], refetch: refetchAttachments } = useTaskAttachments(task?.id || null);
  const audioAttachments = attachmentsData.filter((a) => a.mime_type?.startsWith('audio/'));
  const nonAudioAttachments = attachmentsData.filter((a) => !a.mime_type?.startsWith('audio/'));
  const attachmentCount = nonAudioAttachments.length;
  const subtasks = task?.subtasks || [];
  const subtaskDone = subtasks.filter((s: any) => s.status === 'done' || s.status === 'closed').length;

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
      {/* Backdrop — no blur, subtle dark tint only */}
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: mounted ? 1 : 0,
          background: 'rgba(10,10,10,0.18)',
        }}
        onClick={() => setActiveTask(null)}
      />

      {/* Floating drawer */}
      <aside
        onClick={(e) => e.stopPropagation()}
        {...(canEdit && task ? panelHandlers : {})}
        className="td-panel td-panel-luma apple td-shell absolute flex flex-col"
        data-peek={isPeek ? 'true' : undefined}
        style={{
          background: 'var(--surface)',
          // Peek slides in from the LEFT; primary slides in from the right.
          transform: mounted
            ? 'translateX(0)'
            : isPeek ? 'translateX(calc(-100% - 24px))' : 'translateX(calc(100% + 24px))',
          transition: 'transform .42s cubic-bezier(0.23, 1, 0.32, 1), opacity .3s ease',
          opacity: mounted ? 1 : 0,
        }}
      >
        {panelDragActive && canEdit && task && (
          <div
            aria-hidden
            className="absolute inset-0 z-[100] pointer-events-none flex items-center justify-center"
            style={{
              background: 'rgba(255,255,255,0.88)',
              border: '2px dashed var(--sh-ink-3)',
              borderRadius: 'inherit',
            }}
          >
            <div className="text-[14px] font-medium text-[color:var(--sh-ink)]">
              Drop files to attach
            </div>
          </div>
        )}
        {/* Top bar — task code chip + breadcrumb + actions */}
        <div className="td-head td-head-luma flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTask(null)}
            className="td-nav-btn"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
            </svg>
          </button>
          {spaceName && (
            workspaceId && canEdit ? (
              <ListPickerCombobox
                workspaceId={workspaceId}
                selectedListId={listId}
                selectedListName={listName ?? null}
                initialSpaceId={spaceId ?? null}
                onChange={(newListId) => {
                  if (task && newListId !== listId) {
                    updateTask.mutate({ id: task.id, list_id: newListId });
                  }
                }}
                renderTrigger={({ toggle }) => (
                  <button
                    type="button"
                    onClick={toggle}
                    className="td-bcrumb td-focus"
                    title="Move to another list"
                  >
                    <span className="emblem" style={{ background: spaceColor || 'var(--sh-ink)' }}>
                      {initialOf(spaceName)[0]}
                    </span>
                    <span className="name">{spaceName}</span>
                    {folderName && (
                      <>
                        <span className="sep">›</span>
                        <span className="name">{folderName}</span>
                      </>
                    )}
                    {listName && (
                      <>
                        <span className="sep">›</span>
                        <span className="name">{listName}</span>
                      </>
                    )}
                    <svg className="chev" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              />
            ) : (
              <span className="td-bcrumb">
                <span className="emblem" style={{ background: spaceColor || 'var(--sh-ink)' }}>
                  {initialOf(spaceName)[0]}
                </span>
                <span className="name">{spaceName}</span>
                {folderName && (
                  <>
                    <span className="sep">›</span>
                    <span className="name">{folderName}</span>
                  </>
                )}
                {listName && (
                  <>
                    <span className="sep">›</span>
                    <span className="name">{listName}</span>
                  </>
                )}
              </span>
            )
          )}
          <div className="flex-1" />
          {task && (
            <button
              type="button"
              onClick={() => toggleFocusToday(task.id)}
              className="td-nav-btn td-focus-star"
              data-active={isFocusedToday}
              title={isFocusedToday ? 'Focused for today — click to remove' : 'Focus today'}
              aria-label={isFocusedToday ? 'Focused for today' : 'Focus today'}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>{isFocusedToday ? '★' : '☆'}</span>
            </button>
          )}
          <button type="button" onClick={handleCopyLink} className="td-nav-btn" title="Copy link">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
          </button>
          <div className="relative">
            <button type="button" onClick={() => setMoreMenuOpen((v) => !v)} className="td-nav-btn" title="More">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="19" cy="12" r="1.5" />
              </svg>
            </button>
            {moreMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMoreMenuOpen(false)} />
                <div
                  className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border shadow-lg"
                  style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface)' }}
                >
                  {canEdit && (
                    <button
                      onClick={() => { handleDelete(); setMoreMenuOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[color:var(--sh-hair-3)]"
                      style={{ color: 'oklch(0.55 0.18 25)' }}
                    >
                      Delete task
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          {task && canEdit && (
            isAnyRunningForThisTask ? (
              <button type="button" onClick={handleStopTimer} className="td-pill-btn" title="Stop timer">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
                {/* Work-block pill shows current run elapsed; regular task pill
                    shows total tracked + this session's elapsed (legacy display). */}
                {formatSeconds(isWorkBlockRunForThisTask ? timerElapsed : (task.time_tracked || 0) + timerElapsed)}
              </button>
            ) : (
              <button type="button" onClick={handleStartTimer} className="td-pill-btn" title="Start timer">
                <svg className="accent-icon" width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Start timer
              </button>
            )
          )}
          {task && (
            <button
              type="button"
              onClick={handleToggleDone}
              disabled={!canEdit}
              className="td-pill-btn"
              data-accent={!isDone ? 'true' : undefined}
              data-completed={isDone ? 'true' : undefined}
              title={isDone ? 'Reopen task' : 'Mark complete'}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M5 12l5 5 9-11" />
              </svg>
              {isDone ? 'Completed' : 'Complete'}
            </button>
          )}
        </div>

        {/* Scrollable body */}
        <div className="td-scroll flex-1 overflow-y-auto px-6 pt-3 pb-8">
          {(!task || isLoading) ? (
            <div className="flex items-center justify-center py-20 text-[color:var(--sh-ink-3)] text-sm">Loading…</div>
          ) : (
            <>
              {/* Parent task reference — when this task is a subtask, show a
                  clickable chip that opens the parent. */}
              {task.parent_task && (
                <button
                  type="button"
                  className="td-parent-ref"
                  onClick={() => setActiveTask(task.parent_task!.id)}
                  title={`Open parent task: ${task.parent_task.title}`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 14L4 9l5-5" />
                    <path d="M4 9h11a5 5 0 015 5v6" />
                  </svg>
                  <span className="td-parent-ref-label">Parent</span>
                  <span className="td-parent-ref-title">{task.parent_task.title}</span>
                </button>
              )}

              {/* Title row */}
              <div className="flex items-start gap-3" style={{ marginBottom: 14 }}>
                <button
                  type="button"
                  onClick={handleToggleDone}
                  disabled={!canEdit}
                  className="mt-[6px] td-checkbox-lg shrink-0 td-focus"
                  data-done={(isDone || mainCelebrating) ? 'true' : 'false'}
                  data-celebrating={mainCelebrating ? 'true' : 'false'}
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
                    className="td-title-hero flex-1 bg-transparent border-b outline-none m-0"
                    style={{ borderColor: 'var(--sh-accent)' }}
                  />
                ) : (
                  <h1
                    onClick={canEdit ? () => { setEditing('title'); setEditValue(task.title); } : undefined}
                    className={`td-title-hero flex-1 m-0 ${canEdit ? 'cursor-text' : ''} ${isDone ? 'line-through opacity-60' : ''}`}
                  >
                    {task.title}
                  </h1>
                )}
              </div>

              {/* Description — boxed right under title */}
              <div
                className="td-desc-box"
                onClick={canEdit && editing !== 'description' ? () => { setEditing('description'); setEditValue(task.description || ''); } : undefined}
              >
                <span className="td-desc-box-label">Description</span>
                {editing === 'description' ? (
                  <textarea
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => handleSave('description')}
                    onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); }}
                    rows={6}
                    className="td-about w-full resize-none bg-transparent outline-none"
                  />
                ) : (
                  <div className={`td-about ${!task.description ? 'empty' : ''} ${canEdit ? 'cursor-text' : ''}`}>
                    {task.description ? linkifyText(task.description) : 'Click to add a description…'}
                  </div>
                )}
              </div>

              {currentType?.key === 'design_task' && customFields.length > 0 && (
                <>
                  <div className="td-eyebrow">{currentType?.name || 'Brief'}</div>
                  <div className="td-settings-card" style={{ marginBottom: 12 }}>
                    {customFields.map((field) => (
                      <CustomFieldRow
                        key={field.id}
                        field={field}
                        value={customValues[field.key]}
                        onChange={(v) => updateCustomField(field.key, v)}
                        otherValue={customValues[field.key + '_other']}
                        onOtherChange={(v) => updateCustomField(field.key + '_other', v)}
                        canEdit={canEdit}
                      />
                    ))}
                  </div>

                </>
              )}

              {/* Assignee bar — full-width row */}
              <div
                className="td-assignee-bar td-focus w-full text-left"
                role={canEdit ? 'button' : undefined}
                tabIndex={canEdit ? 0 : undefined}
                onClick={canEdit ? (e) => {
                  setAssigneeAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect());
                  setAssigneePickerOpen(v => !v);
                } : undefined}
                style={canEdit ? undefined : { cursor: 'default' }}
              >
                <span className="label">Assignee</span>
                <span className="value">
                  {assignees.length > 0 ? (
                    <>
                      <span className="av-stack">
                        {assignees.slice(0, 3).map((u) => (
                          <span
                            key={u.id}
                            className="td-ava-xs"
                            style={{ background: avatarColor(u.id || u.email), width: 28, height: 28, fontSize: 11 }}
                            title={u.display_name || u.email}
                          >
                            {initialOf(u.display_name || u.email)}
                          </span>
                        ))}
                        {assignees.length > 3 && (
                          <span className="av-more" aria-label={`${assignees.length - 3} more`}>+{assignees.length - 3}</span>
                        )}
                      </span>
                      <span className="name">
                        {assignees.length === 1
                          ? (assignees[0].display_name || assignees[0].email)
                          : `${assignees.length} assignees`}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="av-placeholder" aria-hidden />
                      <span className="name muted">Unassigned</span>
                    </>
                  )}
                </span>
                {canEdit && (
                  assignees.length > 0 ? (
                    <button
                      type="button"
                      className="reassign"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAssigneeAnchorRect((e.currentTarget.parentElement as HTMLElement).getBoundingClientRect());
                        setAssigneePickerOpen(v => !v);
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="8" r="4" />
                        <path d="M4 21a8 8 0 0116 0" />
                      </svg>
                      Reassign
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="reassign"
                      disabled={!currentUser?.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!task || !currentUser?.id) return;
                        updateTask.mutate({ id: task.id, assignee_ids: [currentUser.id] });
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="8" r="4" />
                        <path d="M4 21a8 8 0 0116 0" />
                      </svg>
                      Assign to me
                    </button>
                  )
                )}
              </div>

              {/* Details — 2-column property grid (with head bar) */}
              <div className="td-settings-card">
                <div className="td-details-head">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                  <span className="label">Details</span>
                </div>
                <div className="td-settings-card" data-twocol="true" style={{ border: 'none', borderRadius: 0, marginBottom: 0 }}>
                {/* Status */}
                <div
                  className="td-settings-row"
                  data-half="true"
                  style={{ cursor: canEdit ? 'pointer' : 'default' }}
                  onClick={undefined}
                >
                  <span className="k">{META_ICONS.Status}Status</span>
                  <span className="v">
                    {isTaskType && canEdit ? (
                      <TaskStatusPicker
                        value={taskStatusCategory || null}
                        onChange={(key: TaskStatusKey) => {
                          updateTask.mutate({ id: task.id, status: key } as any);
                        }}
                      />
                    ) : (
                      <SpaceStatusPicker
                        statuses={statuses}
                        current={status ?? null}
                        taskStatusCategory={taskStatusCategory}
                        canEdit={canEdit}
                        onPick={(s) => {
                          updateTask.mutate({ id: task.id, status: s.name } as any);
                        }}
                      />
                    )}
                  </span>
                </div>

                {/* Priority */}
                <div
                  className="td-settings-row"
                  data-half="true"
                  style={{ cursor: canEdit ? 'pointer' : 'default' }}
                  onClick={canEdit ? (e) => {
                    setPriorityAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
                    setPriorityMenuOpen((v) => !v);
                  } : undefined}
                >
                  <span className="k">{META_ICONS.Priority}Priority</span>
                  <span className="v">
                    {task.priority === 'emergency' ? (
                      <span className="td-pri-chip" data-level="emg">
                        <span className="dot" />
                        EMERGENCY
                      </span>
                    ) : task.priority && task.priority !== 'none' ? (
                      <span className="td-prop-chip" style={{
                        background: 'var(--surface-alt)',
                        color: 'var(--sh-ink-2)',
                        border: '1px solid var(--sh-hair-3)',
                      }}>
                        {PRIORITY_NAME[task.priority as TaskPriority]}
                      </span>
                    ) : (
                      <span className="td-prop-empty">None</span>
                    )}
                  </span>
                </div>

                {/* Work date */}
                <div
                  className="td-settings-row td-date-row"
                  data-half="true"
                  style={{ cursor: canEdit ? 'pointer' : 'default' }}
                  onClick={canEdit ? (e) => {
                    setWorkDateAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
                    setWorkDateOpen(v => !v);
                  } : undefined}
                >
                  <span className="k">{META_ICONS.WorkDate}Work date</span>
                  <span className="v">
                    <span className="td-date-text">
                      {task.work_date ? (
                        formatDueRelative(task.work_date).text
                      ) : (
                        <span className="td-prop-empty">Set work date</span>
                      )}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        className="td-date-today-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          const cur = pendingDates.current.work !== undefined ? pendingDates.current.work : task.work_date;
                          const next = nextQuickDate(cur);
                          pendingDates.current.work = next;
                          updateTask.mutate({ id: task.id, work_date: next } as any);
                        }}
                        aria-label="Set work date to today / tomorrow"
                        title="Click: today · Click again: tomorrow"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                      </button>
                    )}
                  </span>
                </div>

                {/* Start date */}
                <div
                  className="td-settings-row td-date-row"
                  data-half="true"
                  style={{ cursor: canEdit ? 'pointer' : 'default' }}
                  onClick={canEdit ? (e) => {
                    setStartDateAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
                    setStartDateOpen(v => !v);
                  } : undefined}
                >
                  <span className="k">{META_ICONS.StartDate}Start date</span>
                  <span className="v">
                    <span className="td-date-text">
                      {task.start_date ? (
                        formatDueRelative(task.start_date).text
                      ) : (
                        <span className="td-prop-empty">Set start date</span>
                      )}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        className="td-date-today-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          const cur = pendingDates.current.start !== undefined ? pendingDates.current.start : task.start_date;
                          const next = nextQuickDate(cur);
                          pendingDates.current.start = next;
                          updateTask.mutate({ id: task.id, start_date: next } as any);
                        }}
                        aria-label="Set start date to today / tomorrow"
                        title="Click: today · Click again: tomorrow"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                      </button>
                    )}
                  </span>
                </div>

                {/* Due date */}
                <div
                  className="td-settings-row td-date-row"
                  data-half="true"
                  style={{ cursor: canEdit ? 'pointer' : 'default' }}
                  onClick={canEdit ? (e) => {
                    setDueDateAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
                    setDueDateOpen(v => !v);
                  } : undefined}
                >
                  <span className="k">{META_ICONS.Due}Due date</span>
                  <span className="v">
                    <span className="td-date-text">
                      {task.due_date ? (
                        <span style={{ color: due.accent ? 'oklch(0.55 0.18 25)' : 'var(--sh-ink)' }}>
                          {due.text}{due.accent ? ' · Overdue' : ''}
                        </span>
                      ) : (
                        <span className="td-prop-empty">Set due date</span>
                      )}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        className="td-date-today-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          const cur = pendingDates.current.due !== undefined ? pendingDates.current.due : task.due_date;
                          const next = nextQuickDate(cur);
                          pendingDates.current.due = next;
                          updateTask.mutate({ id: task.id, due_date: next } as any);
                        }}
                        aria-label="Set due date to today / tomorrow"
                        title="Click: today · Click again: tomorrow"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                      </button>
                    )}
                  </span>
                </div>

                {/* Estimate */}
                <div
                  className="td-settings-row"
                  data-half="true"
                  style={{ cursor: canEdit ? 'pointer' : 'default' }}
                  onClick={canEdit && !editingEstimate ? () => { setEditingEstimate(true); setEstimateInput(formatMinutes(task.time_estimate)); } : undefined}
                >
                  <span className="k">{META_ICONS.Estimate}Estimate</span>
                  <span className="v">
                    {editingEstimate ? (
                      <input
                        autoFocus
                        value={estimateInput}
                        onChange={(e) => setEstimateInput(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
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
                        className="text-[12.5px] bg-transparent border-b outline-none w-28"
                        style={{ borderColor: 'var(--sh-ink)' }}
                      />
                    ) : task.time_estimate ? (
                      <span>{formatMinutes(task.time_estimate)}</span>
                    ) : (
                      <span className="td-prop-empty">Add estimate</span>
                    )}
                  </span>
                </div>

                {/* Labels */}
                <div className="td-settings-row" data-half="true">
                  <span className="k">{META_ICONS.Labels}Labels</span>
                  <span className="v" style={{ flexWrap: 'wrap', gap: 6 }}>
                    {task.tags && task.tags.length > 0 ? (
                      task.tags.map((t) => (
                        <span key={t.id} className="td-hashtag">#{t.name}</span>
                      ))
                    ) : (
                      <span className="td-prop-empty">+ Add label</span>
                    )}
                  </span>
                </div>

                {/* Time logged */}
                <div
                  className="td-settings-row"
                  data-half="true"
                  style={{ cursor: canEditTimeLogs && !editingLogged && !isTimerForThisTask ? 'pointer' : 'default' }}
                  onClick={canEditTimeLogs && !editingLogged && !isTimerForThisTask ? () => {
                    const total = task.time_tracked || 0;
                    setLoggedHours(String(Math.floor(total / 3600)));
                    setLoggedMinutes(String(Math.floor((total % 3600) / 60)));
                    setEditingLogged(true);
                  } : undefined}
                >
                  <span className="k">{META_ICONS.Estimate}Time logged</span>
                  <span className="v">
                    {editingLogged ? (
                      (() => {
                        const commit = () => {
                          const h = Math.max(0, Math.min(999, parseInt(loggedHours || '0', 10) || 0));
                          const m = Math.max(0, Math.min(59, parseInt(loggedMinutes || '0', 10) || 0));
                          const seconds = h * 3600 + m * 60;
                          updateTaskTimeTracked.mutate({ id: task.id, time_tracked: seconds });
                          setEditingLogged(false);
                        };
                        return (
                          <span
                            className="inline-flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => {
                              if (!e.currentTarget.contains(e.relatedTarget as Node)) commit();
                            }}
                          >
                            <input
                              autoFocus
                              type="number"
                              min={0}
                              max={999}
                              value={loggedHours}
                              onChange={(e) => setLoggedHours(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commit();
                                if (e.key === 'Escape') setEditingLogged(false);
                              }}
                              placeholder="0"
                              className="w-10 text-[12.5px] text-right bg-transparent border-b outline-none tabular-nums"
                              style={{ borderColor: 'var(--sh-ink)' }}
                            />
                            <span className="text-[11px] text-[var(--sh-ink-3)]">h</span>
                            <input
                              type="number"
                              min={0}
                              max={59}
                              value={loggedMinutes}
                              onChange={(e) => setLoggedMinutes(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commit();
                                if (e.key === 'Escape') setEditingLogged(false);
                              }}
                              placeholder="0"
                              className="w-10 text-[12.5px] text-right bg-transparent border-b outline-none tabular-nums"
                              style={{ borderColor: 'var(--sh-ink)' }}
                            />
                            <span className="text-[11px] text-[var(--sh-ink-3)]">m</span>
                          </span>
                        );
                      })()
                    ) : (task.time_tracked || isTimerForThisTask) ? (
                      <span>
                        {formatTracked(isTimerForThisTask ? ((task.time_tracked || 0) + timerElapsed) : task.time_tracked) || '0m'}
                      </span>
                    ) : (
                      <span className="td-prop-empty">0h logged</span>
                    )}
                  </span>
                </div>

                {/* Created by — full width */}
                <div className="td-settings-row" data-half="true" style={{ gridColumn: '1 / -1', borderRight: 'none', borderBottom: 'none' }}>
                  <span className="k">{META_ICONS.Reporter}Created by</span>
                  <span className="v">
                    {task.creator ? (
                      <>
                        <span className="td-ava-xs" style={{ background: avatarColor(task.creator.id || task.creator.email) }}>
                          {initialOf(task.creator.display_name || task.creator.email)}
                        </span>
                        <span>{task.creator.display_name || task.creator.email}</span>
                        {task.created_at && (
                          <span className="muted"> · {formatCreatedAt(task.created_at)}</span>
                        )}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </span>
                </div>
                </div>
              </div>

              {/* Custom fields for non-design_task types — render before sections */}
              {currentType?.key !== 'design_task' && customFields.length > 0 && (
                <div className="mb-2 mt-3">
                  {customFields.map((field) => (
                    <CustomFieldRow
                      key={field.id}
                      field={field}
                      value={customValues[field.key]}
                      onChange={(v) => updateCustomField(field.key, v)}
                      otherValue={customValues[field.key + '_other']}
                      onOtherChange={(v) => updateCustomField(field.key + '_other', v)}
                      canEdit={canEdit}
                    />
                  ))}
                </div>
              )}

              <div className="td-section-rule" />

              {/* Subtasks — prominent */}
              <div className="td-section-strong">
                <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="7" height="16" rx="1.5" />
                  <rect x="14" y="4" width="7" height="10" rx="1.5" />
                </svg>
                <span className="title">Subtasks</span>
                {subtasks.length > 0 && (
                  <span className="td-section-count-strong">{subtaskDone}/{subtasks.length}</span>
                )}
                {canEdit && (
                  <button
                    type="button"
                    className="td-section-add-strong"
                    onClick={() => setNewSubtaskTitle(newSubtaskTitle === null ? '' : newSubtaskTitle)}
                    disabled={newSubtaskTitle !== null}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Add subtask
                  </button>
                )}
              </div>
              {(subtasks.length > 0 || canEdit) && (
                <div className="td-subtask-list">
                  {subtasks.map((st: any) => {
                    const stDone = st.status === 'done' || st.status === 'closed';
                    const stPerson = st.assignees?.[0];
                    return (
                      <button
                        key={st.id}
                        type="button"
                        className="td-subtask-row"
                        data-done={stDone ? 'true' : 'false'}
                        onClick={() => setActiveTask(st.id)}
                      >
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!canEdit) return;
                            if (!stDone) {
                              setCelebratingSubtaskId(st.id);
                              setTimeout(() => {
                                setCelebratingSubtaskId((curr) => (curr === st.id ? null : curr));
                              }, 650);
                            }
                            updateTask.mutate({ id: st.id, status: stDone ? 'todo' : 'done' } as any);
                          }}
                          className="td-checkbox shrink-0"
                          data-done={(stDone || celebratingSubtaskId === st.id) ? 'true' : 'false'}
                          data-celebrating={celebratingSubtaskId === st.id ? 'true' : 'false'}
                          aria-label="Toggle subtask"
                        />
                        <span className="title">{st.title}</span>
                        {st.display_number != null && (
                          <span className="td-subtask-code">SQ-{String(st.display_number).padStart(3, '0')}</span>
                        )}
                        <span className="td-subtask-mini">
                          {st.due_date ? (
                            <span>{new Date(st.due_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                          ) : (
                            <span style={{ color: 'var(--sh-ink-4)' }}>—</span>
                          )}
                        </span>
                        {stPerson ? (
                          <span
                            className="td-ava-xs"
                            style={{ background: avatarColor(stPerson.id || stPerson.email), width: 18, height: 18, fontSize: 9 }}
                            title={stPerson.display_name || stPerson.email}
                          >
                            {initialOf(stPerson.display_name || stPerson.email)}
                          </span>
                        ) : (
                          <span className="td-ava-xs" style={{ background: 'var(--surface-alt)', border: '1px dashed var(--sh-hair-2)', width: 18, height: 18 }} aria-hidden />
                        )}
                      </button>
                    );
                  })}
                  {canEdit && newSubtaskTitle !== null ? (
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
                      className="w-full bg-transparent px-3.5 py-2.5 text-[13.5px] outline-none"
                      style={{ borderTop: '1px solid var(--sh-hair-3)' }}
                    />
                  ) : canEdit ? (
                    <button
                      type="button"
                      className="td-subtask-add-row"
                      onClick={() => setNewSubtaskTitle('')}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      <span>New subtask</span>
                      <span className="kbd">⌘ ↵</span>
                    </button>
                  ) : null}
                </div>
              )}

              <div className="td-section-rule" />

              {/* Checklist — secondary */}
              <div className="td-eyebrow" style={{ margin: '0 0 8px' }}>
                Checklist
                {checklists && checklists.length > 0 && (() => {
                  const allItems = checklists.flatMap((c) => c.items || []);
                  const done = allItems.filter((i) => i.is_done).length;
                  return <span className="muted">· {done}/{allItems.length}</span>;
                })()}
                {canEdit && newChecklistTitle === null && (
                  <button className="action" onClick={() => setNewChecklistTitle('')}>+ New list</button>
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
                  className="mb-2 w-full rounded-lg border bg-transparent px-3 py-1.5 text-[13px] outline-none"
                  style={{ borderColor: 'var(--sh-hair)' }}
                />
              )}
              {checklists && checklists.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {checklists.map((cl) => {
                    const items = cl.items || [];
                    const done = items.filter((i) => i.is_done).length;
                    const pct = items.length ? (done / items.length) * 100 : 0;
                    return (
                      <div key={cl.id}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[12.5px] font-semibold text-[color:var(--sh-ink-2)] flex-1">{cl.title}</span>
                          <span className="rounded h-[3px] overflow-hidden" style={{ width: 50, background: 'var(--surface-alt)' }}>
                            <span className="block h-full transition-all" style={{ width: `${pct}%`, background: 'var(--td-accent)' }} />
                          </span>
                          <span className="td-mono text-[10.5px] font-semibold text-[color:var(--sh-ink-4)]">{done}/{items.length}</span>
                          {canEdit && (
                            <button
                              onClick={() => { if (confirm(`Delete checklist "${cl.title}"?`)) deleteChecklist.mutate(cl.id); }}
                              className="text-[color:var(--sh-ink-4)] hover:text-[color:var(--sh-ink)] text-sm leading-none"
                              title="Delete checklist"
                            >
                              ×
                            </button>
                          )}
                        </div>
                        <ul className="flex flex-col">
                          {items.map((item) => (
                            <li key={item.id} className="group flex items-center gap-2.5 py-1">
                              <button
                                type="button"
                                onClick={() => updateChecklistItem.mutate({ id: item.id, is_done: !item.is_done })}
                                disabled={!canEdit}
                                className="td-checkbox shrink-0"
                                data-done={item.is_done ? 'true' : 'false'}
                                aria-label="Toggle item"
                                style={{ width: 14, height: 14 }}
                              />
                              <span className={`flex-1 text-[12.5px] ${item.is_done ? 'line-through text-[color:var(--sh-ink-4)]' : 'text-[color:var(--sh-ink-2)]'}`}>
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
                            className="mt-1 w-full bg-transparent px-0 py-0.5 text-[12px] outline-none placeholder:text-[color:var(--sh-ink-4)]"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : !newChecklistTitle ? (
                <div className="text-[12.5px] text-[color:var(--sh-ink-4)]">No checklists.</div>
              ) : null}

              {isWorkBlock && task && (
                <>
                  <div className="td-section-rule" />
                  <WorkBlockSections task={task} canEdit={!!canEdit} />
                </>
              )}

              <div className="td-section-rule" />

              {/* Files */}
              <div className="td-eyebrow" style={{ margin: '0 0 8px' }}>
                Files
                {attachmentCount > 0 && <span className="muted">· {attachmentCount}</span>}
              </div>
              {task && (
                <div className="td-files-wrap">
                  <TaskAttachments ref={attachmentsRef} taskId={task.id} canEdit={canEdit} excludeAudio />
                </div>
              )}

              <div className="td-section-rule" />

              {/* Comments — always visible */}
              <div className="td-eyebrow" style={{ margin: '0 0 10px' }}>
                Comments
                {comments && comments.length > 0 && <span className="muted">· {comments.length}</span>}
              </div>
              <div className="td-comment-box" data-focus={commentFocus ? 'true' : undefined}>
                <span
                  className="td-ava-sm shrink-0"
                  style={{
                    background: avatarColor((task as any)?.creator?.id || (task as any)?.creator?.email || 'me'),
                    borderRadius: '50%',
                    width: 26, height: 26, fontSize: 10,
                  }}
                >
                  {initialOf(((task as any)?.creator?.display_name) || ((task as any)?.creator?.email) || 'You')}
                </span>
                <div className="field" onFocus={() => setCommentFocus(true)} onBlur={() => setCommentFocus(false)}>
                  <MentionPicker
                    value={commentText}
                    mentions={commentMentions}
                    onChange={(t, m) => { setCommentText(t); setCommentMentions(m); }}
                    onSubmit={handleAddComment}
                    placeholder="Leave a comment…  ⌘↵ to send"
                    className="w-full bg-transparent text-[13px] text-[color:var(--sh-ink)] placeholder:text-[color:var(--sh-ink-3)] focus:outline-none"
                  />
                </div>
                {commentText.trim() && (
                  <button onClick={handleAddComment} className="td-comment-send">Send</button>
                )}
              </div>

              {canEdit && task && (
                <VoiceNoteRecorder taskId={task.id} onUploaded={() => refetchAttachments()} />
              )}

              {audioAttachments.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                  {audioAttachments.map((a) => (
                    <AudioAttachmentPlayer key={a.id} attachment={a} canEdit={canEdit} taskId={task!.id} />
                  ))}
                </div>
              )}

              {comments && comments.length > 0 ? (
                <div className="flex flex-col gap-3 mt-3">
                  {comments.map((c) => (
                    <div key={c.id} className="td-comment flex gap-3">
                      <span
                        className="td-ava-sm shrink-0"
                        style={{ background: avatarColor(c.user?.id || c.user?.email), borderRadius: '50%', width: 26, height: 26, fontSize: 10 }}
                      >
                        {initialOf(c.user?.display_name || c.user?.email)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <b className="text-[12.5px] text-[color:var(--sh-ink)] font-bold">{c.user?.display_name || c.user?.email}</b>
                          <span className="text-[11px] text-[color:var(--sh-ink-4)] font-medium">
                            {new Date(c.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
                          </span>
                        </div>
                        <div className="text-[13px] leading-[1.55] text-[color:var(--sh-ink-2)] mt-0.5 whitespace-pre-wrap">{c.content}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : audioAttachments.length === 0 ? (
                <div className="text-[12.5px] text-[color:var(--sh-ink-4)] mt-3">No comments yet.</div>
              ) : null}

              <div className="td-section-rule" />

              {/* Activity — collapsed by default */}
              <button
                type="button"
                className="td-activity-toggle"
                data-open={showActivity ? 'true' : undefined}
                onClick={() => setShowActivity((v) => !v)}
              >
                <svg className="chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M9 5l7 7-7 7" />
                </svg>
                Activity
              </button>
              {showActivity && (
                <div className="flex flex-col gap-3 mt-2 pl-1">
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
            </>
          )}
        </div>

      </aside>

      {assigneePickerOpen && task && (
        <AssigneePicker
          taskId={task.id}
          currentAssigneeIds={assignees.map(u => u.id)}
          anchorRect={assigneeAnchorRect}
          onChange={(ids) => updateTask.mutate({ id: task.id, assignee_ids: ids })}
          onClose={() => setAssigneePickerOpen(false)}
        />
      )}

      {workDateOpen && task && (
        <DatePicker
          anchorRect={workDateAnchor}
          value={task.work_date}
          mode="datetime"
          onChange={(next) => updateTask.mutate({ id: task.id, work_date: next })}
          onClose={() => setWorkDateOpen(false)}
        />
      )}

      {startDateOpen && task && (
        <DatePicker
          anchorRect={startDateAnchor}
          value={task.start_date}
          mode="datetime"
          onChange={(next) => updateTask.mutate({ id: task.id, start_date: next })}
          onClose={() => setStartDateOpen(false)}
        />
      )}

      {dueDateOpen && task && (
        <DatePicker
          anchorRect={dueDateAnchor}
          value={task.due_date}
          mode="datetime"
          onChange={(next) => updateTask.mutate({ id: task.id, due_date: next })}
          onClose={() => setDueDateOpen(false)}
        />
      )}

      {priorityMenuOpen && task && priorityAnchor && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setPriorityMenuOpen(false)} />
          <div
            className="fixed z-[56] w-48 overflow-hidden rounded-xl border shadow-lg"
            style={{
              borderColor: 'var(--sh-hair)',
              background: 'var(--surface)',
              top: Math.min(priorityAnchor.bottom + 4, window.innerHeight - 260),
              left: Math.min(priorityAnchor.left, window.innerWidth - 200),
            }}
          >
            {(['urgent', 'high', 'normal', 'low', 'none'] as TaskPriority[]).map((p) => (
              <button
                key={p}
                onClick={() => {
                  updateTask.mutate({ id: task.id, priority: p } as any);
                  setPriorityMenuOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-[color:var(--sh-hair-3)]"
              >
                <span>{PRIORITY_NAME[p]}</span>
                {PRIORITY_LABEL[p] && (
                  <span className="text-[11px] text-[color:var(--sh-ink-4)]">{PRIORITY_LABEL[p]}</span>
                )}
              </button>
            ))}
            <div className="td-menu-divider" />
            <button
              onClick={() => {
                setPriorityMenuOpen(false);
                setPendingEmergency(true);
              }}
              className="td-menu-danger flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-[color:var(--sh-hair-3)]"
            >
              <span className="text-[13px] font-semibold">EMERGENCY</span>
              <span className="td-menu-hint">Use cautiously</span>
            </button>
          </div>
        </>
      )}

      {pendingEmergency && task && (
        <EmergencyConfirm
          taskTitle={task.title}
          onConfirm={() => {
            updateTask.mutate({ id: task.id, priority: 'emergency' } as any);
            setPendingEmergency(false);
          }}
          onCancel={() => setPendingEmergency(false)}
        />
      )}
    </div>
  );
}

const META_ICONS: Record<string, React.ReactNode> = {
  Assignee: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </svg>
  ),
  Due: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  WorkDate: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="M9 15l2 2 4-4" />
    </svg>
  ),
  StartDate: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="M10 14l3 2-3 2z" fill="currentColor" />
    </svg>
  ),
  Status: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  Priority: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  ),
  Space: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
    </svg>
  ),
  Reporter: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h12l4 4v12H4z" />
      <path d="M8 8h8M8 12h6" />
    </svg>
  ),
  Estimate: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  Labels: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12L12 20a2 2 0 01-2.83 0L3 13.83V4h9.83L20 11.17a2 2 0 010 2.83z" />
      <circle cx="7.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
};

function MetaRow({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div
      className="td-meta-row grid py-2.5 items-center"
      style={{ gridTemplateColumns: '128px 1fr' }}
    >
      <span className="td-meta-k-nice">
        {META_ICONS[k]}
        {k}
      </span>
      <span className="td-meta-v-nice">
        {children}
      </span>
    </div>
  );
}

function CustomFieldRow({
  field,
  value,
  onChange,
  otherValue,
  onOtherChange,
  canEdit,
}: {
  field: TaskTypeField;
  value: unknown;
  onChange: (v: unknown) => void;
  otherValue?: unknown;
  onOtherChange?: (v: unknown) => void;
  canEdit: boolean;
}) {
  const baseInputCls = `rounded-lg border bg-transparent px-3 py-1.5 text-[13px] outline-none ${canEdit ? '' : 'cursor-default opacity-70'}`;
  const baseStyle: React.CSSProperties = { borderColor: 'var(--sh-hair)' };

  let control: React.ReactNode = null;
  const str = typeof value === 'string' ? value : value == null ? '' : String(value);
  const otherStr = typeof otherValue === 'string' ? otherValue : '';

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
      const otherSelected = arr.includes('__other__') || (field.allow_other && !!otherStr);
      const pillCls = (on: boolean) =>
        `rounded-full px-3 py-1 text-[12px] ${
          on ? 'bg-[color:var(--sh-ink)] text-[color:var(--surface)]' : 'bg-[color:var(--sh-hair-3)] text-[color:var(--sh-ink-2)]'
        } ${canEdit ? '' : 'cursor-default opacity-70'}`;
      control = (
        <div className="flex flex-col gap-2">
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
                  className={pillCls(on)}
                >
                  {o.label}
                </button>
              );
            })}
            {field.allow_other && (
              <button
                key="__other__"
                type="button"
                disabled={!canEdit}
                onClick={() => {
                  if (otherSelected) {
                    onChange(arr.filter((v) => v !== '__other__'));
                    onOtherChange?.(null);
                  } else {
                    if (!arr.includes('__other__')) onChange([...arr, '__other__']);
                  }
                }}
                className={pillCls(otherSelected)}
              >
                Other
              </button>
            )}
          </div>
          {field.allow_other && otherSelected && (
            <input
              type="text"
              defaultValue={otherStr}
              placeholder="Describe…"
              disabled={!canEdit}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== otherStr) onOtherChange?.(v || null);
              }}
              className={`${baseInputCls} max-w-md`}
              style={baseStyle}
            />
          )}
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
          className="h-4 w-4 cursor-pointer rounded"
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
    <div className="td-meta-row grid py-2 items-start text-[13px]" style={{ gridTemplateColumns: '112px 1fr' }}>
      <span className="td-meta-k td-mono text-[10.5px] uppercase tracking-[0.08em] text-[color:var(--sh-ink-4)] font-medium pt-1">
        {field.label}
        {field.is_required && <span className="text-red-500">*</span>}
      </span>
      <div className="min-w-0 flex-1">
        {control}
        {field.help_url && (
          <a
            href={field.help_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-block text-[11px] underline text-[color:var(--sh-ink-3)] hover:text-[color:var(--sh-ink)]"
          >
            View size chart ↗
          </a>
        )}
      </div>
    </div>
  );
}

function SpaceStatusPicker({
  statuses,
  current,
  taskStatusCategory,
  canEdit,
  onPick,
}: {
  statuses: SpaceStatus[];
  current: SpaceStatus | null;
  taskStatusCategory: string | undefined;
  canEdit: boolean;
  onPick: (s: SpaceStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const toggle = useCallback(() => {
    if (open) { setOpen(false); return; }
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  const popStyle = useMemo<React.CSSProperties>(() => {
    if (!rect) return { visibility: 'hidden' as const };
    const maxH = 360;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 200 && rect.top > spaceBelow;
    return {
      position: 'fixed',
      top: openUp ? Math.max(8, rect.top - maxH - 4) : rect.bottom + 4,
      left: rect.left,
      width: 200,
      maxHeight: maxH,
      zIndex: 9999,
      borderColor: 'var(--sh-hair)',
      background: 'var(--surface)',
    };
  }, [rect]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={canEdit ? toggle : undefined}
        className="td-prop-chip"
        style={{
          background: current?.color ? `color-mix(in oklch, ${current.color} 14%, transparent)` : 'var(--surface-alt)',
          color: current?.color || 'var(--sh-ink-3)',
        }}
      >
        <span className="dot" style={{ background: current?.color || 'var(--sh-ink-4)' }} />
        {current?.name || taskStatusCategory || 'No status'}
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={() => setOpen(false)} />
          <div
            ref={popRef}
            className="overflow-y-auto rounded-xl border shadow-lg"
            style={popStyle}
          >
            {statuses.map((s) => (
              <button
                key={s.id}
                onClick={() => { onPick(s); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-[color:var(--sh-hair-3)]"
              >
                <span className="td-dot" style={{ background: s.color }} />
                {s.name}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

const AUDIO_SPEEDS = [0.5, 1, 1.5, 2] as const;

function AudioAttachmentPlayer({
  attachment,
  canEdit,
  taskId,
}: {
  attachment: import('@squadhub/shared').TaskAttachment;
  canEdit: boolean;
  taskId: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const deleteMut = useDeleteTaskAttachment(taskId);

  useEffect(() => {
    const audio = new Audio(attachment.file_url);
    audioRef.current = audio;
    audio.playbackRate = speed;
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration));
    audio.addEventListener('ended', () => { setPlaying(false); setProgress(0); });
    return () => { audio.pause(); audio.src = ''; cancelAnimationFrame(rafRef.current); };
  }, [attachment.file_url]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const tick = () => {
    const a = audioRef.current;
    if (a && a.duration) setProgress(a.currentTime / a.duration);
    rafRef.current = requestAnimationFrame(tick);
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause(); setPlaying(false); cancelAnimationFrame(rafRef.current);
    } else {
      a.play(); setPlaying(true); rafRef.current = requestAnimationFrame(tick);
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * a.duration;
    setProgress(a.currentTime / a.duration);
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const onDelete = async () => {
    if (!confirm('Delete this voice note?')) return;
    await deleteMut.mutateAsync(attachment.id);
  };

  return (
    <div className="td-voice-note">
      <button type="button" onClick={togglePlay} className="td-voice-play">
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
        )}
      </button>
      <div className="td-voice-track" onClick={seek}>
        <div className="td-voice-track-fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <span className="td-voice-time">{fmtTime(playing ? (audioRef.current?.currentTime || 0) : duration)}</span>
      <button type="button" onClick={() => { const i = AUDIO_SPEEDS.indexOf(speed as typeof AUDIO_SPEEDS[number]); setSpeed(AUDIO_SPEEDS[(i + 1) % AUDIO_SPEEDS.length]); }} className="td-voice-speed">{speed}x</button>
      {canEdit && (
        <button type="button" onClick={onDelete} disabled={deleteMut.isPending} className="td-voice-del" title="Delete">×</button>
      )}
    </div>
  );
}

type VNRState = 'idle' | 'recording' | 'preview' | 'uploading';

function VoiceNoteRecorder({ taskId, onUploaded }: { taskId: string; onUploaded: () => void }) {
  const [state, setState] = useState<VNRState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const mimeRef = useRef('audio/webm');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);

  const clearTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  const clearPreview = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    audioRef.current = null;
    cancelAnimationFrame(rafRef.current);
    setPreviewPlaying(false);
    setPreviewProgress(0);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm',
      });
      chunksRef.current = [];
      mimeRef.current = mr.mimeType;
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearTimer();
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        blobRef.current = blob;
        if (blob.size < 500) { setState('idle'); return; }
        const audio = new Audio(URL.createObjectURL(blob));
        audioRef.current = audio;
        audio.addEventListener('ended', () => { setPreviewPlaying(false); setPreviewProgress(0); });
        setState('preview');
      };
      mr.start();
      mrRef.current = mr;
      setElapsed(0);
      const start = Date.now();
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 200);
      setState('recording');
    } catch (err) {
      console.error('Mic access denied:', err);
    }
  };

  const stopRecording = () => { mrRef.current?.stop(); };

  const togglePreviewPlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (previewPlaying) {
      a.pause(); setPreviewPlaying(false); cancelAnimationFrame(rafRef.current);
    } else {
      a.play(); setPreviewPlaying(true);
      const tick = () => {
        if (a.duration) setPreviewProgress(a.currentTime / a.duration);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }
  };

  const discard = () => { clearPreview(); blobRef.current = null; setState('idle'); setElapsed(0); };

  const send = async () => {
    const blob = blobRef.current;
    if (!blob) return;
    clearPreview();
    setState('uploading');
    const ext = mimeRef.current.includes('webm') ? 'webm' : 'ogg';
    const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: mimeRef.current });
    try {
      const presignRes = await api.post('/pm/task-attachments/presign', {
        task_id: taskId, filename: file.name, content_type: file.type, file_size: file.size,
      });
      const { upload_url, key } = presignRes.data.data;
      await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      await api.post('/pm/task-attachments/confirm', {
        task_id: taskId, object_key: key, file_name: file.name, mime_type: file.type,
      });
      onUploaded();
    } catch (err) {
      console.error('Voice note upload failed:', err);
    }
    blobRef.current = null;
    setState('idle');
    setElapsed(0);
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  if (state === 'idle') {
    return (
      <button type="button" onClick={startRecording} className="td-voice-rec-btn" style={{ marginTop: 8 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="1" width="6" height="12" rx="3" />
          <path d="M19 10v1a7 7 0 01-14 0v-1M12 19v4M8 23h8" />
        </svg>
        Record voice note
      </button>
    );
  }

  if (state === 'recording') {
    return (
      <div className="td-voice-note" style={{ marginTop: 8, background: 'color-mix(in oklch, oklch(0.55 0.22 25) 6%, var(--surface))' }}>
        <span className="td-voice-pulse" />
        <span style={{ color: '#ef4444', fontWeight: 600, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{fmtTime(elapsed)}</span>
        <span style={{ flex: 1, fontSize: 11, color: 'var(--sh-ink-3)' }}>Recording…</span>
        <button type="button" onClick={stopRecording} className="td-voice-speed" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
          Stop
        </button>
      </div>
    );
  }

  if (state === 'preview') {
    return (
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="td-voice-note">
          <button type="button" onClick={togglePreviewPlay} className="td-voice-play">
            {previewPlaying ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
            )}
          </button>
          <div className="td-voice-track" onClick={(e) => {
            const a = audioRef.current;
            if (!a || !a.duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            a.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * a.duration;
            setPreviewProgress(a.currentTime / a.duration);
          }}>
            <div className="td-voice-track-fill" style={{ width: `${previewProgress * 100}%` }} />
          </div>
          <span className="td-voice-time">{fmtTime(elapsed)}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" onClick={discard} className="td-voice-speed" style={{ color: 'var(--sh-ink-3)' }}>
            Delete
          </button>
          <button type="button" onClick={send} className="td-voice-speed" style={{ background: 'var(--sh-ink)', color: 'var(--surface)', borderColor: 'var(--sh-ink)' }}>
            Send
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="td-voice-note" style={{ marginTop: 8, opacity: 0.6 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
      <span style={{ fontSize: 12, color: 'var(--sh-ink-3)' }}>Uploading voice note…</span>
    </div>
  );
}
