import { useEffect, useMemo, useState } from 'react';
import { useCreateTask } from '../../../hooks/useTasks';
import { useTaskTypes } from '../../../hooks/useTaskTypes';
import { useSpace } from '../../../hooks/useSpaces';
import { useAuthStore } from '../../../stores/authStore';
import type { SpaceStatus, Task, TaskPriority } from '@squadhub/shared';
import AssigneePicker from './AssigneePicker';
import DatePicker from './DatePicker';
import EmergencyConfirm from './EmergencyConfirm';
import ListPickerCombobox from './ListPickerCombobox';

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
  };
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
  const [draft, setDraft] = useState<Draft>(() => makeDraft(initialStatus));
  const [mounted, setMounted] = useState(false);

  // When statuses load (picker mode) or space changes, reset draft.status to a valid one
  useEffect(() => {
    if (!effectiveStatuses.length) return;
    if (effectiveStatuses.some((s) => s.category === draft.status)) return;
    setDraft((d) => ({ ...d, status: effectiveStatuses[0].category }));
  }, [effectiveStatuses, draft.status]);

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

  // Escape to close — ignore when focus is in an editable element
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  const canSubmit = draft.title.trim().length > 0 && !!effectiveListId && !createTask.isPending;

  const handleSubmit = () => {
    const title = draft.title.trim();
    if (!title || !effectiveListId) return;
    createTask.mutate(
      {
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
      },
      {
        onSuccess: (newTask: Task) => {
          onCreated?.(newTask);
          onClose();
        },
      },
    );
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
        onClick={onClose}
      />

      {/* Floating drawer */}
      <aside
        onClick={(e) => e.stopPropagation()}
        className="td-panel td-panel-luma apple absolute flex flex-col"
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
            onClick={onClose}
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
            {createTask.isPending ? 'Creating…' : 'Create task'}
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
          <div className="flex items-start gap-3 mb-3">
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
              className="flex-1 bg-transparent outline-none text-[26px] leading-[1.2] tracking-[-0.018em] font-semibold text-[color:var(--sh-ink)] placeholder:text-[color:var(--sh-ink-4)]"
              style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
            />
          </div>

          {/* Priority subtitle */}
          {priorityLabel && (
            <div className="flex items-center gap-2.5 mb-5 flex-wrap">
              {priorityLabel === 'EMG' ? (
                <span className="td-pri-chip" data-level="emg">
                  <span className="dot" />
                  EMERGENCY
                </span>
              ) : (priorityLabel === 'P0' || priorityLabel === 'P1') ? (
                <span className="td-pri-chip" data-level={priorityLabel.toLowerCase()}>
                  <span className="dot" />
                  {priorityLabel === 'P0' ? 'Urgent' : 'High'}
                </span>
              ) : (
                <span className="text-[11.5px] text-[color:var(--sh-ink-3)]">{priorityLabel}</span>
              )}
            </div>
          )}

          {/* Details card */}
          <div className="td-eyebrow">Details</div>
          <div className="td-settings-card">
            {/* Assignee */}
            <div
              className="td-settings-row"
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                setAssigneeAnchorRect((e.currentTarget as HTMLElement).getBoundingClientRect());
                setAssigneePickerOpen((v) => !v);
              }}
            >
              <span className="k">{META_ICONS.Assignee}Assignee</span>
              <span className="v">
                {draft.assignee_ids.length > 0 ? (
                  <span>{draft.assignee_ids.length === 1 ? '1 assignee' : `${draft.assignee_ids.length} assignees`}</span>
                ) : (
                  <span className="muted">Unassigned</span>
                )}
              </span>
            </div>

            {/* Dates row */}
            <div className="td-dates-row">
              <div
                className="td-date-cell"
                data-empty={!draft.work_date}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  setWorkDateAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
                  setWorkDateOpen((v) => !v);
                }}
              >
                <span className="td-date-label">{META_ICONS.WorkDate}Work</span>
                <span className="td-date-value">
                  {draft.work_date ? formatDueRelative(draft.work_date).text : '—'}
                </span>
              </div>
              <div
                className="td-date-cell"
                data-empty={!draft.start_date}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  setStartDateAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
                  setStartDateOpen((v) => !v);
                }}
              >
                <span className="td-date-label">{META_ICONS.StartDate}Start</span>
                <span className="td-date-value">
                  {draft.start_date ? formatDueRelative(draft.start_date).text : '—'}
                </span>
              </div>
              <div
                className="td-date-cell"
                data-empty={!draft.due_date}
                data-accent={draft.due_date ? dueInfo.accent : false}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  setDueDateAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
                  setDueDateOpen((v) => !v);
                }}
              >
                <span className="td-date-label">{META_ICONS.Due}Due</span>
                <span className="td-date-value">
                  {draft.due_date ? dueInfo.text : '—'}
                </span>
              </div>
            </div>

            {/* Status */}
            <div className="td-settings-row">
              <span className="k">{META_ICONS.Status}Status</span>
              <span className="v">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setStatusMenuOpen((v) => !v)}
                    className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full hover:bg-[color:var(--sh-hair-3)] transition td-focus"
                  >
                    <span className="td-dot" style={{ background: currentStatus?.color || 'var(--sh-ink-4)' }} />
                    {currentStatus?.name || draft.status || 'No status'}
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-[color:var(--sh-ink-4)]">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
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
              </span>
            </div>

            {/* Priority */}
            <div className="td-settings-row">
              <span className="k">{META_ICONS.Priority}Priority</span>
              <span className="v">
                <button
                  type="button"
                  onClick={(e) => {
                    setPriorityAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
                    setPriorityMenuOpen((v) => !v);
                  }}
                  className="inline-flex items-center gap-2 px-2 py-0.5 rounded-full hover:bg-[color:var(--sh-hair-3)] transition td-focus"
                >
                  {draft.priority === 'emergency' ? (
                    <span className="td-pri-chip" data-level="emg">
                      <span className="dot" />
                      EMERGENCY
                    </span>
                  ) : (
                    PRIORITY_NAME[draft.priority]
                  )}
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-[color:var(--sh-ink-4)]">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </span>
            </div>

            {/* Space (read-only) */}
            {effectiveSpaceName && (
              <div className="td-settings-row">
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

            {/* Reporter (read-only: current user) */}
            <div className="td-settings-row">
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

            {/* Estimate */}
            <div className="td-settings-row">
              <span className="k">{META_ICONS.Estimate}Estimate</span>
              <span className="v">
                {editingEstimate ? (
                  <input
                    autoFocus
                    value={estimateInput}
                    onChange={(e) => setEstimateInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEstimate();
                      if (e.key === 'Escape') setEditingEstimate(false);
                    }}
                    onBlur={commitEstimate}
                    placeholder="e.g. 2h 30m"
                    className="text-[13.5px] bg-transparent border-b outline-none w-28"
                    style={{ borderColor: 'var(--sh-ink)' }}
                  />
                ) : (
                  <span
                    onClick={() => { setEditingEstimate(true); setEstimateInput(formatMinutes(draft.time_estimate)); }}
                    className="cursor-pointer"
                  >
                    {draft.time_estimate ? formatMinutes(draft.time_estimate) : <span className="muted">Set an estimate</span>}
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Type picker */}
          {taskTypes && taskTypes.length > 0 && (
            <div className="mb-5 mt-5">
              <div className="td-section-label">Type</div>
              <div className="relative inline-block">
                <button
                  type="button"
                  onClick={() => setTypeMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-2 text-[13px] text-[color:var(--sh-ink)] px-3 py-1.5 rounded-full border"
                  style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface)' }}
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
            </div>
          )}

          {/* Description */}
          <div className="td-eyebrow">Description</div>
          <div className="td-lcard apple" style={{ marginBottom: 4 }}>
            <div className="td-lcard-body">
              <textarea
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Add a description…"
                rows={5}
                className="td-about w-full resize-none bg-transparent outline-none"
              />
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
