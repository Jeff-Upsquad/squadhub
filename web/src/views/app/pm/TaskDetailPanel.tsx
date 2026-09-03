import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { usePMStore } from '../../../stores/pmStore';
import { useTask, useUpdateTask, useDeleteTask, useTaskComments, useAddComment, useCreateTask, useUpdateTaskTimeTracked, useTaskLists, useAddTaskToLists, useRemoveTaskFromList, useTaskActivity } from '../../../hooks/useTasks';
import { useTimeStats } from '../../../hooks/useTimer';
import { useFocusTask } from '../../../hooks/useDayPlanner';
import { isTaskFocused } from '../../../lib/taskGrouping';
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
import type { Task, TaskChecklist, SpaceStatus, TaskType, TaskTypeField, TaskMetadata, TaskPriority, TaskStatusKey, TaskRecurrence } from '@squadhub/shared';
import { getTaskStatusDef, describeTaskRecurrence } from '@squadhub/shared';
import AssigneePicker from './AssigneePicker';
import NoAssigneeCompleteDialog from './NoAssigneeCompleteDialog';
import IncompleteItemsDialog from './IncompleteItemsDialog';
import MentionPicker from '../../../components/MentionPicker';
import DatePicker from './DatePicker';
import RepeatPicker from './RepeatPicker';
import { nextQuickDate, groupDesignFields, statusIsComplete } from './taskHelpers';
import EmergencyConfirm from './EmergencyConfirm';
import TaskStatusPicker from './TaskStatusPicker';
import ListPickerCombobox from './ListPickerCombobox';
import LabelPicker from './LabelPicker';
import { useDetachLabel } from '../../../hooks/useLabels';
import TaskAttachments, { type TaskAttachmentsHandle } from './TaskAttachments';
import { useTaskAttachments, useDeleteTaskAttachment } from '../../../hooks/useTaskAttachments';
import { usePanelFileDrop } from './usePanelFileDrop';
import { linkifyText } from '../../../lib/linkify';
import SopBreachReportModal from '../../../components/sop/SopBreachReportModal';
import SopFlagDetailModal from '../../../components/sop/SopFlagDetailModal';
import WorkBlockSections from './WorkBlockSections';
import {
  useStartWorkBlockRun,
  useStopWorkBlockRun,
  useActiveWorkBlockRun,
  useRecordWorkBlockCompletion,
  useOpenWorkBlockTaskTime,
} from '../../../hooks/useWorkBlocks';
import { useParallelTimers } from '../../../hooks/useParallelTimers';
import { useLearningStore } from '../../../stores/learningStore';
import { useIsMobile } from '../../../hooks/useIsMobile';

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
  const s = seconds % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return `${s}s`;
}

function formatPlanDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = dateOnlyMatch
    ? new Date(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]))
    : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
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

// ── Activity feed rendering ────────────────────────────────────────────────
const ACTIVITY_FIELD_LABEL: Record<string, string> = {
  due_date: 'due date', work_date: 'work date', start_date: 'start date',
};

function fmtEstimate(m: unknown): string {
  if (m == null) return 'none';
  const mins = Number(m);
  if (!Number.isFinite(mins)) return String(m);
  const h = Math.floor(mins / 60);
  const min = mins % 60;
  return h ? (min ? `${h}h ${min}m` : `${h}h`) : `${min}m`;
}

// time_tracked ("Logged") is stored in SECONDS, unlike time_estimate (minutes).
function fmtSeconds(s: unknown): string {
  const secs = Number(s);
  if (!Number.isFinite(secs) || secs <= 0) return 'none';
  const totalMin = Math.round(secs / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function fmtDateValue(v: unknown): string {
  if (!v) return 'none';
  const { text } = formatDueRelative(String(v));
  return text;
}

// Entity events carry {id, name} (assignee/label/list/type) or {id, title}
// (subtask), or {name} (attachment). Pull a display string from any of them.
function entityName(v: unknown): string {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return (o.name as string) || (o.title as string) || '—';
  }
  return v == null ? 'none' : String(v);
}

type ActivityForRender = {
  event_type: string;
  field: string | null;
  old_value: unknown;
  new_value: unknown;
  user: { display_name: string | null; email: string | null } | null;
};

// Map one activity entry to a feed icon + sentence. Bold actor + the changed value.
function renderActivity(e: ActivityForRender): { icon: string; body: React.ReactNode } {
  const actor = <b>{e.user?.display_name || e.user?.email || 'Someone'}</b>;
  const dim = (s: React.ReactNode) => <span className="text-[color:var(--sh-ink-3)]">{s}</span>;
  const line = (verb: React.ReactNode, val?: React.ReactNode): React.ReactNode => (
    <>{actor} {dim(verb)}{val != null ? <> <b>{val}</b></> : null}</>
  );

  switch (e.event_type) {
    case 'created': return { icon: '○', body: line('created the task') };
    case 'comment': return { icon: '○', body: line('commented') };
    case 'subtask_added': return { icon: '◇', body: line('added subtask', entityName(e.new_value)) };
    case 'assignee_added': return { icon: '◉', body: line('assigned', entityName(e.new_value)) };
    case 'assignee_removed': return { icon: '◎', body: line('unassigned', entityName(e.old_value)) };
    case 'label_added': return { icon: '◆', body: line('added label', entityName(e.new_value)) };
    case 'label_removed': return { icon: '◇', body: line('removed label', entityName(e.old_value)) };
    case 'attachment_added': return { icon: '▣', body: line('attached', entityName(e.new_value)) };
    case 'moved': return { icon: '→', body: line('moved to', entityName(e.new_value)) };
    case 'subtask_removed': return { icon: '◇', body: line('removed subtask', entityName(e.old_value)) };
    case 'list_link_added': return { icon: '→', body: line('added to list', entityName(e.new_value)) };
    case 'list_link_removed': return { icon: '←', body: line('removed from list', entityName(e.old_value)) };
    case 'attachment_removed': return { icon: '▢', body: line('removed attachment', entityName(e.old_value)) };
    case 'comment_deleted': return { icon: '○', body: line('deleted a comment') };
    case 'focus_set': return { icon: '★', body: line('focused this task') };
    case 'focus_cleared': return { icon: '☆', body: line('removed focus') };
    case 'snooze_set': return { icon: '◔', body: line('snoozed this task') };
    case 'snooze_cleared': return { icon: '○', body: line('cleared snooze') };
    case 'reviewed': return { icon: '✓', body: line('marked as reviewed') };
    case 'unreviewed': return { icon: '○', body: line('marked as not reviewed') };
    case 'field_change': {
      const f = e.field || '';
      if (f === 'status') return { icon: '●', body: line('set status to', String(e.new_value ?? 'none')) };
      if (f === 'priority') {
        const key = (e.new_value ?? 'none') as TaskPriority;
        return { icon: '◆', body: line('changed priority to', PRIORITY_LABEL[key] || String(key)) };
      }
      if (f === 'title') return { icon: '○', body: line('renamed to', String(e.new_value ?? '')) };
      if (f === 'description') return { icon: '○', body: line('updated the description') };
      if (f === 'task_type_id') return { icon: '○', body: line('changed task type to', entityName(e.new_value)) };
      if (f === 'time_estimate') return { icon: '○', body: line('set estimate to', fmtEstimate(e.new_value)) };
      if (f === 'time_tracked') return { icon: '○', body: line('set logged time to', fmtSeconds(e.new_value)) };
      if (f === 'recurrence') return e.new_value == null
        ? { icon: '○', body: line('removed recurrence') }
        : { icon: '↻', body: line('set the task to repeat') };
      if (f === 'metadata') return { icon: '○', body: line('updated details') };
      if (f in ACTIVITY_FIELD_LABEL) {
        const label = ACTIVITY_FIELD_LABEL[f];
        return e.new_value == null
          ? { icon: '○', body: line(`cleared ${label}`) }
          : { icon: '○', body: line(`set ${label} to`, fmtDateValue(e.new_value)) };
      }
      return { icon: '○', body: line(`changed ${f}`) };
    }
    default: return { icon: '○', body: line('updated the task') };
  }
}

export default function TaskDetailPanel({
  statuses,
  listId,
  canEdit = true,
  spaceName,
  spaceColor,
  spaceId,
  folderId,
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
  folderId?: string | null;
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
  const { activeTaskId, timers, timerSegmentStart } = pmStore;
  const focusTask = useFocusTask();
  // effectiveTaskId — primary uses the global activeTaskId; peek uses the override.
  const effectiveTaskId = taskIdOverride ?? activeTaskId;
  // Close routes: peek closes peekTaskId, primary closes activeTaskId. Opening
  // a subtask from inside a peek opens it into the peek slot (replacing the
  // current peek task) — that matches the user's mental model of "this side
  // is for drilling in without losing the host on the other side."
  const setActiveTask = isPeek ? pmStore.setPeekTask : pmStore.setActiveTask;
  const { data: task, isLoading } = useTask(effectiveTaskId);
  const isFocused = task ? isTaskFocused(task) : false;
  const { data: comments } = useTaskComments(effectiveTaskId);
  const { data: taskTypes } = useTaskTypes();
  const { data: checklists } = useChecklists(effectiveTaskId);
  const updateTask = useUpdateTask(listId);
  const detachLabel = useDetachLabel(effectiveTaskId ?? '');
  // Multi-homing: every list this task lives in (primary + added), plus the
  // mutations to add/remove the added ones. taskLists[0] is the primary list.
  const { data: taskLists } = useTaskLists(effectiveTaskId);
  const addToLists = useAddTaskToLists(effectiveTaskId);
  const removeFromList = useRemoveTaskFromList(effectiveTaskId);
  const secondaryLists = (taskLists || []).filter((p) => !p.is_primary);

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
  const isMobile = useIsMobile();
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
  const setLearningTarget = useLearningStore((s) => s.setLearningTarget);
  const openLearning = async () => {
    if (!task) return;
    const res = await api.get(`/lms/task-target?task_id=${task.id}`);
    const target = res.data.data as { item_id: string; lesson_id: string | null; section_anchor: string | null };
    setLearningTarget({ itemId: target.item_id, lessonId: target.lesson_id, sectionAnchor: target.section_anchor });
    setActiveTask(null);
    window.dispatchEvent(new CustomEvent('squadhub:open-resource'));
  };

  // Read-only "Elapsed (idle)" for design/video spaces: the task's folder's
  // elapsed time for today (a per-space/day figure, written by the elapsed-time
  // cron). Folders with no elapsed time — e.g. non-design spaces — return 0 and
  // the row is hidden, so this stays invisible everywhere it doesn't apply.
  const elapsedTodayISO = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const { data: elapsedTodaySeconds = 0 } = useQuery({
    queryKey: ['folder-elapsed-today', folderId, elapsedTodayISO],
    queryFn: async () => {
      try {
        const r = await api.get(
          `/pm/folders/${folderId}/time-summary?from=${elapsedTodayISO}&to=${elapsedTodayISO}`,
        );
        const rows = (r.data.data || []) as { date: string; elapsed_seconds?: number }[];
        return rows.reduce((s, x) => s + (x.elapsed_seconds || 0), 0);
      } catch {
        return 0;
      }
    },
    enabled: !!folderId,
    staleTime: 60_000,
  });

  const [editing, setEditing] = useState<'title' | 'description' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentMentions, setCommentMentions] = useState<string[]>([]);
  const [showActivity, setShowActivity] = useState(false);
  // Activity is fetched only once its (collapsed-by-default) section is opened.
  const { data: activityFeed } = useTaskActivity(effectiveTaskId, showActivity);
  const [commentFocus, setCommentFocus] = useState(false);
  const [estimateInput, setEstimateInput] = useState('');
  const [editingEstimate, setEditingEstimate] = useState(false);
  const [loggedHours, setLoggedHours] = useState('');
  const [loggedMinutes, setLoggedMinutes] = useState('');
  const [editingLogged, setEditingLogged] = useState(false);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const [priorityAnchor, setPriorityAnchor] = useState<DOMRect | null>(null);
  const [pendingEmergency, setPendingEmergency] = useState(false);
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [assigneeAnchorRect, setAssigneeAnchorRect] = useState<DOMRect | null>(null);
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const [labelAnchorRect, setLabelAnchorRect] = useState<DOMRect | null>(null);
  const [workDateOpen, setWorkDateOpen] = useState(false);
  const [workDateAnchor, setWorkDateAnchor] = useState<DOMRect | null>(null);
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [startDateAnchor, setStartDateAnchor] = useState<DOMRect | null>(null);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [dueDateAnchor, setDueDateAnchor] = useState<DOMRect | null>(null);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [repeatAnchor, setRepeatAnchor] = useState<DOMRect | null>(null);
  const [newItemDrafts, setNewItemDrafts] = useState<Record<string, string>>({});
  const [newChecklistTitle, setNewChecklistTitle] = useState<string | null>(null);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [mainCelebrating, setMainCelebrating] = useState(false);
  const [celebratingSubtaskId, setCelebratingSubtaskId] = useState<string | null>(null);
  // Completion-time prompts. `subtaskId` set = the prompt targets a subtask row
  // checkbox instead of the main task's status control.
  const [noAssigneePrompt, setNoAssigneePrompt] = useState<{ rect: DOMRect; subtaskId?: string } | null>(null);
  const [assignCompleteAnchor, setAssignCompleteAnchor] = useState<{ rect: DOMRect; subtaskId?: string } | null>(null);
  // Completion gate — set when a check-off is blocked because the task still
  // has open subtasks / unchecked checklist items. Blocking: no complete-anyway.
  const [incompletePrompt, setIncompletePrompt] = useState<{ rect: DOMRect; subtasks: number; checklist: number; subtaskId?: string } | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [flagDetail, setFlagDetail] = useState<any>(null);

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

  // Type shown in the read-only "Type" row. A spawned routine instance reads as
  // "Routine" regardless of its underlying type (which stays intact so its
  // status keeps resolving correctly) — see taskMirror notes.
  const displayType = useMemo<TaskType | null>(() => {
    if (task?.recurring_parent_id && taskTypes) {
      return taskTypes.find((t) => t.key === 'routine') || currentType;
    }
    return currentType;
  }, [task, taskTypes, currentType]);

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
  // Parallel per-task timers — start (with the conflict dialog gate), stop, and
  // the segment-share flush + work-block/group-run bracketing all live in here.
  const { requestStartTimer, stopTimer: stopParallelTimer } = useParallelTimers();

  // Two independent "is running for this task?" predicates: the per-task
  // timer (regular tasks) and the work-block run (work-block tasks). They
  // never overlap on the *same* task, but a regular task's timer can run
  // alongside a work-block run on a different task — that's the whole point.
  const isTimerForThisTask = !isWorkBlock && timers.some((t) => t.taskId === effectiveTaskId);
  const isWorkBlockRunForThisTask =
    isWorkBlock && activeWorkBlock.data?.task.id === effectiveTaskId && !activeWorkBlock.data?.run.ended_at;
  const isAnyRunningForThisTask = isTimerForThisTask || isWorkBlockRunForThisTask;

  useEffect(() => {
    if (isTimerForThisTask && timers.length && timerSegmentStart != null) {
      // Live add-on for a running task = its equal split of the CURRENT
      // segment. Earlier segments are already flushed into task.time_tracked,
      // which every display adds this to.
      const tick = () =>
        setTimerElapsed(Math.max(0, Math.floor((Date.now() - timerSegmentStart) / 1000 / timers.length)));
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
  }, [isTimerForThisTask, timers, timerSegmentStart, isWorkBlockRunForThisTask, activeWorkBlock.data]);

  const handleStartTimer = async () => {
    if (!task) return;

    // ---- Work-block path: only manage the work-block run, leave the
    // per-task timers alone so the user can still run them on regular tasks
    // at the same time.
    if (isWorkBlock) {
      try {
        const run = await startWorkBlockRun.mutateAsync({ task_id: task.id });
        // Any per-task timers already running on regular tasks get their
        // overlap logged immediately so the work block shows them from second 0.
        for (const t of timers) {
          if (t.taskId !== task.id) openTaskTime.mutate({ run_id: run.id, task_id: t.taskId });
        }
      } catch (err) { console.error('Failed to start work-block run:', err); }
      return;
    }

    // ---- Regular-task path: nothing running → starts the primary timer;
    // otherwise the global conflict dialog offers to add this as a secondary.
    await requestStartTimer({ taskId: task.id, taskTitle: task.title, listId, baseTracked: task.time_tracked || 0 });
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

    // ---- Regular-task path: stop just this task's timer — any others keep
    // running. The hook logs each running task's share of the closed segment.
    await stopParallelTimer(task.id);
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

  // Normalize legacy status for design/video tasks when the drawer opens
  useEffect(() => {
    if (!task || isTaskType || !statuses.length || !taskStatusCategory) return;
    if (statuses.some((s) => s.name === taskStatusCategory)) return;
    const legacyCategory: Record<string, string> = { todo: 'todo', active: 'active', done: 'done', closed: 'closed' };
    const cat = legacyCategory[taskStatusCategory];
    if (!cat) return;
    const target = statuses.find((s) => s.category === cat);
    if (target && target.name !== taskStatusCategory) {
      updateTask.mutate({ id: task.id, status: target.name } as any);
    }
  }, [task?.id, isTaskType, statuses, taskStatusCategory]);

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

  // Apply the closing transition: fire the celebration, log against an active
  // work-block run, and write the done status — optionally assigning people in
  // the same write (used by the no-assignee prompt's "assign & complete").
  const completeToDone = (assigneeIds?: string[]) => {
    if (!task) return;
    let next: string;
    if (!isTaskType && statuses.length > 0) {
      next = statuses.find((s) => s.category === 'closed')?.name || statuses.find((s) => s.category === 'done')?.name || statuses[statuses.length - 1].name;
    } else {
      next = 'closed';
    }
    setMainCelebrating(true);
    setTimeout(() => setMainCelebrating(false), 650);
    const active = activeWorkBlock.data;
    if (active && active.task.id !== task.id) {
      recordCompletion.mutate({ run_id: active.run.id, completed_task_id: task.id });
    }
    const payload: Record<string, unknown> = { id: task.id, status: next };
    if (assigneeIds) payload.assignee_ids = assigneeIds;
    updateTask.mutate(payload as any);
  };

  const handleToggleDone = (e?: React.MouseEvent) => {
    if (!task || !canEdit) return;
    // Re-opening a completed task: flip straight back, no prompt.
    if (isDone) {
      let next: string;
      if (!isTaskType && statuses.length > 0) {
        next = statuses.find((s) => s.category === 'todo')?.name || statuses[0].name;
      } else {
        next = 'open';
      }
      updateTask.mutate({ id: task.id, status: next } as any);
      return;
    }
    // Completion gate: every subtask and checklist item must be complete
    // before the task itself can close. Blocking — unlike the assignee
    // prompt below there is no complete-anyway. Mirrors TaskRow.
    const openSubs = (task.subtasks || [])
      .filter((s) => !statusIsComplete((s as any).status as string | undefined, statuses)).length;
    const openItems = (checklists || [])
      .flatMap((c) => c.items || [])
      .filter((i) => !i.is_done).length;
    if ((openSubs > 0 || openItems > 0) && e) {
      setIncompletePrompt({
        rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
        subtasks: openSubs,
        checklist: openItems,
      });
      return;
    }
    // Completing with nobody assigned: ask first (assign to me / someone else /
    // complete as-is) instead of silently closing it unassigned. Mirrors the
    // list-view checkbox in TaskRow.
    if ((task.assignees || []).length === 0 && e) {
      setNoAssigneePrompt({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
      return;
    }
    completeToDone();
  };

  // Mark a subtask row done, optionally assigning people in the same write —
  // the subtask counterpart of completeToDone, used by the checkbox and the
  // no-assignee prompt's assign-&-complete paths.
  const completeSubtask = (subtaskId: string, assigneeIds?: string[]) => {
    setCelebratingSubtaskId(subtaskId);
    setTimeout(() => {
      setCelebratingSubtaskId((curr) => (curr === subtaskId ? null : curr));
    }, 650);
    const payload: Record<string, unknown> = { id: subtaskId, status: 'done' };
    if (assigneeIds) payload.assignee_ids = assigneeIds;
    updateTask.mutate(payload as any);
  };

  // Subtask checkbox — same gates as the main task and TaskRow: open
  // subtasks/checklist items block, then no-assignee prompts. The row only
  // carries shallow data, so fetch the subtask's own detail at click time
  // (cached under the same keys its detail panel uses). Fails open on fetch
  // errors — the server enforces the same rule as a backstop.
  const handleSubtaskToggle = async (st: any, e: React.MouseEvent) => {
    if (!canEdit) return;
    const stDone = st.status === 'done' || st.status === 'closed';
    // Re-opening a completed subtask: flip straight back, no prompt.
    if (stDone) {
      updateTask.mutate({ id: st.id, status: 'todo' } as any);
      return;
    }
    // Capture the anchor now — e.currentTarget is gone after the await below.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    try {
      const [detail, subChecklists] = await Promise.all([
        qc.fetchQuery<Task>({
          queryKey: ['task', st.id],
          queryFn: async () => (await api.get(`/pm/tasks/${st.id}`)).data.data,
          staleTime: 10_000,
        }),
        qc.fetchQuery<TaskChecklist[]>({
          queryKey: ['checklists', st.id],
          queryFn: async () => (await api.get(`/pm/tasks/${st.id}/checklists`)).data.data,
          staleTime: 10_000,
        }),
      ]);
      const openSubs = (detail?.subtasks || [])
        .filter((s) => !statusIsComplete((s as any).status as string | undefined, statuses)).length;
      const openItems = (subChecklists || [])
        .flatMap((c) => c.items || [])
        .filter((i) => !i.is_done).length;
      if (openSubs > 0 || openItems > 0) {
        setIncompletePrompt({ rect, subtasks: openSubs, checklist: openItems, subtaskId: st.id });
        return;
      }
    } catch { /* fail open — the server-side gate still blocks */ }
    if ((st.assignees || []).length === 0) {
      setNoAssigneePrompt({ rect, subtaskId: st.id });
      return;
    }
    completeSubtask(st.id);
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

  // Breadcrumb navigation — clicking a path segment navigates the underlying
  // view to that space / folder / list and closes this task panel. Mirrors the
  // SpaceTree click handlers (set the PM store selection; MainLayout's effects
  // switch the section/view to show it).
  const goToSpace = () => {
    if (!spaceId) return;
    pmStore.setActiveSpace(spaceId);
    pmStore.setActiveSpacePage(spaceId);
    setActiveTask(null);
  };
  const goToFolder = () => {
    if (!spaceId || !folderId) return;
    pmStore.setActiveSpace(spaceId);
    pmStore.setActiveFolder(folderId);
    setActiveTask(null);
  };
  const goToList = () => {
    if (spaceId) pmStore.setActiveSpace(spaceId);
    pmStore.setActiveList(listId);
    setActiveTask(null);
  };

  // Same navigation as the primary breadcrumb, but driven by an explicit path —
  // used by the "Also in" secondary-list chips, which carry their own ids.
  const goToPathSpace = (p: { space_id: string | null }) => {
    if (!p.space_id) return;
    pmStore.setActiveSpace(p.space_id);
    pmStore.setActiveSpacePage(p.space_id);
    setActiveTask(null);
  };
  const goToPathFolder = (p: { space_id: string | null; folder_id: string | null }) => {
    if (!p.space_id || !p.folder_id) return;
    pmStore.setActiveSpace(p.space_id);
    pmStore.setActiveFolder(p.folder_id);
    setActiveTask(null);
  };
  const goToPathList = (p: { space_id: string | null; list_id: string }) => {
    if (p.space_id) pmStore.setActiveSpace(p.space_id);
    pmStore.setActiveList(p.list_id);
    setActiveTask(null);
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
  const checklistItems = (checklists || []).flatMap((c) => c.items || []);
  const progressTotal = subtasks.length + checklistItems.length;
  const progressDone = subtaskDone + checklistItems.filter((i) => i.is_done).length;

  // Real change history from the server (field changes, assignees, labels,
  // comments, attachments, move, creation…), already merged + sorted newest-first.
  const activityItems: { icon: string; body: React.ReactNode; t: string }[] =
    (activityFeed || []).map((e) => {
      const { icon, body } = renderActivity(e);
      return { icon, body, t: e.created_at };
    });

  return (
    <div className={`fixed inset-0 z-[90]${isMobile ? ' td-mobile-root' : ''}`}>
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
        data-mobile={isMobile ? 'true' : undefined}
        style={{
          background: isMobile ? '#ffffff' : 'var(--surface)',
          // Peek slides in from the LEFT; primary slides in from the right.
          transform: mounted
            ? 'translateX(0)'
            : isPeek ? 'translateX(calc(-100% - 24px))' : 'translateX(calc(100% + 24px))',
          transition: isMobile ? 'none' : 'transform .42s cubic-bezier(0.23, 1, 0.32, 1), opacity .3s ease',
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
        {isMobile && task && (
          <div className="td-m-hero">
            <div className="td-m-hero-nav">
              <button type="button" className="td-m-hero-icon" aria-label="Back" onClick={() => setActiveTask(null)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
              </button>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="td-m-hero-icon"
                data-on={isFocused ? 'true' : undefined}
                aria-label={isFocused ? 'Unstar' : 'Star'}
                onClick={() => focusTask.mutate({ id: task.id, focused: !isFocused })}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill={isFocused ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8"><path d="M12 2.8l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 16.8 6.6 19.6l1-6.1L3.2 9.2l6.1-.9z" /></svg>
              </button>
              <button type="button" className="td-m-hero-icon" aria-label="Copy link" onClick={handleCopyLink}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
              </button>
              <div className="relative">
                <button type="button" className="td-m-hero-icon" aria-label="More" onClick={() => setMoreMenuOpen((v) => !v)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
                </button>
                {moreMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMoreMenuOpen(false)} />
                    <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border shadow-lg" style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface)' }}>
                      {canEdit && workspaceId && (
                        <button onClick={() => { setMoreMenuOpen(false); setMovePickerOpen(true); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" style={{ color: 'var(--sh-ink)' }}>Move to another list</button>
                      )}
                      {canEdit && workspaceId && (
                        <button onClick={() => { setMoreMenuOpen(false); setAddPickerOpen(true); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" style={{ color: 'var(--sh-ink)' }}>Add to list</button>
                      )}
                      {canEdit && (
                        <button onClick={() => { handleDelete(); setMoreMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" style={{ color: 'oklch(0.55 0.18 25)' }}>Delete task</button>
                      )}
                      <div className="border-t border-[var(--sh-hair)]" />
                      <button onClick={() => { setMoreMenuOpen(false); setShowReport(true); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">🚩 Report SOP breach</button>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="td-m-hero-title">
              <button
                type="button"
                onClick={handleToggleDone}
                disabled={!canEdit}
                className="td-checkbox-lg td-m-hero-check"
                data-done={(isDone || mainCelebrating) ? 'true' : 'false'}
                aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
              />
              <div className="td-m-hero-copy">
                <h1 className={isDone ? 'is-done' : undefined}>{task.title}</h1>
                {(spaceName || listName) && (
                  <p>{[spaceName, folderName, listName].filter(Boolean).join(' › ')}</p>
                )}
              </div>
              {progressTotal > 0 && (
                <span className="td-m-ring" aria-label={`${progressDone} of ${progressTotal}`}>
                  <svg viewBox="0 0 46 46" aria-hidden>
                    <circle cx="23" cy="23" r="18" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="3.5" />
                    <circle
                      cx="23" cy="23" r="18" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 18}
                      strokeDashoffset={2 * Math.PI * 18 * (1 - progressDone / progressTotal)}
                      transform="rotate(-90 23 23)"
                    />
                  </svg>
                  <b>{progressDone}/{progressTotal}</b>
                </span>
              )}
            </div>
            <div className="td-m-hero-cmds">
              {canEdit && (
                isAnyRunningForThisTask ? (
                  <button type="button" className="td-m-cmd is-running" onClick={handleStopTimer}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                    {formatSeconds(isWorkBlockRunForThisTask ? timerElapsed : (task.time_tracked || 0) + timerElapsed)}
                  </button>
                ) : (
                  <button type="button" className="td-m-cmd" onClick={handleStartTimer}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                    Start timer
                  </button>
                )
              )}
              {canEdit && (
                <button type="button" className={`td-m-cmd td-m-cmd-complete${isDone ? ' is-done' : ''}`} onClick={handleToggleDone}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7" /></svg>
                  {isDone ? 'Completed' : 'Complete'}
                </button>
              )}
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
          {spaceName && (() => {
            // Clickable breadcrumb — each segment navigates the underlying view
            // to that space / folder / list (see goToSpace/goToFolder/goToList).
            const crumb = (
              <span className="td-bcrumb">
                <button type="button" className="td-bcrumb-part" onClick={goToSpace} title={`Go to ${spaceName}`}>
                  <span className="emblem" style={{ background: spaceColor || 'var(--sh-ink)' }}>
                    {initialOf(spaceName)[0]}
                  </span>
                  <span className="name">{spaceName}</span>
                </button>
                {folderName && (
                  <>
                    <span className="sep">›</span>
                    <button type="button" className="td-bcrumb-part" onClick={goToFolder} title={`Go to ${folderName}`}>
                      <span className="name">{folderName}</span>
                    </button>
                  </>
                )}
                {listName && (
                  <>
                    <span className="sep">›</span>
                    <button type="button" className="td-bcrumb-part" onClick={goToList} title={`Go to ${listName}`}>
                      <span className="name">{listName}</span>
                    </button>
                  </>
                )}
              </span>
            );
            // For editors, wrap the breadcrumb in the list picker so the "Move to
            // another list" action (now in the ⋯ menu) can anchor its dropdown
            // here. The picker is opened via movePickerOpen, not by the crumb.
            return workspaceId && canEdit ? (
              <ListPickerCombobox
                workspaceId={workspaceId}
                selectedListId={listId}
                selectedListName={listName ?? null}
                initialSpaceId={spaceId ?? null}
                open={movePickerOpen}
                onOpenChange={setMovePickerOpen}
                onChange={(newListId) => {
                  if (task && newListId !== listId) {
                    updateTask.mutate({ id: task.id, list_id: newListId });
                  }
                }}
                renderTrigger={() => crumb}
              />
            ) : crumb;
          })()}
          {/* Invisible anchor for the "Add to list" picker (opened from the ⋯
              menu). Multi-homing: each pick links the task into another list. */}
          {workspaceId && canEdit && (
            <ListPickerCombobox
              workspaceId={workspaceId}
              selectedListId={null}
              selectedListName={null}
              initialSpaceId={spaceId ?? null}
              open={addPickerOpen}
              onOpenChange={setAddPickerOpen}
              onChange={(newListId) => {
                if (!task) return;
                if (newListId === listId) return; // already its primary list
                if (secondaryLists.some((p) => p.list_id === newListId)) return; // already added
                addToLists.mutate([newListId]);
              }}
              renderTrigger={() => <span aria-hidden className="block h-0 w-0" />}
            />
          )}
          <div className="flex-1" />
          {task && (
            <button
              type="button"
              onClick={() => focusTask.mutate({ id: task.id, focused: !isFocused })}
              className="td-nav-btn td-focus-star"
              data-active={isFocused}
              title={isFocused ? 'Focused — click to remove' : 'Focus'}
              aria-label={isFocused ? 'Focused' : 'Focus'}
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>{isFocused ? '★' : '☆'}</span>
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
                  {canEdit && workspaceId && (
                    <button
                      onClick={() => { setMoreMenuOpen(false); setMovePickerOpen(true); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[color:var(--sh-hair-3)]"
                      style={{ color: 'var(--sh-ink)' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[color:var(--sh-ink-4)]">
                        <path d="M5 9l-3 3 3 3" />
                        <path d="M2 12h13" />
                        <path d="M22 5v14a2 2 0 01-2 2h-6" />
                      </svg>
                      Move to another list
                    </button>
                  )}
                  {canEdit && workspaceId && (
                    <button
                      onClick={() => { setMoreMenuOpen(false); setAddPickerOpen(true); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[color:var(--sh-hair-3)]"
                      style={{ color: 'var(--sh-ink)' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[color:var(--sh-ink-4)]">
                        <path d="M9 11l3 3L22 4" />
                        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                        <line x1="19" y1="3" x2="19" y2="9" />
                        <line x1="16" y1="6" x2="22" y2="6" />
                      </svg>
                      Add to list
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => { handleDelete(); setMoreMenuOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[color:var(--sh-hair-3)]"
                      style={{ color: 'oklch(0.55 0.18 25)' }}
                    >
                      Delete task
                    </button>
                  )}
                  <div className="border-t border-[var(--sh-hair)]" />
                  <button onClick={() => { setMoreMenuOpen(false); setShowReport(true); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">🚩 Report SOP breach</button>
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
        </div>

        {/* Secondary lists — the task also appears in these lists (multi-homing).
            Rendered as paths below the primary breadcrumb; each removable. */}
        {secondaryLists.length > 0 && (
          <div className="td-also shrink-0">
            <span className="td-also-label">Also in</span>
            <div className="td-also-paths">
              {secondaryLists.map((p) => (
                <span key={p.list_id} className="td-also-path" title="Also appears in this list — click to open">
                  {p.space_name && (
                    <>
                      <button
                        type="button"
                        className="td-also-seg"
                        onClick={() => goToPathSpace(p)}
                        title={`Go to ${p.space_name}`}
                      >
                        <span
                          className="td-also-emblem"
                          style={{ background: p.space_color || 'var(--sh-ink)' }}
                        >
                          {initialOf(p.space_name)[0]}
                        </span>
                        {p.space_name}
                      </button>
                    </>
                  )}
                  {p.folder_name && (
                    <>
                      <span className="td-also-sep">›</span>
                      <button
                        type="button"
                        className="td-also-seg"
                        onClick={() => goToPathFolder(p)}
                        title={`Go to ${p.folder_name}`}
                      >
                        {p.folder_name}
                      </button>
                    </>
                  )}
                  <span className="td-also-sep">›</span>
                  <button
                    type="button"
                    className="td-also-seg td-also-list"
                    onClick={() => goToPathList(p)}
                    title={`Go to ${p.list_name}`}
                  >
                    {p.list_name}
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      className="td-also-remove"
                      title="Remove from this list"
                      aria-label={`Remove from ${p.list_name}`}
                      onClick={() => removeFromList.mutate(p.list_id)}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

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
              <div className="td-title-row flex items-start gap-3" style={{ marginBottom: 14 }}>
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
                    {task.description ? linkifyText(task.description) : (isMobile ? 'Tap to add a description…' : 'Click to add a description…')}
                  </div>
                )}
              </div>

              {(currentType?.key === 'design_task' || currentType?.key === 'video_edit_task') && customFields.length > 0 && (
                <>
                  <div className="td-section-strong" style={{ marginTop: 4 }}>
                    {currentType?.key === 'video_edit_task' ? (
                      <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    ) : (
                      <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    )}
                    <span className="title">{currentType?.key === 'video_edit_task' ? 'Video Editing Brief' : 'Design Details'}</span>
                  </div>
                  <div className="td-design-form" style={{ marginBottom: 12 }}>
                    {groupDesignFields(customFields).map((group) =>
                      group.length === 2 ? (
                        <div className="td-field-pair" key={group[0].id}>
                          {group.map((field) => (
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
                      ) : (
                        <CustomFieldRow
                          key={group[0].id}
                          field={group[0]}
                          value={customValues[group[0].key]}
                          onChange={(v) => updateCustomField(group[0].key, v)}
                          otherValue={customValues[group[0].key + '_other']}
                          onOtherChange={(v) => updateCustomField(group[0].key + '_other', v)}
                          canEdit={canEdit}
                        />
                      )
                    )}
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
                {/* Resource source — mirrored tasks link back to their page/section. */}
                {(task.source_kind === 'course' || task.source_kind === 'sop' || task.source_kind === 'post') && (
                  <div className="td-settings-row" data-half="false" style={{ gridColumn: '1 / -1', cursor: 'default' }}>
                    <span className="k">{META_ICONS.Type}Resource</span>
                    <span className="v">
                      <button
                        type="button"
                        onClick={openLearning}
                        className="td-prop-chip"
                        style={{ cursor: 'pointer', background: 'var(--surface-alt)', color: 'var(--sh-ink)' }}
                      >
                        Open {task.source_kind === 'sop' ? 'SOP' : task.source_kind === 'course' ? 'Course' : 'Post'} ↗
                      </button>
                    </span>
                  </div>
                )}
                <div className="td-m-group" data-td-group="status">
                {/* Type — read-only; resolved from the cached useTaskTypes() list
                    since /pm/tasks/:id doesn't hydrate the task_type join */}
                <div className="td-settings-row" data-half="true" data-td="type" style={{ cursor: 'default' }}>
                  <span className="k">{META_ICONS.Type}Type</span>
                  <span className="v">
                    {displayType ? (
                      <span
                        className="td-prop-chip"
                        style={{
                          background: displayType.color
                            ? `color-mix(in oklch, ${displayType.color} 14%, transparent)`
                            : 'var(--surface-alt)',
                          color: displayType.color || 'var(--sh-ink-3)',
                        }}
                      >
                        <span className="dot" style={{ background: displayType.color || 'var(--sh-ink-4)' }} />
                        {displayType.name}
                      </span>
                    ) : (
                      <span className="td-prop-empty">—</span>
                    )}
                  </span>
                </div>

                {/* Status */}
                <div
                  className="td-settings-row"
                  data-half="true"
                  data-td="status"
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
                  data-td="priority"
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
                </div>

                <div className="td-m-group" data-td-group="plan">
                {/* Work date */}
                <div
                  className="td-settings-row td-date-row"
                  data-half="true"
                  data-td="work"
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
                        isMobile ? formatPlanDate(task.work_date) : formatDueRelative(task.work_date).text
                      ) : (
                        <span className="td-prop-empty">{isMobile ? 'Set date' : 'Set work date'}</span>
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
                  data-td="start"
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
                        isMobile ? formatPlanDate(task.start_date) : formatDueRelative(task.start_date).text
                      ) : (
                        <span className="td-prop-empty">{isMobile ? 'Set date' : 'Set start date'}</span>
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
                  data-td="due"
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
                          {isMobile ? formatPlanDate(task.due_date) : `${due.text}${due.accent ? ' · Overdue' : ''}`}
                        </span>
                      ) : (
                        <span className="td-prop-empty">{isMobile ? 'Set date' : 'Set due date'}</span>
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

                {/* Repeat — template shows its rule; a spawned copy links back
                    to its routine; plain tasks can become routines here. */}
                <div
                  className="td-settings-row"
                  data-half="true"
                  data-td="repeat"
                  style={{ cursor: canEdit || task.recurring_parent_id ? 'pointer' : 'default' }}
                  onClick={(e) => {
                    if (task.recurring_parent_id) {
                      setActiveTask(task.recurring_parent_id);
                      return;
                    }
                    if (!canEdit) return;
                    setRepeatAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
                    setRepeatOpen((v) => !v);
                  }}
                >
                  <span className="k">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }} aria-hidden>
                      <path d="m17 2 4 4-4 4" />
                      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                      <path d="m7 22-4-4 4-4" />
                      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
                    </svg>
                    Repeat
                  </span>
                  <span className="v">
                    {task.recurring_parent_id ? (
                      <span className="td-date-text" title="Open the routine this task came from">
                        Part of a routine ↗
                      </span>
                    ) : task.recurrence ? (
                      <span className="td-date-text">
                        {describeTaskRecurrence(task.recurrence as TaskRecurrence)}
                        {task.recurrence_paused ? ' · Paused' : ''}
                      </span>
                    ) : (
                      <span className="td-prop-empty">Does not repeat</span>
                    )}
                  </span>
                </div>

                {/* Estimate */}
                <div
                  className="td-settings-row"
                  data-half="true"
                  data-td="estimate"
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

                {/* Time logged */}
                <div
                  className="td-settings-row"
                  data-half="true"
                  data-td="time"
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
                      <span className="td-prop-empty">{isMobile ? '0m' : '0h logged'}</span>
                    )}
                  </span>
                </div>

                {/* Elapsed (idle) — read-only, design/video spaces only. A
                    per-space/day figure (not task-specific); managers edit it in
                    the space Reports tab. Hidden when the folder has none today. */}
                {elapsedTodaySeconds > 0 && (
                  <div className="td-settings-row" data-half="true" data-td="elapsed" style={{ cursor: 'default' }}>
                    <span className="k">{META_ICONS.Estimate}Elapsed (idle)</span>
                    <span className="v">
                      <span title="Idle-day time elapsed for this space today. Edit it in the space's Reports tab.">
                        {formatTracked(elapsedTodaySeconds) || '0m'}
                      </span>
                    </span>
                  </div>
                )}
                </div>

                <div className="td-m-group" data-td-group="labels">
                <div
                  className="td-settings-row"
                  data-half="true"
                  data-td="labels"
                  role={canEdit ? 'button' : undefined}
                  tabIndex={canEdit ? 0 : undefined}
                  onClick={canEdit ? (e) => {
                    setLabelAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect());
                    setLabelPickerOpen((v) => !v);
                  } : undefined}
                  style={canEdit ? { cursor: 'pointer' } : undefined}
                >
                  <span className="k">{META_ICONS.Labels}Labels</span>
                  <span className="v" style={{ flexWrap: 'wrap', gap: 6 }}>
                    {task.tags && task.tags.length > 0 ? (
                      task.tags.map((t) => (
                        <span
                          key={t.id}
                          className="td-hashtag"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <span style={{ width: 8, height: 8, borderRadius: 9999, background: t.color || '#6b7280', display: 'inline-block' }} aria-hidden />
                          {t.name}
                          {canEdit && (
                            <span
                              role="button"
                              aria-label={`Remove ${t.name}`}
                              onClick={(e) => { e.stopPropagation(); if (task) detachLabel.mutate(t.id); }}
                              style={{ cursor: 'pointer', opacity: 0.6, paddingLeft: 2 }}
                            >
                              ×
                            </span>
                          )}
                        </span>
                      ))
                    ) : (
                      <span className="td-prop-empty">+ Add label</span>
                    )}
                  </span>
                </div>
                </div>

                <div className="td-m-group" data-td-group="created">
                <div className="td-settings-row" data-half="true" data-td="created" style={{ gridColumn: '1 / -1', borderRight: 'none', borderBottom: 'none' }}>
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
              </div>

              {/* Custom fields for other types (not design/video, which render their
                  brief above) — render before sections */}
              {currentType?.key !== 'design_task' && currentType?.key !== 'video_edit_task' && customFields.length > 0 && (
                <div className="td-design-form mb-2 mt-3">
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
                            void handleSubtaskToggle(st, e);
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
                  {activityItems.length === 0 ? (
                    <div className="text-[12.5px] text-[color:var(--sh-ink-4)]">No activity yet.</div>
                  ) : activityItems.map((a, i) => (
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

      {incompletePrompt && task && (
        <IncompleteItemsDialog
          anchorRect={incompletePrompt.rect}
          openSubtasks={incompletePrompt.subtasks}
          openChecklistItems={incompletePrompt.checklist}
          onViewTask={incompletePrompt.subtaskId ? () => {
            // The blocked subtask's own open items aren't visible here —
            // open it in the panel (mirrors TaskRow's "View open items").
            const id = incompletePrompt.subtaskId!;
            setIncompletePrompt(null);
            setActiveTask(id);
          } : undefined}
          onClose={() => setIncompletePrompt(null)}
        />
      )}

      {noAssigneePrompt && task && (
        <NoAssigneeCompleteDialog
          anchorRect={noAssigneePrompt.rect}
          canAssignToMe={!!currentUser?.id}
          onAssignToMe={() => {
            const sub = noAssigneePrompt.subtaskId;
            const me = currentUser?.id ? [currentUser.id] : undefined;
            if (sub) completeSubtask(sub, me);
            else completeToDone(me);
            setNoAssigneePrompt(null);
          }}
          onAssignOther={() => {
            setAssignCompleteAnchor(noAssigneePrompt);
            setNoAssigneePrompt(null);
          }}
          onCompleteAnyway={() => {
            if (noAssigneePrompt.subtaskId) completeSubtask(noAssigneePrompt.subtaskId);
            else completeToDone();
            setNoAssigneePrompt(null);
          }}
          onClose={() => setNoAssigneePrompt(null)}
        />
      )}

      {assignCompleteAnchor && task && (
        <AssigneePicker
          taskId={assignCompleteAnchor.subtaskId || task.id}
          currentAssigneeIds={[]}
          anchorRect={assignCompleteAnchor.rect}
          onChange={(ids) => {
            // Picking someone assigns them and completes in one write. An empty
            // selection (Unassign all) just completes unassigned.
            if (assignCompleteAnchor.subtaskId) completeSubtask(assignCompleteAnchor.subtaskId, ids);
            else completeToDone(ids);
            setAssignCompleteAnchor(null);
          }}
          onClose={() => setAssignCompleteAnchor(null)}
        />
      )}

      {labelPickerOpen && task && (
        <LabelPicker
          taskId={task.id}
          attachedTagIds={(task.tags || []).map((t) => t.id)}
          anchorRect={labelAnchorRect}
          onClose={() => setLabelPickerOpen(false)}
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

      {repeatOpen && task && (
        <RepeatPicker
          anchorRect={repeatAnchor}
          value={(task.recurrence as TaskRecurrence | null) ?? null}
          onChange={(next) => updateTask.mutate({ id: task.id, recurrence: next } as any)}
          onClose={() => setRepeatOpen(false)}
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

      {showReport && task && (
        <SopBreachReportModal
          targetUserId={assignees[0]?.id || (task as any).created_by || currentUser?.id || ''}
          targetUserName={assignees[0]?.display_name || assignees[0]?.email || 'assignee'}
          sourceKind="task"
          sourceId={task.id}
          onClose={() => setShowReport(false)}
          onReported={(detail) => setFlagDetail(detail)}
        />
      )}
      {flagDetail && <SopFlagDetailModal detail={flagDetail} onClose={() => setFlagDetail(null)} />}
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
  Type: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 12l9 4 9-4M3 17l9 4 9-4" />
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
  const str = typeof value === 'string' ? value : value == null ? '' : String(value);
  const otherStr = typeof otherValue === 'string' ? otherValue : '';
  const ghost = field.placeholder || `Add ${field.label.toLowerCase()}…`;
  const dim = canEdit ? '' : ' opacity-70';

  // Checkbox is an inline exception — box + label on one row, no label header.
  if (field.field_type === 'checkbox') {
    return (
      <div className="td-field td-field--check">
        <label className="td-check-row">
          <input type="checkbox" checked={!!value} disabled={!canEdit} onChange={(e) => onChange(e.target.checked)} />
          <span className="td-check-box">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5 9-11" />
            </svg>
          </span>
          <span>
            {field.label}
            {field.is_required && <span className="req"> *</span>}
          </span>
        </label>
      </div>
    );
  }

  let control: React.ReactNode = null;

  switch (field.field_type) {
    case 'textarea':
      control = (
        <textarea
          defaultValue={str}
          placeholder={ghost}
          disabled={!canEdit}
          onBlur={(e) => e.target.value !== str && onChange(e.target.value || null)}
          rows={2}
          className={`td-input-shell${dim}`}
        />
      );
      break;
    case 'select':
      control = (
        <div className="td-select-wrap">
          <select
            value={str}
            disabled={!canEdit}
            onChange={(e) => onChange(e.target.value || null)}
            className={`td-input-shell${dim}`}
          >
            <option value="">—</option>
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <svg className="chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      );
      break;
    case 'multi_select': {
      const arr: string[] = Array.isArray(value) ? (value as string[]) : [];
      const otherSelected = arr.includes('__other__') || (field.allow_other && !!otherStr);
      const Check = (
        <span className="chip-check">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5 9-11" />
          </svg>
        </span>
      );
      control = (
        <div className="td-chip-group">
          <div className="td-chip-row">
            {field.options.map((o) => {
              const on = arr.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  disabled={!canEdit}
                  onClick={() => onChange(on ? arr.filter((v) => v !== o.value) : [...arr, o.value])}
                  className={`td-chip${on ? ' is-on' : ''}${dim}`}
                >
                  {Check}
                  {o.label}
                </button>
              );
            })}
            {field.allow_other && (
              <button
                key="__other__"
                type="button"
                aria-pressed={!!otherSelected}
                disabled={!canEdit}
                onClick={() => {
                  if (otherSelected) {
                    onChange(arr.filter((v) => v !== '__other__'));
                    onOtherChange?.(null);
                  } else if (!arr.includes('__other__')) {
                    onChange([...arr, '__other__']);
                  }
                }}
                className={`td-chip${otherSelected ? ' is-on' : ''}${dim}`}
              >
                {Check}
                Other
              </button>
            )}
          </div>
          {field.allow_other && otherSelected && (
            <input
              type="text"
              defaultValue={otherStr}
              placeholder="Describe what you need…"
              disabled={!canEdit}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== otherStr) onOtherChange?.(v || null);
              }}
              className={`td-input-shell td-chip-other-input${dim}`}
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
          inputMode="numeric"
          defaultValue={str}
          placeholder={ghost}
          disabled={!canEdit}
          onBlur={(e) => {
            const v = e.target.value;
            onChange(v === '' ? null : Number(v));
          }}
          className={`td-input-shell${dim}`}
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
          className={`td-input-shell${dim}`}
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
          className={`td-input-shell${dim}`}
        />
      );
      break;
    case 'text':
    default:
      control = (
        <input
          type="text"
          defaultValue={str}
          placeholder={ghost}
          disabled={!canEdit}
          onBlur={(e) => e.target.value !== str && onChange(e.target.value || null)}
          className={`td-input-shell${dim}`}
        />
      );
  }

  return (
    <div className="td-field">
      <div className="td-field-label">
        <span className="lbl">
          {field.label}
          {field.is_required && <span className="req">*</span>}
        </span>
        {field.help_url && (
          <a
            href={field.help_url}
            target="_blank"
            rel="noopener noreferrer"
            className="td-field-help"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17L17 7M9 7h8v8" />
            </svg>
            View size chart
          </a>
        )}
      </div>
      {control}
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
        {current?.name || (taskStatusCategory ? ({ todo: 'To Do', active: 'Active', done: 'Done', closed: 'Closed' }[taskStatusCategory] ?? taskStatusCategory) : 'No status')}
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
