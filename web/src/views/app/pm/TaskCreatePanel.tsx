import { useEffect, useMemo, useRef, useState } from 'react';
import { useCreateTask } from '../../../hooks/useTasks';
import { useTaskTypes } from '../../../hooks/useTaskTypes';
import { useSpace } from '../../../hooks/useSpaces';
import { useAuthStore } from '../../../stores/authStore';
import type { SpaceStatus, Task, TaskPriority, TaskStatusKey } from '@squadhub/shared';
import { getTaskStatusDef } from '@squadhub/shared';
import api from '../../../services/api';
import AssigneePicker from './AssigneePicker';
import DatePicker from './DatePicker';
import EmergencyConfirm from './EmergencyConfirm';
import ListPickerCombobox from './ListPickerCombobox';
import TaskStatusPicker from './TaskStatusPicker';
import { nextQuickDate } from './taskHelpers';
import { useDraftTaskStore, type SerializableDraft } from '../../../stores/draftTaskStore';
import { showToast } from '../../../components/Toast';

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
    d.priority !== 'none'
  );
}

export default function TaskCreatePanel({
  statuses,
  listId,
  defaultStatus,
  spaceName,
  spaceColor,
  onClose,
  onCreated,
  pickable = false,
  workspaceId,
  initialSpaceId,
  initialListId,
  initialDraft,
}: {
  statuses?: SpaceStatus[];
  listId?: string;
  /** Status category to pre-select (e.g. 'todo'). Falls back to first status. */
  defaultStatus?: string;
  spaceName?: string;
  spaceColor?: string | null;
  onClose: () => void;
  onCreated?: (newTask: Task) => void;
  /** When true, render space/folder/list pickers at the top and derive listId + statuses from selection. */
  pickable?: boolean;
  workspaceId?: string;
  initialSpaceId?: string | null;
  initialListId?: string | null;
  /** Pre-fill with a saved draft. _draftId is used to clean up on submit/re-save. */
  initialDraft?: SerializableDraft & { _draftId?: string };
}) {
  // Picker-mode state — spaceId is derived from the selected list (combobox hands both back)
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(initialSpaceId ?? null);
  const [selectedListId, setSelectedListId] = useState<string | null>(initialListId ?? null);

  // Load the selected space for statuses + selected list metadata (name/color)
  const { data: spaceData } = useSpace(pickable ? selectedSpaceId : null);

  // Selected list info (for the combobox button label)
  const selectedListInfo = useMemo(() => {
    if (!pickable || !selectedListId || !spaceData) return null;
    const direct = (spaceData.lists || []).find((l) => l.id === selectedListId);
    if (direct) return { name: direct.name };
    for (const f of spaceData.folders || []) {
      const inFolder = (f.lists || []).find((l) => l.id === selectedListId);
      if (inFolder) return { name: inFolder.name };
    }
    return null;
  }, [pickable, selectedListId, spaceData]);

  // Derived effective values — switch between prop-fed (fixed mode) and state-fed (picker mode)
  const effectiveListId = pickable ? selectedListId : (listId ?? null);
  const effectiveStatuses = useMemo<SpaceStatus[]>(
    () => (pickable ? (spaceData?.statuses || []) : (statuses || [])),
    [pickable, spaceData?.statuses, statuses],
  );
  const effectiveSpaceName = pickable ? spaceData?.name : spaceName;
  const effectiveSpaceColor = pickable ? (spaceData?.color ?? null) : (spaceColor ?? null);

  const createTask = useCreateTask(effectiveListId);
  const { data: taskTypes } = useTaskTypes();
  const currentUser = useAuthStore((s) => s.user);

  const initialStatus = defaultStatus || effectiveStatuses[0]?.category || 'todo';
  const [draft, setDraft] = useState<Draft>(() => {
    if (initialDraft) {
      return { ...initialDraft, pendingFiles: [] };
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
    if (effectiveStatuses.some((s) => s.category === draft.status)) return;
    setDraft((d) => ({ ...d, status: effectiveStatuses[0].category }));
  }, [effectiveStatuses, draft.status, draft.task_type_id, taskTypes]);

  // Popover / menu anchors
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const [priorityAnchor, setPriorityAnchor] = useState<DOMRect | null>(null);
  const [pendingEmergency, setPendingEmergency] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [assigneeAnchorRect, setAssigneeAnchorRect] = useState<DOMRect | null>(null);
  const [workDateOpen, setWorkDateOpen] = useState(false);
  const [workDateAnchor, setWorkDateAnchor] = useState<DOMRect | null>(null);
  const [startDateOpen, setStartDateOpen] = useState(false);
  const [startDateAnchor, setStartDateAnchor] = useState<DOMRect | null>(null);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [dueDateAnchor, setDueDateAnchor] = useState<DOMRect | null>(null);
  const [editingEstimate, setEditingEstimate] = useState(false);
  const [estimateInput, setEstimateInput] = useState('');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState<string | null>(null);
  const [newChecklistTitle, setNewChecklistTitle] = useState<string | null>(null);
  const [newItemDrafts, setNewItemDrafts] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const filePickerRef = useRef<HTMLInputElement>(null);

  // Default task type, once the list of types is available.
  useEffect(() => {
    if (!taskTypes || !taskTypes.length) return;
    if (draft.task_type_id) return;
    const def = taskTypes.find((t) => t.is_default) || taskTypes[0];
    if (def) setDraft((d) => ({ ...d, task_type_id: def.id }));
  }, [taskTypes, draft.task_type_id]);

  // Slide-in mount animation, matches TaskDetailPanel
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const currentStatus = useMemo(
    () => effectiveStatuses.find((s) => s.category === draft.status),
    [effectiveStatuses, draft.status],
  );
  const currentType = useMemo(
    () => taskTypes?.find((t) => t.id === draft.task_type_id) || null,
    [taskTypes, draft.task_type_id],
  );
  const priorityLabel = PRIORITY_LABEL[draft.priority];
  const dueInfo = formatDueRelative(draft.due_date);

  const canSubmit = draft.title.trim().length > 0 && !!effectiveListId && !submitting;

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
      const newTask = await createTask.mutateAsync({
        title,
        description: draft.description.trim() || undefined,
        status: draft.status,
        priority: draft.priority === 'none' ? undefined : draft.priority,
        assignee_ids: draft.assignee_ids.length ? draft.assignee_ids : undefined,
        work_date: draft.work_date || undefined,
        start_date: draft.start_date || undefined,
        due_date: draft.due_date || undefined,
        task_type_id: draft.task_type_id || undefined,
        list_id: effectiveListId,
      });

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
        className="td-panel td-panel-luma apple td-shell absolute flex flex-col"
        style={{
          background: 'var(--surface)',
          transform: mounted ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
          transition: 'transform .42s cubic-bezier(0.23, 1, 0.32, 1), opacity .3s ease',
          opacity: mounted ? 1 : 0,
        }}
      >
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
          {effectiveSpaceName && (
            <span className="td-host-chip td-focus" tabIndex={0}>
              <span className="logo" style={{ background: effectiveSpaceColor || 'var(--sh-ink)' }}>
                {initialOf(effectiveSpaceName)[0]}
              </span>
              <span>{effectiveSpaceName}</span>
              <svg className="chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </span>
          )}
          <span className="text-[11.5px] text-[color:var(--sh-ink-4)] font-medium tracking-[0.01em]">
            NEW TASK
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="td-pill-btn"
            style={canSubmit ? { background: 'var(--sh-ink)', color: 'var(--surface)', borderColor: 'var(--sh-ink)' } : { opacity: 0.5 }}
            title="Create task"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M5 12l5 5 9-11" />
            </svg>
            {submitting ? 'Creating…' : 'Create task'}
          </button>
        </div>

        {/* Scrollable body */}
        <div className="td-scroll flex-1 overflow-y-auto px-6 pt-3 pb-8">
          {/* List picker combobox (picker mode only) */}
          {pickable && workspaceId && (
            <div className="mb-4">
              <ListPickerCombobox
                workspaceId={workspaceId}
                selectedListId={selectedListId}
                selectedListName={selectedListInfo?.name ?? null}
                selectedSpaceColor={effectiveSpaceColor}
                initialSpaceId={selectedSpaceId}
                onChange={(listId, spaceId) => {
                  setSelectedListId(listId);
                  setSelectedSpaceId(spaceId);
                }}
              />
            </div>
          )}

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

          {/* Description — boxed right under title */}
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

          {/* Assignee bar — full-width row */}
          <div
            className="td-assignee-bar td-focus w-full text-left"
            role={draft.assignee_ids.length > 0 ? 'button' : undefined}
            tabIndex={draft.assignee_ids.length > 0 ? 0 : undefined}
            onClick={draft.assignee_ids.length > 0 ? (e) => {
              setAssigneeAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect());
              setAssigneePickerOpen(v => !v);
            } : undefined}
            style={draft.assignee_ids.length > 0 ? undefined : { cursor: 'default' }}
          >
            <span className="label">Assignee</span>
            <span className="value">
              {draft.assignee_ids.length > 0 ? (
                <>
                  <span className="av-stack">
                    {draft.assignee_ids.slice(0, 3).map((id) => (
                      <span
                        key={id}
                        className="td-ava-xs"
                        style={{ background: avatarColor(id), width: 28, height: 28, fontSize: 11 }}
                      >
                        ?
                      </span>
                    ))}
                    {draft.assignee_ids.length > 3 && (
                      <span className="av-more">+{draft.assignee_ids.length - 3}</span>
                    )}
                  </span>
                  <span className="name">
                    {draft.assignee_ids.length === 1 ? '1 assignee' : `${draft.assignee_ids.length} assignees`}
                  </span>
                </>
              ) : (
                <>
                  <span className="av-placeholder" aria-hidden />
                  <span className="name muted">Unassigned</span>
                </>
              )}
            </span>
            {draft.assignee_ids.length > 0 ? (
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
                                  setDraft((d) => ({ ...d, status: s.category }));
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

              {/* Type */}
              {taskTypes && taskTypes.length > 0 && (
                <div
                  className="td-settings-row"
                  data-half="true"
                  style={!(effectiveSpaceName) ? { gridColumn: '1 / -1', borderRight: 'none' } : undefined}
                >
                  <span className="k">{META_ICONS.Space}Type</span>
                  <span className="v">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setTypeMenuOpen((v) => !v)}
                        className="td-prop-chip"
                        style={{
                          background: currentType?.color ? `color-mix(in oklch, ${currentType.color} 14%, transparent)` : 'var(--surface-alt)',
                          color: currentType?.color || 'var(--sh-ink-3)',
                        }}
                      >
                        <span className="dot" style={{ background: currentType?.color || 'var(--sh-ink-4)' }} />
                        {currentType?.name || 'Select type'}
                      </button>
                      {typeMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setTypeMenuOpen(false)} />
                          <div
                            className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border shadow-lg"
                            style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface)' }}
                          >
                            {taskTypes.map((t) => (
                              <button
                                key={t.id}
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
                    </div>
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
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
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
