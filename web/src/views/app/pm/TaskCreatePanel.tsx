import { useEffect, useMemo, useRef, useState } from 'react';
import { useCreateTask } from '../../../hooks/useTasks';
import { useAssignableUsersByList } from '../../../hooks/useAssignableUsers';
import { useTaskTypes } from '../../../hooks/useTaskTypes';
import { useSpace } from '../../../hooks/useSpaces';
import { useAuthStore } from '../../../stores/authStore';
import type { SpaceStatus, Task, TaskPriority, TaskStatusKey, TaskTypeField, TaskRecurrence } from '@squadhub/shared';
import { getTaskStatusDef, describeTaskRecurrence } from '@squadhub/shared';
import api from '../../../services/api';
import AssigneePicker from './AssigneePicker';
import DatePicker from './DatePicker';
import RepeatPicker from './RepeatPicker';
import EmergencyConfirm from './EmergencyConfirm';
import ListPickerCombobox from './ListPickerCombobox';
import TaskStatusPicker from './TaskStatusPicker';
import { nextQuickDate } from './taskHelpers';
import { useDraftTaskStore, type SerializableDraft } from '../../../stores/draftTaskStore';
import { usePMStore } from '../../../stores/pmStore';
import { showToast } from '../../../components/Toast';
import { usePanelFileDrop } from './usePanelFileDrop';
import { inputTimeToMinute, type Recurrence } from '../../../utils/workBlockRecurrence';

/* -------------------------------------------------------------------------- */
/* Helpers (duplicated from TaskDetailPanel — keep in sync if they change)    */
/* -------------------------------------------------------------------------- */

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

function tempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileExtension(name: string): string {
  return name.split('.').pop()?.toUpperCase().slice(0, 4) || 'FILE';
}

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

function formatDueRelative(iso: string | null | undefined): { text: string; accent: boolean } {
  if (!iso) return { text: 'No due date', accent: false };
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

const PRIORITY_ORDER: TaskPriority[] = ['urgent', 'high', 'normal', 'low', 'none', 'emergency'];

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
      <path d="M4 22V15" />
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
};

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

type DraftSubtask = { id: string; title: string };
type DraftChecklistItem = { id: string; content: string; is_done: boolean };
type DraftChecklist = { id: string; title: string; items: DraftChecklistItem[] };
type DraftFile = { id: string; file: File };

type Draft = {
  title: string;
  description: string;
  status: string;
  priority: TaskPriority;
  assignee_ids: string[];
  work_date: string | null;
  start_date: string | null;
  due_date: string | null;
  task_type_id: string | null;
  time_estimate: number | null;
  recurrence: TaskRecurrence | null;
  subtasks: DraftSubtask[];
  checklists: DraftChecklist[];
  pendingFiles: DraftFile[];
};

function makeDraft(defaultStatus: string | undefined): Draft {
  return {
    title: '',
    description: '',
    status: defaultStatus || 'todo',
    priority: 'none',
    assignee_ids: [],
    work_date: null,
    start_date: null,
    due_date: null,
    task_type_id: null,
    time_estimate: null,
    recurrence: null,
    subtasks: [],
    checklists: [],
    pendingFiles: [],
  };
}

function isDraftNonEmpty(d: Draft): boolean {
  return (
    d.title.trim().length > 0 ||
    d.description.trim().length > 0 ||
    d.assignee_ids.length > 0 ||
    d.subtasks.length > 0 ||
    d.checklists.length > 0 ||
    d.pendingFiles.length > 0 ||
    d.work_date !== null ||
    d.start_date !== null ||
    d.due_date !== null ||
    d.time_estimate !== null ||
    d.recurrence !== null ||
    d.priority !== 'none'
  );
}

export default function TaskCreatePanel({
  statuses,
  listId,
  defaultStatus,
  spaceName,
  spaceColor,
  folderName,
  listName,
  onClose,
  onCreated,
  pickable = false,
  workspaceId,
  initialSpaceId,
  initialListId,
  initialDraft,
  isDesignTask = false,
  customTaskTypeKey = 'design_task',
  designTaskTypeId,
}: {
  statuses?: SpaceStatus[];
  listId?: string;
  /** Status category to pre-select (e.g. 'todo'). Falls back to first status. */
  defaultStatus?: string;
  spaceName?: string;
  spaceColor?: string | null;
  folderName?: string | null;
  listName?: string | null;
  onClose: () => void;
  onCreated?: (newTask: Task) => void;
  /** When true, render space/folder/list pickers at the top and derive listId + statuses from selection. */
  pickable?: boolean;
  workspaceId?: string;
  initialSpaceId?: string | null;
  initialListId?: string | null;
  /** Pre-fill with a saved draft. _draftId is used to clean up on submit/re-save. */
  initialDraft?: SerializableDraft & { _draftId?: string };
  /** When true, show the structured-brief section with type-specific custom fields. */
  isDesignTask?: boolean;
  /** Which task type to render the brief for. Defaults to 'design_task' for back-compat. */
  customTaskTypeKey?: 'design_task' | 'video_edit_task';
  /** The task type ID. Used when isDesignTask is true. */
  designTaskTypeId?: string | null;
}) {
  // Picker-mode state — spaceId is derived from the selected list (combobox hands both back)
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(initialSpaceId ?? null);
  const [selectedListId, setSelectedListId] = useState<string | null>(initialListId ?? null);

  // Load the selected space for statuses + selected list metadata (name/color)
  const { data: spaceData } = useSpace(pickable ? selectedSpaceId : null);

  // Selected list info (name + parent folder name, picker mode)
  const selectedListInfo = useMemo(() => {
    if (!pickable || !selectedListId || !spaceData) return null;
    const direct = (spaceData.lists || []).find((l) => l.id === selectedListId);
    if (direct) return { name: direct.name, folderName: null as string | null };
    for (const f of spaceData.folders || []) {
      const inFolder = (f.lists || []).find((l) => l.id === selectedListId);
      if (inFolder) return { name: inFolder.name, folderName: f.name };
    }
    return null;
  }, [pickable, selectedListId, spaceData]);

  // Derived effective values — switch between prop-fed (fixed mode) and state-fed (picker mode)
  const effectiveListId = pickable ? selectedListId : (listId ?? null);
  const needsListForAssignee = pickable && !effectiveListId;
  const effectiveStatuses = useMemo<SpaceStatus[]>(
    () => (pickable ? (spaceData?.statuses || []) : (statuses || [])),
    [pickable, spaceData?.statuses, statuses],
  );
  const effectiveSpaceName = pickable ? spaceData?.name : spaceName;
  const effectiveSpaceColor = pickable ? (spaceData?.color ?? null) : (spaceColor ?? null);
  const effectiveFolderName = pickable ? (selectedListInfo?.folderName ?? null) : (folderName ?? null);
  const effectiveListName = pickable ? (selectedListInfo?.name ?? null) : (listName ?? null);

  const createTask = useCreateTask(effectiveListId);
  const { data: assignableUsers = [] } = useAssignableUsersByList(effectiveListId);
  const assignableMap = useMemo(() => {
    const m = new Map<string, { display_name: string; email?: string }>();
    for (const u of assignableUsers) m.set(u.id, { display_name: u.display_name || u.email || '', email: u.email });
    return m;
  }, [assignableUsers]);
  const { data: taskTypes } = useTaskTypes();
  const currentUser = useAuthStore((s) => s.user);

  const designType = useMemo(
    () => (isDesignTask ? taskTypes?.find((t) => t.key === customTaskTypeKey) || null : null),
    [isDesignTask, customTaskTypeKey, taskTypes],
  );
  const isVideoTask = isDesignTask && customTaskTypeKey === 'video_edit_task';
  const designFields: TaskTypeField[] = designType?.fields || [];
  const [designCustom, setDesignCustom] = useState<Record<string, unknown>>({});
  const setDesignField = (key: string, v: unknown) =>
    setDesignCustom((prev) => {
      const next = { ...prev };
      if (v == null || (Array.isArray(v) && v.length === 0) || v === '') delete next[key];
      else next[key] = v;
      return next;
    });

  const initialStatus = defaultStatus || effectiveStatuses[0]?.name || 'todo';
  const [draft, setDraft] = useState<Draft>(() => {
    if (initialDraft) {
      // Older persisted drafts predate `recurrence` — default it.
      return { recurrence: null, ...initialDraft, pendingFiles: [] };
    }
    return makeDraft(initialStatus);
  });
  const [mounted, setMounted] = useState(false);

  // When the task type resolves (or changes) normalize draft.status.
  // - task_type='task': status must be a TASK_STATUS_CATALOG key (default 'open')
  // - other types: status must match a space_status.category (default first)
  useEffect(() => {
    const typeKey = (taskTypes?.find((t) => t.id === draft.task_type_id) as { key?: string } | undefined)?.key;
    if (typeKey === 'task') {
      if (!getTaskStatusDef(draft.status)) {
        const legacyMap: Record<string, TaskStatusKey> = {
          todo: 'open',
          active: 'in_progress',
          done: 'closed',
          closed: 'closed',
        };
        setDraft((d) => ({ ...d, status: legacyMap[d.status] || 'open' }));
      }
      return;
    }
    if (!effectiveStatuses.length) return;
    if (effectiveStatuses.some((s) => s.name === draft.status)) return;
    setDraft((d) => ({ ...d, status: effectiveStatuses[0].name }));
  }, [effectiveStatuses, draft.status, draft.task_type_id, taskTypes]);

  // Popover / menu anchors
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const [priorityAnchor, setPriorityAnchor] = useState<DOMRect | null>(null);
  const [pendingEmergency, setPendingEmergency] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [typeAnchor, setTypeAnchor] = useState<DOMRect | null>(null);
  // Work-block fields — only used when currentType.key === 'work_block'.
  const [wbStartTime, setWbStartTime] = useState('09:00');
  const [wbEndTime, setWbEndTime] = useState('10:00');
  const [wbRecurrence, setWbRecurrence] = useState<Recurrence>({ kind: 'none' });
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [assigneeAnchorRect, setAssigneeAnchorRect] = useState<DOMRect | null>(null);
  const [workDateOpen, setWorkDateOpen] = useState(false);
  const [workDateAnchor, setWorkDateAnchor] = useState<DOMRect | null>(null);
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [startDateAnchor, setStartDateAnchor] = useState<DOMRect | null>(null);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [dueDateAnchor, setDueDateAnchor] = useState<DOMRect | null>(null);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [repeatAnchor, setRepeatAnchor] = useState<DOMRect | null>(null);
  const [editingEstimate, setEditingEstimate] = useState(false);
  const [estimateInput, setEstimateInput] = useState('');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState<string | null>(null);
  const [newChecklistTitle, setNewChecklistTitle] = useState<string | null>(null);
  const [newItemDrafts, setNewItemDrafts] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [focusOnCreate, setFocusOnCreate] = useState(false);
  const toggleFocusToday = usePMStore((s) => s.toggleFocusToday);
  const filePickerRef = useRef<HTMLInputElement>(null);

  // Default task type, once the list of types is available.
  useEffect(() => {
    if (!taskTypes || !taskTypes.length) return;
    if (isDesignTask && designType) {
      if (draft.task_type_id !== designType.id) setDraft((d) => ({ ...d, task_type_id: designType.id }));
      return;
    }
    if (draft.task_type_id) return;
    const def = taskTypes.find((t) => t.is_default) || taskTypes[0];
    if (def) setDraft((d) => ({ ...d, task_type_id: def.id }));
  }, [taskTypes, draft.task_type_id, isDesignTask, designType]);

  // Slide-in mount animation, matches TaskDetailPanel
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const currentStatus = useMemo(
    () => effectiveStatuses.find((s) => s.name === draft.status),
    [effectiveStatuses, draft.status],
  );
  const currentType = useMemo(
    () => taskTypes?.find((t) => t.id === draft.task_type_id) || null,
    [taskTypes, draft.task_type_id],
  );
  const priorityLabel = PRIORITY_LABEL[draft.priority];
  const dueInfo = formatDueRelative(draft.due_date);

  const canSubmit = draft.title.trim().length > 0
    && !!effectiveListId
    && !submitting
    && (!isDesignTask || draft.description.trim().length > 0);

  const handleClose = () => {
    if (isDraftNonEmpty(draft)) {
      // If resuming an existing draft, remove the old version first
      if (initialDraft?._draftId) {
        useDraftTaskStore.getState().removeDraft(initialDraft._draftId);
      }
      const { pendingFiles, ...serializable } = draft;
      useDraftTaskStore.getState().saveDraft(serializable, selectedSpaceId, effectiveListId);
      showToast('Draft saved');
    } else if (initialDraft?._draftId) {
      // Draft was emptied out — remove the old one
      useDraftTaskStore.getState().removeDraft(initialDraft._draftId);
    }
    onClose();
  };

  // Keep a stable ref to handleClose so the ESC listener doesn't re-register on every draft change
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;

  // Escape to close — ignore when focus is in an editable element
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      handleCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSubmit = async () => {
    const title = draft.title.trim();
    if (!title || !effectiveListId) return;
    setSubmitting(true);
    try {
      // Build design metadata if this is a design task
      let metadata: Record<string, unknown> | undefined;
      if (isDesignTask && Object.keys(designCustom).length > 0) {
        const briefTypeField = designFields.find((f) => f.key === 'brief_type');
        const briefTypeArr = (designCustom['brief_type'] as string[] | undefined) || [];
        const categoryLabel = briefTypeArr
          .map((v) =>
            v === '__other__'
              ? (designCustom['brief_type_other'] as string) || 'Other'
              : briefTypeField?.options.find((o) => o.value === v)?.label || v
          )
          .filter(Boolean)[0];
        metadata = { custom: designCustom, ...(categoryLabel ? { category: categoryLabel } : {}) };
      }

      const newTask = await createTask.mutateAsync({
        title,
        description: draft.description.trim() || undefined,
        status: draft.status,
        priority: draft.priority === 'none' ? undefined : draft.priority,
        assignee_ids: draft.assignee_ids.length ? draft.assignee_ids : undefined,
        work_date: draft.work_date || undefined,
        start_date: draft.start_date || undefined,
        due_date: draft.due_date || undefined,
        task_type_id: isDesignTask ? (designTaskTypeId || designType?.id || draft.task_type_id || undefined) : (draft.task_type_id || undefined),
        list_id: effectiveListId,
        recurrence: draft.recurrence || undefined,
        ...(metadata ? { metadata } : {}),
      });

      if (focusOnCreate) toggleFocusToday(newTask.id);

      // Work-block config — write iff the user picked the work_block type.
      // Failure here doesn't roll back the task: the user can edit the
      // schedule later from the detail panel.
      if (currentType?.key === 'work_block') {
        const startMin = inputTimeToMinute(wbStartTime);
        const endMin = inputTimeToMinute(wbEndTime);
        if (endMin > startMin) {
          try {
            await api.post(`/pm/work-blocks/${newTask.id}`, {
              start_minute: startMin,
              end_minute: endMin,
              recurrence: wbRecurrence,
            });
          } catch (err) {
            console.error('Failed to save work-block config:', err);
            showToast('Task created, but couldn’t save the schedule');
          }
        }
      }

      // Subtasks
      for (const st of draft.subtasks) {
        try {
          await api.post('/pm/tasks', {
            title: st.title,
            parent_task_id: newTask.id,
            list_id: newTask.list_id,
          });
        } catch (err) {
          console.error('Failed to create subtask:', err);
        }
      }

      // Checklists + items
      for (const cl of draft.checklists) {
        try {
          const res = await api.post(`/pm/tasks/${newTask.id}/checklists`, { title: cl.title });
          const checklistId: string = res.data.data.id;
          for (const it of cl.items) {
            try {
              await api.post(`/pm/checklists/${checklistId}/items`, { content: it.content });
            } catch (err) {
              console.error('Failed to create checklist item:', err);
            }
          }
        } catch (err) {
          console.error('Failed to create checklist:', err);
        }
      }

      // Files
      for (const df of draft.pendingFiles) {
        try {
          const presign = await api.post('/pm/task-attachments/presign', {
            task_id: newTask.id,
            filename: df.file.name,
            content_type: df.file.type || 'application/octet-stream',
            file_size: df.file.size,
          });
          const { upload_url, key } = presign.data.data;
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', upload_url);
            xhr.setRequestHeader('Content-Type', df.file.type || 'application/octet-stream');
            xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
            xhr.onerror = () => {
              try {
                const isCrossOrigin = new URL(upload_url).origin !== window.location.origin;
                reject(new Error(isCrossOrigin
                  ? 'Upload blocked — storage CORS not configured for this domain'
                  : 'Network error — check your connection and try again'));
              } catch { reject(new Error('Upload failed')); }
            };
            xhr.send(df.file);
          });
          await api.post('/pm/task-attachments/confirm', {
            task_id: newTask.id,
            object_key: key,
            file_name: df.file.name,
            mime_type: df.file.type || 'application/octet-stream',
          });
        } catch (err) {
          console.error('Failed to upload file:', err);
        }
      }

      // Clean up the draft if we were resuming one
      if (initialDraft?._draftId) {
        useDraftTaskStore.getState().removeDraft(initialDraft._draftId);
      }
      onCreated?.(newTask);
      onClose();
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const addDraftSubtask = (title: string, keepInputOpen: boolean) => {
    const t = title.trim();
    if (!t) {
      setNewSubtaskTitle(null);
      return;
    }
    setDraft((d) => ({ ...d, subtasks: [...d.subtasks, { id: tempId(), title: t }] }));
    setNewSubtaskTitle(keepInputOpen ? '' : null);
  };

  const removeDraftSubtask = (id: string) => {
    setDraft((d) => ({ ...d, subtasks: d.subtasks.filter((s) => s.id !== id) }));
  };

  const addDraftChecklist = (title: string) => {
    const t = title.trim();
    if (!t) {
      setNewChecklistTitle(null);
      return;
    }
    setDraft((d) => ({ ...d, checklists: [...d.checklists, { id: tempId(), title: t, items: [] }] }));
    setNewChecklistTitle(null);
  };

  const removeDraftChecklist = (id: string) => {
    setDraft((d) => ({ ...d, checklists: d.checklists.filter((c) => c.id !== id) }));
  };

  const addDraftChecklistItem = (checklistId: string, content: string) => {
    const t = content.trim();
    if (!t) return;
    setDraft((d) => ({
      ...d,
      checklists: d.checklists.map((c) =>
        c.id === checklistId
          ? { ...c, items: [...c.items, { id: tempId(), content: t, is_done: false }] }
          : c,
      ),
    }));
    setNewItemDrafts((prev) => ({ ...prev, [checklistId]: '' }));
  };

  const toggleDraftChecklistItem = (checklistId: string, itemId: string) => {
    setDraft((d) => ({
      ...d,
      checklists: d.checklists.map((c) =>
        c.id === checklistId
          ? { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, is_done: !i.is_done } : i)) }
          : c,
      ),
    }));
  };

  const removeDraftChecklistItem = (checklistId: string, itemId: string) => {
    setDraft((d) => ({
      ...d,
      checklists: d.checklists.map((c) =>
        c.id === checklistId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c,
      ),
    }));
  };

  const addDraftFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).map((f) => ({ id: tempId(), file: f }));
    setDraft((d) => ({ ...d, pendingFiles: [...d.pendingFiles, ...arr] }));
  };

  const removeDraftFile = (id: string) => {
    setDraft((d) => ({ ...d, pendingFiles: d.pendingFiles.filter((f) => f.id !== id) }));
  };

  const { dragActive: panelDragActive, panelHandlers } = usePanelFileDrop(addDraftFiles);

  // Estimate input commit
  const commitEstimate = () => {
    const mins = parseTimeInput(estimateInput);
    setDraft((d) => ({ ...d, time_estimate: mins }));
    setEditingEstimate(false);
  };

  return (
    <div className="fixed inset-0 z-[90]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: mounted ? 1 : 0,
          background: 'rgba(10,10,10,0.18)',
        }}
        onClick={handleClose}
      />

      {/* Floating drawer */}
      <aside
        onClick={(e) => e.stopPropagation()}
        {...panelHandlers}
        className="td-panel td-panel-luma apple td-shell absolute flex flex-col"
        style={{
          background: 'var(--surface)',
          transform: mounted ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
          transition: 'transform .42s cubic-bezier(0.23, 1, 0.32, 1), opacity .3s ease',
          opacity: mounted ? 1 : 0,
        }}
      >
        {panelDragActive && (
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
        {/* Top bar */}
        <div className="td-head td-head-luma flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="td-nav-btn"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
            </svg>
          </button>
          {pickable && workspaceId ? (
            <ListPickerCombobox
              workspaceId={workspaceId}
              selectedListId={selectedListId}
              selectedListName={effectiveListName}
              selectedSpaceColor={effectiveSpaceColor}
              initialSpaceId={selectedSpaceId}
              onChange={(newListId, newSpaceId) => {
                setSelectedListId(newListId);
                setSelectedSpaceId(newSpaceId);
              }}
              renderTrigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className="td-bcrumb td-focus"
                  title="Choose space, folder, and list"
                >
                  <span className="emblem" style={{ background: effectiveSpaceColor || 'var(--sh-ink)' }}>
                    {effectiveSpaceName ? initialOf(effectiveSpaceName)[0] : '+'}
                  </span>
                  <span className="name">{effectiveSpaceName || 'Choose list'}</span>
                  {effectiveFolderName && (
                    <>
                      <span className="sep">›</span>
                      <span className="name">{effectiveFolderName}</span>
                    </>
                  )}
                  {effectiveListName && (
                    <>
                      <span className="sep">›</span>
                      <span className="name">{effectiveListName}</span>
                    </>
                  )}
                  <svg className="chev" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            />
          ) : (
            effectiveSpaceName && (
              <span className="td-bcrumb">
                <span className="emblem" style={{ background: effectiveSpaceColor || 'var(--sh-ink)' }}>
                  {initialOf(effectiveSpaceName)[0]}
                </span>
                <span className="name">{effectiveSpaceName}</span>
                {effectiveFolderName && (
                  <>
                    <span className="sep">›</span>
                    <span className="name">{effectiveFolderName}</span>
                  </>
                )}
                {effectiveListName && (
                  <>
                    <span className="sep">›</span>
                    <span className="name">{effectiveListName}</span>
                  </>
                )}
              </span>
            )
          )}
          <span className="text-[11.5px] text-[color:var(--sh-ink-4)] font-medium tracking-[0.01em]">
            {isDesignTask ? (isVideoTask ? 'NEW VIDEO TASK' : 'NEW DESIGN TASK') : 'NEW TASK'}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setFocusOnCreate((v) => !v)}
            className="td-nav-btn td-focus-star"
            data-active={focusOnCreate}
            title={focusOnCreate ? 'Will be focused for today — click to remove' : 'Focus today'}
            aria-label={focusOnCreate ? 'Focused for today' : 'Focus today'}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>{focusOnCreate ? '★' : '☆'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (initialDraft?._draftId) {
                useDraftTaskStore.getState().removeDraft(initialDraft._draftId);
                showToast('Draft deleted');
              }
              onClose();
            }}
            className="td-pill-btn"
            style={{ opacity: 0.6 }}
            title="Discard"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="td-pill-btn"
            style={canSubmit ? { background: 'var(--sh-ink)', color: 'var(--surface)', borderColor: 'var(--sh-ink)' } : { opacity: 0.5 }}
            title={isDesignTask ? (isVideoTask ? 'Create video task' : 'Create design task') : 'Create task'}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M5 12l5 5 9-11" />
            </svg>
            {submitting ? 'Creating…' : isDesignTask ? (isVideoTask ? 'Create video task' : 'Create design task') : 'Create task'}
          </button>
        </div>

        {/* Scrollable body */}
        <div className="td-scroll flex-1 overflow-y-auto px-6 pt-3 pb-8">
          {/* Title row */}
          <div className="flex items-start gap-3" style={{ marginBottom: 14 }}>
            <span
              className="mt-[6px] td-checkbox-lg shrink-0"
              data-done="false"
              aria-hidden
            />
            <input
              autoFocus
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Task title"
              className="td-title-hero flex-1 bg-transparent outline-none m-0 placeholder:text-[color:var(--sh-ink-4)]"
            />
          </div>

          {/* Description — boxed right under title (hidden for design tasks, Brief replaces it) */}
          {!isDesignTask && (
            <div className="td-desc-box">
              <span className="td-desc-box-label">Description</span>
              <textarea
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Click to add a description…"
                rows={4}
                className="td-about w-full resize-none bg-transparent outline-none"
              />
            </div>
          )}

          {/* Assignee bar — full-width row */}
          <div
            className="td-assignee-bar td-focus w-full text-left"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              if (needsListForAssignee) { showToast('Select a list or folder to add assignee'); return; }
              setAssigneeAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect());
              setAssigneePickerOpen(v => !v);
            }}
          >
            <span className="label">Assignee</span>
            <span className="value">
              {draft.assignee_ids.length > 0 ? (
                <>
                  <span className="av-stack">
                    {draft.assignee_ids.slice(0, 3).map((id) => {
                      const u = assignableMap.get(id);
                      return (
                        <span
                          key={id}
                          className="td-ava-xs"
                          style={{ background: avatarColor(id), width: 28, height: 28, fontSize: 11 }}
                        >
                          {initialOf(u?.display_name)}
                        </span>
                      );
                    })}
                    {draft.assignee_ids.length > 3 && (
                      <span className="av-more">+{draft.assignee_ids.length - 3}</span>
                    )}
                  </span>
                  <span className="name">
                    {draft.assignee_ids.length === 1
                      ? (assignableMap.get(draft.assignee_ids[0])?.display_name || '1 assignee')
                      : `${draft.assignee_ids.length} assignees`}
                  </span>
                </>
              ) : (
                <>
                  <span className="av-placeholder" aria-hidden />
                  <span className="name muted">{needsListForAssignee ? 'Select a list or folder to add assignee' : 'Unassigned'}</span>
                </>
              )}
            </span>
            {draft.assignee_ids.length > 0 ? (
              <button
                type="button"
                className="reassign"
                onClick={(e) => {
                  e.stopPropagation();
                  if (needsListForAssignee) { showToast('Select a list or folder to add assignee'); return; }
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
                  if (needsListForAssignee) { showToast('Select a list or folder to add assignee'); return; }
                  if (!currentUser?.id) return;
                  setDraft((d) => ({ ...d, assignee_ids: [currentUser!.id!] }));
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21a8 8 0 0116 0" />
                </svg>
                Assign to me
              </button>
            )}
          </div>

          {/* Brief section — only for design / video tasks */}
          {isDesignTask && (
            <>
              <div className="td-section-strong">
                {isVideoTask ? (
                  <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                ) : (
                  <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                )}
                <span className="title">{isVideoTask ? 'Video Editing Brief' : 'Design Details'}</span>
              </div>
              <div className="td-settings-card">
                <div className="td-settings-row" style={{ gridColumn: '1 / -1', borderRight: 'none' }}>
                  <span className="k">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4h12l4 4v12H4z" />
                      <path d="M8 8h8M8 12h6" />
                    </svg>
                    Brief<span style={{ color: 'oklch(0.55 0.18 25)', marginLeft: 2 }}>*</span>
                  </span>
                  <span className="v" style={{ display: 'block' }}>
                    <textarea
                      value={draft.description}
                      onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                      placeholder="Describe what you want. Goals, context, what success looks like."
                      rows={3}
                      className="td-about w-full resize-none bg-transparent outline-none"
                    />
                  </span>
                </div>
                {designFields.map((field) => (
                  <DesignFieldRow
                    key={field.id}
                    field={field}
                    value={designCustom[field.key]}
                    otherValue={designCustom[field.key + '_other']}
                    onChange={(v) => setDesignField(field.key, v)}
                    onOtherChange={(v) => setDesignField(field.key + '_other', v)}
                  />
                ))}
                <VoiceNoteRecorder onAddFile={(f) => addDraftFiles([f])} />
              </div>
            </>
          )}

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
                style={{ cursor: 'pointer' }}
                onClick={currentType?.key !== 'task' ? () => setStatusMenuOpen((v) => !v) : undefined}
              >
                <span className="k">{META_ICONS.Status}Status</span>
                <span className="v">
                  {currentType?.key === 'task' ? (
                    <TaskStatusPicker
                      value={draft.status}
                      onChange={(key) => setDraft((d) => ({ ...d, status: key }))}
                    />
                  ) : (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setStatusMenuOpen((v) => !v); }}
                        className="td-prop-chip"
                        style={{
                          background: currentStatus?.color ? `color-mix(in oklch, ${currentStatus.color} 14%, transparent)` : 'var(--surface-alt)',
                          color: currentStatus?.color || 'var(--sh-ink-3)',
                        }}
                      >
                        <span className="dot" style={{ background: currentStatus?.color || 'var(--sh-ink-4)' }} />
                        {currentStatus?.name || draft.status || 'No status'}
                      </button>
                      {statusMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setStatusMenuOpen(false)} />
                          <div
                            className="absolute left-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border shadow-lg"
                            style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface)' }}
                          >
                            {effectiveStatuses.map((s) => (
                              <button
                                key={s.id}
                                onClick={() => {
                                  setDraft((d) => ({ ...d, status: s.name }));
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
                  )}
                </span>
              </div>

              {/* Priority */}
              <div
                className="td-settings-row"
                data-half="true"
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  setPriorityAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
                  setPriorityMenuOpen((v) => !v);
                }}
              >
                <span className="k">{META_ICONS.Priority}Priority</span>
                <span className="v">
                  {draft.priority === 'emergency' ? (
                    <span className="td-pri-chip" data-level="emg">
                      <span className="dot" />
                      EMERGENCY
                    </span>
                  ) : draft.priority !== 'none' ? (
                    <span className="td-prop-chip" style={{
                      background: 'var(--surface-alt)',
                      color: 'var(--sh-ink-2)',
                      border: '1px solid var(--sh-hair-3)',
                    }}>
                      {PRIORITY_NAME[draft.priority]}
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
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  setWorkDateAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
                  setWorkDateOpen(v => !v);
                }}
              >
                <span className="k">{META_ICONS.WorkDate}Work date</span>
                <span className="v">
                  <span className="td-date-text">
                    {draft.work_date ? (
                      formatDueRelative(draft.work_date).text
                    ) : (
                      <span className="td-prop-empty">Set work date</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="td-date-today-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = nextQuickDate(draft.work_date);
                      setDraft((d) => ({ ...d, work_date: next }));
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
                </span>
              </div>

              {/* Start date */}
              <div
                className="td-settings-row td-date-row"
                data-half="true"
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  setStartDateAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
                  setStartDateOpen(v => !v);
                }}
              >
                <span className="k">{META_ICONS.StartDate}Start date</span>
                <span className="v">
                  <span className="td-date-text">
                    {draft.start_date ? (
                      formatDueRelative(draft.start_date).text
                    ) : (
                      <span className="td-prop-empty">Set start date</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="td-date-today-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = nextQuickDate(draft.start_date);
                      setDraft((d) => ({ ...d, start_date: next }));
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
                </span>
              </div>

              {/* Due date */}
              <div
                className="td-settings-row td-date-row"
                data-half="true"
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  setDueDateAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
                  setDueDateOpen(v => !v);
                }}
              >
                <span className="k">{META_ICONS.Due}Due date</span>
                <span className="v">
                  <span className="td-date-text">
                    {draft.due_date ? (
                      <span style={{ color: dueInfo.accent ? 'oklch(0.55 0.18 25)' : 'var(--sh-ink)' }}>
                        {dueInfo.text}
                      </span>
                    ) : (
                      <span className="td-prop-empty">Set due date</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="td-date-today-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = nextQuickDate(draft.due_date);
                      setDraft((d) => ({ ...d, due_date: next }));
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
                </span>
              </div>

              {/* Repeat — non-null rule creates this task as a routine */}
              <div
                className="td-settings-row"
                data-half="true"
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
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
                  {draft.recurrence ? (
                    <span className="td-date-text">{describeTaskRecurrence(draft.recurrence)}</span>
                  ) : (
                    <span className="td-prop-empty">Does not repeat</span>
                  )}
                </span>
              </div>

              {/* Estimate */}
              <div
                className="td-settings-row"
                data-half="true"
                style={{ cursor: 'pointer' }}
                onClick={!editingEstimate ? () => { setEditingEstimate(true); setEstimateInput(formatMinutes(draft.time_estimate)); } : undefined}
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
                        if (e.key === 'Enter') commitEstimate();
                        if (e.key === 'Escape') setEditingEstimate(false);
                      }}
                      onBlur={commitEstimate}
                      placeholder="e.g. 2h 30m"
                      className="text-[12.5px] bg-transparent border-b outline-none w-28"
                      style={{ borderColor: 'var(--sh-ink)' }}
                    />
                  ) : draft.time_estimate ? (
                    <span>{formatMinutes(draft.time_estimate)}</span>
                  ) : (
                    <span className="td-prop-empty">Add estimate</span>
                  )}
                </span>
              </div>

              {/* Type (hidden for design tasks — auto-set to design_task) */}
              {!isDesignTask && taskTypes && taskTypes.length > 0 && (
                <div
                  className="td-settings-row"
                  data-half="true"
                  style={!(effectiveSpaceName) ? { gridColumn: '1 / -1', borderRight: 'none' } : undefined}
                >
                  <span className="k">{META_ICONS.Space}Type</span>
                  <span className="v">
                    <button
                      type="button"
                      onClick={(e) => {
                        setTypeAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
                        setTypeMenuOpen((v) => !v);
                      }}
                      className="td-prop-chip"
                      style={{
                        background: currentType?.color ? `color-mix(in oklch, ${currentType.color} 14%, transparent)` : 'var(--surface-alt)',
                        color: currentType?.color || 'var(--sh-ink-3)',
                      }}
                    >
                      <span className="dot" style={{ background: currentType?.color || 'var(--sh-ink-4)' }} />
                      {currentType?.name || 'Select type'}
                    </button>
                  </span>
                </div>
              )}

              {/* Work block schedule — only when type is work_block */}
              {currentType?.key === 'work_block' && (
                <div
                  className="td-settings-row"
                  style={{ gridColumn: '1 / -1', borderRight: 'none' }}
                >
                  <span className="k">{META_ICONS.Space}Block</span>
                  <span className="v" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <input
                      type="time"
                      value={wbStartTime}
                      onChange={(e) => setWbStartTime(e.target.value)}
                      className="rounded border px-2 py-1 text-[12.5px]"
                      style={{ borderColor: 'var(--sh-hair-3)', background: 'var(--surface)' }}
                    />
                    <span className="opacity-60 text-[12.5px]">→</span>
                    <input
                      type="time"
                      value={wbEndTime}
                      onChange={(e) => setWbEndTime(e.target.value)}
                      className="rounded border px-2 py-1 text-[12.5px]"
                      style={{ borderColor: 'var(--sh-hair-3)', background: 'var(--surface)' }}
                    />
                    <select
                      value={wbRecurrence.kind}
                      onChange={(e) => {
                        const kind = e.target.value as Recurrence['kind'];
                        setWbRecurrence((r) => ({
                          ...r,
                          kind,
                          weekdays: kind === 'weekly' ? r.weekdays ?? [1] : undefined,
                          day_of_month: kind === 'monthly' ? r.day_of_month ?? 1 : undefined,
                        }));
                      }}
                      className="rounded border px-2 py-1 text-[12.5px]"
                      style={{ borderColor: 'var(--sh-hair-3)', background: 'var(--surface)' }}
                    >
                      <option value="none">Does not repeat</option>
                      <option value="daily">Every day</option>
                      <option value="weekdays">Every weekday</option>
                      <option value="weekly">Weekly on…</option>
                      <option value="monthly">Monthly</option>
                    </select>
                    {wbRecurrence.kind === 'weekly' && (
                      <span style={{ display: 'flex', gap: 4 }}>
                        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, idx) => {
                          const active = wbRecurrence.weekdays?.includes(idx) ?? false;
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() =>
                                setWbRecurrence((r) => {
                                  const set = new Set(r.weekdays || []);
                                  set.has(idx) ? set.delete(idx) : set.add(idx);
                                  return { ...r, weekdays: Array.from(set).sort() };
                                })
                              }
                              className="rounded text-[11px]"
                              style={{
                                width: 22,
                                height: 22,
                                border: `1px solid ${active ? 'var(--sh-accent, #8b5cf6)' : 'var(--sh-hair-3)'}`,
                                background: active ? 'color-mix(in oklch, var(--sh-accent, #8b5cf6) 18%, transparent)' : 'var(--surface)',
                              }}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </span>
                    )}
                    {wbRecurrence.kind === 'monthly' && (
                      <input
                        type="number"
                        min={1}
                        max={28}
                        value={wbRecurrence.day_of_month ?? 1}
                        onChange={(e) =>
                          setWbRecurrence((r) => ({
                            ...r,
                            day_of_month: Math.max(1, Math.min(28, parseInt(e.target.value, 10) || 1)),
                          }))
                        }
                        className="w-14 rounded border px-2 py-1 text-[12.5px]"
                        style={{ borderColor: 'var(--sh-hair-3)', background: 'var(--surface)' }}
                        title="Day of the month"
                      />
                    )}
                  </span>
                </div>
              )}

              {/* Space (read-only) */}
              {effectiveSpaceName && (
                <div
                  className="td-settings-row"
                  data-half="true"
                  style={!(taskTypes && taskTypes.length > 0) ? { gridColumn: '1 / -1', borderRight: 'none' } : undefined}
                >
                  <span className="k">{META_ICONS.Space}Space</span>
                  <span className="v">
                    <span
                      className="td-space-emblem-xs"
                      style={{ background: effectiveSpaceColor || 'var(--sh-ink)' }}
                    >
                      {initialOf(effectiveSpaceName)[0]}
                    </span>
                    <span>{effectiveSpaceName}</span>
                  </span>
                </div>
              )}

              {/* Reporter (full width) */}
              <div className="td-settings-row" data-half="true" style={{ gridColumn: '1 / -1', borderRight: 'none', borderBottom: 'none' }}>
                <span className="k">{META_ICONS.Reporter}Reporter</span>
                <span className="v">
                  {currentUser ? (
                    <>
                      <span className="td-ava-xs" style={{ background: avatarColor(currentUser.id || currentUser.email) }}>
                        {initialOf(currentUser.display_name || currentUser.email)}
                      </span>
                      <span>{currentUser.display_name || currentUser.email}</span>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </span>
              </div>
            </div>
          </div>

          <div className="td-section-rule" />

          {/* Subtasks — prominent */}
          <div className="td-section-strong">
            <svg className="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="7" height="16" rx="1.5" />
              <rect x="14" y="4" width="7" height="10" rx="1.5" />
            </svg>
            <span className="title">Subtasks</span>
            {draft.subtasks.length > 0 && (
              <span className="td-section-count-strong">{draft.subtasks.length}</span>
            )}
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
          </div>
          <div className="td-subtask-list">
            {draft.subtasks.map((st) => (
              <div key={st.id} className="td-subtask-row" data-done="false">
                <span className="td-checkbox shrink-0" data-done="false" aria-hidden />
                <span className="title">{st.title}</span>
                <span className="td-subtask-mini">
                  <span style={{ color: 'var(--sh-ink-4)' }}>—</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeDraftSubtask(st.id)}
                  className="text-[14px] leading-none w-6 h-6 rounded text-[color:var(--sh-ink-4)] hover:text-red-600"
                  title="Remove"
                  aria-label="Remove subtask"
                >
                  ×
                </button>
              </div>
            ))}
            {newSubtaskTitle !== null ? (
              <input
                autoFocus
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addDraftSubtask(newSubtaskTitle, true);
                  } else if (e.key === 'Escape') {
                    e.stopPropagation();
                    setNewSubtaskTitle(null);
                  }
                }}
                onBlur={() => addDraftSubtask(newSubtaskTitle, false)}
                placeholder="Subtask title, Enter to add"
                className="w-full bg-transparent px-3.5 py-2.5 text-[13.5px] outline-none"
                style={{ borderTop: '1px solid var(--sh-hair-3)' }}
              />
            ) : (
              <button
                type="button"
                className="td-subtask-add-row"
                onClick={() => setNewSubtaskTitle('')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>New subtask</span>
                <span className="kbd">↵</span>
              </button>
            )}
          </div>

          <div className="td-section-rule" />

          {/* Checklist */}
          <div className="td-eyebrow" style={{ margin: '0 0 8px' }}>
            Checklist
            {draft.checklists.length > 0 && (() => {
              const allItems = draft.checklists.flatMap((c) => c.items);
              const done = allItems.filter((i) => i.is_done).length;
              return <span className="muted">· {done}/{allItems.length}</span>;
            })()}
            {newChecklistTitle === null && (
              <button className="action" onClick={() => setNewChecklistTitle('')}>+ New list</button>
            )}
          </div>
          {newChecklistTitle !== null && (
            <input
              autoFocus
              value={newChecklistTitle}
              onChange={(e) => setNewChecklistTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addDraftChecklist(newChecklistTitle);
                else if (e.key === 'Escape') setNewChecklistTitle(null);
              }}
              onBlur={() => addDraftChecklist(newChecklistTitle)}
              placeholder="Checklist name, Enter to create"
              className="mb-2 w-full rounded-lg border bg-transparent px-3 py-1.5 text-[13px] outline-none"
              style={{ borderColor: 'var(--sh-hair)' }}
            />
          )}
          {draft.checklists.length > 0 ? (
            <div className="flex flex-col gap-3">
              {draft.checklists.map((cl) => {
                const items = cl.items;
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
                      <button
                        onClick={() => { if (confirm(`Delete checklist "${cl.title}"?`)) removeDraftChecklist(cl.id); }}
                        className="text-[color:var(--sh-ink-4)] hover:text-[color:var(--sh-ink)] text-sm leading-none"
                        title="Delete checklist"
                      >
                        ×
                      </button>
                    </div>
                    <ul className="flex flex-col">
                      {items.map((item) => (
                        <li key={item.id} className="group flex items-center gap-2.5 py-1">
                          <button
                            type="button"
                            onClick={() => toggleDraftChecklistItem(cl.id, item.id)}
                            className="td-checkbox shrink-0"
                            data-done={item.is_done ? 'true' : 'false'}
                            aria-label="Toggle item"
                            style={{ width: 14, height: 14 }}
                          />
                          <span className={`flex-1 text-[12.5px] ${item.is_done ? 'line-through text-[color:var(--sh-ink-4)]' : 'text-[color:var(--sh-ink-2)]'}`}>
                            {item.content}
                          </span>
                          <button
                            onClick={() => removeDraftChecklistItem(cl.id, item.id)}
                            className="text-[color:var(--sh-ink-4)] opacity-0 group-hover:opacity-100 hover:text-[color:var(--sh-ink)]"
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                    <input
                      placeholder="+ Add item"
                      value={newItemDrafts[cl.id] || ''}
                      onChange={(e) => setNewItemDrafts((prev) => ({ ...prev, [cl.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          addDraftChecklistItem(cl.id, newItemDrafts[cl.id] || '');
                        }
                      }}
                      className="mt-1 w-full bg-transparent px-0 py-0.5 text-[12px] outline-none placeholder:text-[color:var(--sh-ink-4)]"
                    />
                  </div>
                );
              })}
            </div>
          ) : !newChecklistTitle ? (
            <div className="text-[12.5px] text-[color:var(--sh-ink-4)]">No checklists.</div>
          ) : null}

          <div className="td-section-rule" />

          {/* Files */}
          <div className="td-eyebrow" style={{ margin: '0 0 8px' }}>
            Files
            {draft.pendingFiles.length > 0 && <span className="muted">· {draft.pendingFiles.length}</span>}
          </div>
          <div className="td-files-wrap">
            <div className="flex flex-col gap-2">
              <div
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
                onDragLeave={(e) => { e.stopPropagation(); setDragOver(false); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOver(false);
                  if (e.dataTransfer.files?.length) addDraftFiles(e.dataTransfer.files);
                }}
                onClick={() => filePickerRef.current?.click()}
                className="cursor-pointer flex items-center justify-center gap-2 rounded-xl border border-dashed py-5 text-[13px] transition-colors"
                style={{
                  borderColor: dragOver ? 'var(--sh-ink-3)' : 'var(--sh-hair-3)',
                  background: dragOver ? 'var(--sh-hair-1, rgba(0,0,0,0.02))' : 'transparent',
                  color: 'var(--sh-ink-2)',
                }}
              >
                <span>Drop files here or click to upload · max 100 MB</span>
                <input
                  ref={filePickerRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) addDraftFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>

              {draft.pendingFiles.map((df) => (
                <div
                  key={df.id}
                  className="td-file flex items-center gap-3 p-3 rounded-xl border"
                  style={{ borderColor: 'var(--sh-hair-3)' }}
                >
                  <div className="td-doc-icon">{fileExtension(df.file.name)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium text-[color:var(--sh-ink)] truncate">{df.file.name}</div>
                    <div className="text-[11.5px] text-[color:var(--sh-ink-3)] mt-0.5">
                      {formatSize(df.file.size)} · Will upload after creation
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeDraftFile(df.id)}
                    className="text-[14px] leading-none w-7 h-7 rounded text-[color:var(--sh-ink-3)] hover:text-red-600 hover:bg-[color:var(--sh-hair-1)]"
                    title="Remove"
                    aria-label="Remove file"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {assigneePickerOpen && effectiveListId && (
        <AssigneePicker
          listId={effectiveListId}
          currentAssigneeIds={draft.assignee_ids}
          anchorRect={assigneeAnchorRect}
          onChange={(ids) => setDraft((d) => ({ ...d, assignee_ids: ids }))}
          onClose={() => setAssigneePickerOpen(false)}
        />
      )}

      {workDateOpen && (
        <DatePicker
          anchorRect={workDateAnchor}
          value={draft.work_date}
          mode="datetime"
          onChange={(next) => setDraft((d) => ({ ...d, work_date: next }))}
          onClose={() => setWorkDateOpen(false)}
        />
      )}

      {startDateOpen && (
        <DatePicker
          anchorRect={startDateAnchor}
          value={draft.start_date}
          mode="datetime"
          onChange={(next) => setDraft((d) => ({ ...d, start_date: next }))}
          onClose={() => setStartDateOpen(false)}
        />
      )}

      {dueDateOpen && (
        <DatePicker
          anchorRect={dueDateAnchor}
          value={draft.due_date}
          mode="datetime"
          onChange={(next) => setDraft((d) => ({ ...d, due_date: next }))}
          onClose={() => setDueDateOpen(false)}
        />
      )}

      {repeatOpen && (
        <RepeatPicker
          anchorRect={repeatAnchor}
          value={draft.recurrence}
          onChange={(next) => setDraft((d) => ({ ...d, recurrence: next }))}
          onClose={() => setRepeatOpen(false)}
        />
      )}

      {typeMenuOpen && typeAnchor && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setTypeMenuOpen(false)} />
          <div
            className="fixed z-[56] w-56 overflow-hidden rounded-xl border shadow-lg"
            style={{
              borderColor: 'var(--sh-hair)',
              background: 'var(--surface)',
              top: Math.min(typeAnchor.bottom + 4, window.innerHeight - 240),
              left: Math.min(typeAnchor.left, window.innerWidth - 232),
            }}
          >
            {(taskTypes || []).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setDraft((d) => ({ ...d, task_type_id: t.id }));
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

      {priorityMenuOpen && priorityAnchor && (
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
            {PRIORITY_ORDER.filter((p) => p !== 'emergency').map((p) => (
              <button
                key={p}
                onClick={() => {
                  setDraft((d) => ({ ...d, priority: p }));
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

      {pendingEmergency && (
        <EmergencyConfirm
          taskTitle={draft.title}
          onConfirm={() => {
            setDraft((d) => ({ ...d, priority: 'emergency' }));
            setPendingEmergency(false);
          }}
          onCancel={() => setPendingEmergency(false)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* DesignFieldRow — renders a single design_task custom field inside the panel */
/* -------------------------------------------------------------------------- */

function DesignFieldRow({
  field,
  value,
  otherValue,
  onChange,
  onOtherChange,
}: {
  field: TaskTypeField;
  value: unknown;
  otherValue: unknown;
  onChange: (v: unknown) => void;
  onOtherChange: (v: unknown) => void;
}) {
  const str = typeof value === 'string' ? value : value == null ? '' : String(value);
  const otherStr = typeof otherValue === 'string' ? otherValue : '';

  let control: React.ReactNode = null;

  switch (field.field_type) {
    case 'multi_select': {
      const arr: string[] = Array.isArray(value) ? (value as string[]) : [];
      const otherSelected = arr.includes('__other__') || (field.allow_other && !!otherStr);
      control = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="flex flex-wrap gap-1.5">
            {field.options.map((o) => {
              const on = arr.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onChange(on ? arr.filter((v) => v !== o.value) : [...arr, o.value])}
                  className="td-prop-chip"
                  style={{
                    background: on ? 'var(--sh-ink)' : 'var(--surface-alt)',
                    color: on ? 'var(--surface)' : 'var(--sh-ink-2)',
                    border: `1px solid ${on ? 'var(--sh-ink)' : 'var(--sh-hair-3)'}`,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {o.label}
                </button>
              );
            })}
            {field.allow_other && (
              <button
                type="button"
                onClick={() => {
                  if (otherSelected) {
                    onChange(arr.filter((v) => v !== '__other__'));
                    onOtherChange(null);
                  } else if (!arr.includes('__other__')) {
                    onChange([...arr, '__other__']);
                  }
                }}
                className="td-prop-chip"
                style={{
                  background: otherSelected ? 'var(--sh-ink)' : 'var(--surface-alt)',
                  color: otherSelected ? 'var(--surface)' : 'var(--sh-ink-2)',
                  border: `1px solid ${otherSelected ? 'var(--sh-ink)' : 'var(--sh-hair-3)'}`,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Other
              </button>
            )}
          </div>
          {field.allow_other && otherSelected && (
            <input
              type="text"
              value={otherStr}
              placeholder="Describe…"
              onChange={(e) => onOtherChange(e.target.value || null)}
              className="text-[12.5px] bg-transparent border rounded-lg px-2.5 py-1.5 outline-none w-full"
              style={{ borderColor: 'var(--sh-hair)' }}
            />
          )}
        </div>
      );
      break;
    }
    case 'select':
      control = (
        <select
          value={str}
          onChange={(e) => onChange(e.target.value || null)}
          className="text-[12.5px] bg-transparent border rounded-lg px-2.5 py-1.5 outline-none"
          style={{ borderColor: 'var(--sh-hair)' }}
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
      break;
    case 'textarea':
      control = (
        <textarea
          rows={2}
          placeholder={field.placeholder || ''}
          value={str}
          onChange={(e) => onChange(e.target.value || null)}
          className="td-about w-full resize-none bg-transparent outline-none text-[12.5px]"
        />
      );
      break;
    case 'number':
      control = (
        <input
          type="number"
          placeholder={field.placeholder || ''}
          value={str}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          className="text-[12.5px] bg-transparent border-b outline-none w-28"
          style={{ borderColor: 'var(--sh-hair)' }}
        />
      );
      break;
    case 'date':
      control = (
        <input
          type="date"
          value={str}
          onChange={(e) => onChange(e.target.value || null)}
          className="text-[12.5px] bg-transparent border rounded-lg px-2.5 py-1.5 outline-none"
          style={{ borderColor: 'var(--sh-hair)' }}
        />
      );
      break;
    case 'url':
      control = (
        <input
          type="url"
          placeholder={field.placeholder || 'https://'}
          value={str}
          onChange={(e) => onChange(e.target.value || null)}
          className="text-[12.5px] bg-transparent border rounded-lg px-2.5 py-1.5 outline-none w-full"
          style={{ borderColor: 'var(--sh-hair)' }}
        />
      );
      break;
    case 'checkbox':
      control = (
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
      break;
    case 'text':
    default:
      control = (
        <input
          type="text"
          placeholder={field.placeholder || ''}
          value={str}
          onChange={(e) => onChange(e.target.value || null)}
          className="text-[12.5px] bg-transparent border rounded-lg px-2.5 py-1.5 outline-none w-full"
          style={{ borderColor: 'var(--sh-hair)' }}
        />
      );
  }

  return (
    <div className="td-settings-row" style={{ gridColumn: '1 / -1', borderRight: 'none' }}>
      <span className="k" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>
          {field.label}
          {field.is_required && <span style={{ color: 'oklch(0.55 0.18 25)', marginLeft: 2 }}>*</span>}
        </span>
        {field.help_url && (
          <a
            href={field.help_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 10.5, color: 'var(--sh-ink-4)', textDecoration: 'underline' }}
          >
            View size chart
          </a>
        )}
      </span>
      <span className="v" style={{ display: 'block' }}>{control}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* VoiceNoteRecorder                                                          */
/* -------------------------------------------------------------------------- */

type VoiceNote = {
  id: string;
  blob: Blob;
  url: string;
  duration: number;
  createdAt: number;
};

function VoiceNoteRecorder({ onAddFile }: { onAddFile: (file: File) => void }) {
  const [notes, setNotes] = useState<VoiceNote[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  useEffect(() => {
    return () => {
      timerRef.current && clearInterval(timerRef.current);
      for (const n of notes) URL.revokeObjectURL(n.url);
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
      chunksRef.current = [];

      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        const url = URL.createObjectURL(blob);
        const dur = (Date.now() - startTimeRef.current) / 1000;
        const id = tempId();
        setNotes((prev) => [...prev, { id, blob, url, duration: dur, createdAt: Date.now() }]);
        const ext = mr.mimeType.includes('webm') ? 'webm' : 'ogg';
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: mr.mimeType });
        onAddFile(file);
      };

      mr.start(250);
      recorderRef.current = mr;
      startTimeRef.current = Date.now();
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((Date.now() - startTimeRef.current) / 1000), 200);
    } catch {
      showToast('Microphone access denied');
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    timerRef.current && clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const removeNote = (id: string) => {
    setNotes((prev) => {
      const n = prev.find((x) => x.id === id);
      if (n) URL.revokeObjectURL(n.url);
      return prev.filter((x) => x.id !== id);
    });
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="td-settings-row" style={{ gridColumn: '1 / -1', borderRight: 'none' }}>
      <span className="k">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
          <path d="M19 10v2a7 7 0 01-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
        Voice notes
      </span>
      <span className="v" style={{ display: 'block' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {notes.map((n) => (
            <VoiceNotePlayer key={n.id} note={n} onRemove={() => removeNote(n.id)} />
          ))}

          {recording ? (
            <button
              type="button"
              onClick={stopRecording}
              className="td-voice-rec-btn recording"
            >
              <span className="td-voice-pulse" />
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTime(elapsed)}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              className="td-voice-rec-btn"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                <path d="M19 10v2a7 7 0 01-14 0v-2" />
              </svg>
              Record voice note
            </button>
          )}
        </div>
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* VoiceNotePlayer                                                            */
/* -------------------------------------------------------------------------- */

const SPEEDS = [0.5, 1, 1.5, 2] as const;

function VoiceNotePlayer({ note, onRemove }: { note: VoiceNote; onRemove: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState<number>(1);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const audio = new Audio(note.url);
    audioRef.current = audio;
    audio.playbackRate = speed;
    audio.addEventListener('ended', () => { setPlaying(false); setProgress(0); });
    return () => { audio.pause(); audio.src = ''; cancelAnimationFrame(rafRef.current); };
  }, [note.url]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const tick = () => {
    const a = audioRef.current;
    if (a && a.duration) setProgress(a.currentTime / a.duration);
    if (playing) rafRef.current = requestAnimationFrame(tick);
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
      cancelAnimationFrame(rafRef.current);
    } else {
      a.play();
      setPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    a.currentTime = pct * a.duration;
    setProgress(pct);
  };

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(speed as typeof SPEEDS[number]);
    setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const currentTime = audioRef.current?.currentTime || 0;

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

      <span className="td-voice-time">{fmtTime(playing ? currentTime : note.duration)}</span>

      <button type="button" onClick={cycleSpeed} className="td-voice-speed">
        {speed}x
      </button>

      <button type="button" onClick={onRemove} className="td-voice-del" title="Delete voice note">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </button>
    </div>
  );
}
