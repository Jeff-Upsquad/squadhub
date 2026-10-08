import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAuthStore } from './stores/authStore';
import {
  fetchPersonalList,
  fetchWorkspaces,
  fetchSpaces,
  fetchSpace,
  fetchAssignableUsers,
  fetchTaskTypes,
  createTask,
  setTaskFocus,
  uploadTaskAttachment,
  fetchLabelsForList,
  attachTaskLabel,
  updateTaskStatus,
  logTaskTime,
  type AssignableUser,
  type ListLite,
  type SpaceStatus,
  type TaskPriority,
  type TaskTag,
  type TaskType,
  type LabelPickerGroup,
} from './services/api';
import { login } from './services/auth';
import { getRecentLists, pushRecentList, type RecentList } from './services/recents';
import { formatDuration, parseDuration } from './timeDuration';

// Cached across summons of the (persistent) quickadd window so we only resolve
// the personal list / list tree once per app run.
let cachedPersonal: { id: string; name: string; spaceId: string } | null = null;

type Phase = 'idle' | 'saving' | 'done' | 'error';
type MenuKey = 'list' | 'assignee' | 'priority' | 'date' | 'rangedate' | 'labels' | 'logged' | 'estimate' | 'type' | 'status' | null;
type SelectedList = { id: string; name: string; spaceId?: string };

// A file the user has dropped onto the panel, queued to upload once the task
// itself is created. `previewUrl` is an object URL for images (revoked on
// removal/reset) and null for everything else.
type PendingAttachment = { id: string; file: File; previewUrl: string | null };
let attachmentSeq = 0;

// A batch of files handed to the background uploader once its task exists.
// Jobs live on the persistent quickadd webview, so uploads keep running after
// the panel hides; any that fail stay here (with a Retry) until dismissed.
type BgUploadJob = {
  key: number;
  taskId: string;
  taskTitle: string;
  files: PendingAttachment[];
  active: boolean;
};

const PRIORITIES: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'emergency', label: 'Emergency', color: '#dc2626' },
  { value: 'urgent', label: 'Urgent', color: '#f97316' },
  { value: 'high', label: 'High', color: '#eab308' },
  { value: 'normal', label: 'Normal', color: '#3b82f6' },
  { value: 'low', label: 'Low', color: '#9ca3af' },
  { value: 'none', label: 'No priority', color: '#6b7280' },
];

// ── date helpers ────────────────────────────────────────────────────────────
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayYmd(): string {
  return ymd(new Date());
}
function tomorrowYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return ymd(d);
}
function dateLabel(s: string | null): string {
  if (!s) return 'Work date';
  if (s === todayYmd()) return 'Today';
  if (s === tomorrowYmd()) return 'Tomorrow';
  return new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function initials(name: string | null | undefined, email?: string): string {
  const src = (name && name.trim()) || (email && email.trim()) || '?';
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

// ── task-type statuses (for task_type.key = 'task') ──────────────────────────
// Full client copy of the shared TASK_STATUS_CATALOG (labels, colors,
// descriptions + picker sections). Mirrors web TaskStatusPicker so the
// desktop quick-add status dropdown renders the same grouped, searchable
// design. Other task types use their space's space_statuses (names) instead.
type StatusGroup =
  | 'priority_urgency'
  | 'in_motion'
  | 'up_next'
  | 'scheduled_queued'
  | 'routines'
  | 'blocked_paused'
  | 'not_started'
  | 'done';

interface CatalogStatus {
  key: string;
  label: string;
  description: string;
  group: StatusGroup;
  groupLabel: string;
  groupEmoji: string;
  color: string;
}

const TASK_STATUS_CATALOG: CatalogStatus[] = [
  { key: 'focus_now', label: 'FOCUS NOW', description: 'Requires your undivided attention right now.', group: 'priority_urgency', groupLabel: 'Priority & Urgency', groupEmoji: '⚡', color: '#e11d48' },
  { key: 'emergency', label: 'EMERGENCY', description: 'Critical; drop everything.', group: 'priority_urgency', groupLabel: 'Priority & Urgency', groupEmoji: '⚡', color: '#b91c1c' },
  { key: 'urgent', label: 'URGENT', description: 'Needs immediate action.', group: 'priority_urgency', groupLabel: 'Priority & Urgency', groupEmoji: '⚡', color: '#ef4444' },
  { key: 'over_due', label: 'OVER DUE', description: 'Deadline has already passed.', group: 'priority_urgency', groupLabel: 'Priority & Urgency', groupEmoji: '⚡', color: '#dc2626' },
  { key: 'high_priority', label: 'HIGH PRIORITY', description: 'Very important; needs attention soon.', group: 'priority_urgency', groupLabel: 'Priority & Urgency', groupEmoji: '⚡', color: '#f97316' },
  { key: 'priority', label: 'PRIORITY', description: 'Important; above normal.', group: 'priority_urgency', groupLabel: 'Priority & Urgency', groupEmoji: '⚡', color: '#fb923c' },
  { key: 'active', label: 'ACTIVE', description: 'Currently being worked on.', group: 'in_motion', groupLabel: 'In Motion', groupEmoji: '🏃', color: '#22c55e' },
  { key: 'in_progress', label: 'IN PROGRESS', description: 'Work has started and is ongoing.', group: 'in_motion', groupLabel: 'In Motion', groupEmoji: '🏃', color: '#16a34a' },
  { key: 'in_code_review', label: 'IN CODE REVIEW', description: 'PR submitted; awaiting review and approval.', group: 'in_motion', groupLabel: 'In Motion', groupEmoji: '🏃', color: '#8b5cf6' },
  { key: 'testing_qa', label: 'TESTING / QA', description: 'Under validation on staging / test environment.', group: 'in_motion', groupLabel: 'In Motion', groupEmoji: '🏃', color: '#eab308' },
  { key: 'ready_for_deploy', label: 'READY FOR DEPLOY', description: 'Approved and ready for production release.', group: 'in_motion', groupLabel: 'In Motion', groupEmoji: '🏃', color: '#0d9488' },
  { key: 'time_tracked', label: 'TIME TRACKED', description: 'Timer is running / hours being logged against it.', group: 'in_motion', groupLabel: 'In Motion', groupEmoji: '🏃', color: '#0d9488' },
  { key: 'active_daily', label: 'ACTIVE DAILY', description: 'Touched every day until resolved.', group: 'in_motion', groupLabel: 'In Motion', groupEmoji: '🏃', color: '#14b8a6' },
  { key: 'planning', label: 'PLANNING', description: 'Architecture, RFC, spike, or scoping phase.', group: 'up_next', groupLabel: 'Up Next', groupEmoji: '🎯', color: '#a855f7' },
  { key: 'ready_to_code', label: 'READY TO CODE', description: 'Groomed, estimated, and ready to start coding.', group: 'up_next', groupLabel: 'Up Next', groupEmoji: '🎯', color: '#22c55e' },
  { key: 'front_burner', label: 'FRONT BURNER', description: 'Moving up the queue; active sprint priority.', group: 'scheduled_queued', groupLabel: 'Scheduled / Queued', groupEmoji: '📅', color: '#f59e0b' },
  { key: 'scheduled', label: 'SCHEDULED', description: 'Has a specific date/time set.', group: 'scheduled_queued', groupLabel: 'Scheduled / Queued', groupEmoji: '📅', color: '#60a5fa' },
  { key: 'today', label: 'TODAY', description: 'Must be addressed today.', group: 'scheduled_queued', groupLabel: 'Scheduled / Queued', groupEmoji: '📅', color: '#f97316' },
  { key: 'tomorrow', label: 'TOMORROW', description: 'Planned for the next day.', group: 'scheduled_queued', groupLabel: 'Scheduled / Queued', groupEmoji: '📅', color: '#06b6d4' },
  { key: 'this_week', label: 'THIS WEEK', description: 'To be handled sometime this week.', group: 'scheduled_queued', groupLabel: 'Scheduled / Queued', groupEmoji: '📅', color: '#22d3ee' },
  { key: 'back_burner', label: 'BACK BURNER', description: 'Low priority; get to it eventually.', group: 'scheduled_queued', groupLabel: 'Scheduled / Queued', groupEmoji: '📅', color: '#a8a29e' },
  { key: 'reminder', label: 'REMINDER', description: 'A nudge to do or check something later.', group: 'scheduled_queued', groupLabel: 'Scheduled / Queued', groupEmoji: '📅', color: '#93c5fd' },
  { key: 'up_next', label: 'UP NEXT', description: 'Next in line after current work wraps up.', group: 'scheduled_queued', groupLabel: 'Scheduled / Queued', groupEmoji: '📅', color: '#38bdf8' },
  { key: 'routines', label: 'ROUTINES', description: 'Regular recurring task.', group: 'routines', groupLabel: 'Routines', groupEmoji: '🔁', color: '#a855f7' },
  { key: 'imp_routines', label: 'IMP ROUTINES', description: 'Important recurring task that cannot be missed.', group: 'routines', groupLabel: 'Routines', groupEmoji: '🔁', color: '#7c3aed' },
  { key: 'waiting_on_dependency', label: 'WAITING ON – DEPENDENCY', description: 'Blocked until something/someone else moves.', group: 'blocked_paused', groupLabel: 'Blocked / Paused', groupEmoji: '⏸️', color: '#6b7280' },
  { key: 'blocked', label: 'BLOCKED', description: 'Halted by build failure, environment issue, or critical bug.', group: 'blocked_paused', groupLabel: 'Blocked / Paused', groupEmoji: '⏸️', color: '#ef4444' },
  { key: 'on_hold', label: 'ON HOLD', description: 'Intentionally paused for now.', group: 'blocked_paused', groupLabel: 'Blocked / Paused', groupEmoji: '⏸️', color: '#78716c' },
  { key: 'follow_ups', label: 'FOLLOW UPS', description: 'Awaiting a reply; check back periodically.', group: 'blocked_paused', groupLabel: 'Blocked / Paused', groupEmoji: '⏸️', color: '#4b5563' },
  { key: 'help', label: 'HELP', description: 'Stuck; needs input or assistance from someone.', group: 'blocked_paused', groupLabel: 'Blocked / Paused', groupEmoji: '⏸️', color: '#a16207' },
  { key: 'unblocked', label: 'UNBLOCKED', description: 'Was blocked, now free to resume.', group: 'blocked_paused', groupLabel: 'Blocked / Paused', groupEmoji: '⏸️', color: '#84cc16' },
  { key: 'open', label: 'OPEN', description: 'Newly created task, not yet triaged or planned.', group: 'not_started', groupLabel: 'Not Started', groupEmoji: '📥', color: '#9ca3af' },
  { key: 'empty', label: 'EMPTY', description: 'Placeholder task with no details filled in yet.', group: 'not_started', groupLabel: 'Not Started', groupEmoji: '📥', color: '#d1d5db' },
  { key: 'closed', label: 'CLOSED', description: 'Completed and archived.', group: 'done', groupLabel: 'Closed', groupEmoji: '✅', color: '#10b981' },
  { key: 'cancelled', label: 'CANCELLED', description: 'No longer needed; closed without completing.', group: 'done', groupLabel: 'Closed', groupEmoji: '✅', color: '#6b7280' },
];

const STATUS_GROUP_ORDER: StatusGroup[] = [
  'priority_urgency',
  'in_motion',
  'up_next',
  'scheduled_queued',
  'routines',
  'blocked_paused',
  'not_started',
  'done',
];

const TASK_STATUS_BY_KEY: Record<string, CatalogStatus> = TASK_STATUS_CATALOG.reduce(
  (m, d) => { m[d.key] = d; return m; },
  {} as Record<string, CatalogStatus>,
);

// Legacy StatusCategory strings map to their catalog equivalents so the pill
// still shows a friendly label for old values (mirrors web TaskStatusPicker).
const LEGACY_STATUS_TO_KEY: Record<string, string> = {
  todo: 'open',
  active: 'in_progress',
  done: 'closed',
  closed: 'closed',
};

function toStatusSlug(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

function catalogDefForSpaceStatus(name: string): CatalogStatus | null {
  const slug = toStatusSlug(name);
  return TASK_STATUS_BY_KEY[slug] || TASK_STATUS_BY_KEY[name.toLowerCase()] || null;
}

function groupCatalogStatuses(query: string): { group: StatusGroup; label: string; emoji: string; items: CatalogStatus[] }[] {
  const q = query.trim().toLowerCase();
  const matched = !q
    ? TASK_STATUS_CATALOG
    : TASK_STATUS_CATALOG.filter(
        (d) => d.label.toLowerCase().includes(q) || d.description.toLowerCase().includes(q),
      );
  const out: { group: StatusGroup; label: string; emoji: string; items: CatalogStatus[] }[] = [];
  for (const g of STATUS_GROUP_ORDER) {
    const items = matched.filter((d) => d.group === g);
    if (items.length) out.push({ group: g, label: items[0].groupLabel, emoji: items[0].groupEmoji, items });
  }
  return out;
}

type GroupedSpaceStatus = {
  groupName: string;
  emoji: string;
  items: { status: SpaceStatus; description: string }[];
};

function groupSpaceStatuses(statuses: SpaceStatus[], query: string): GroupedSpaceStatus[] {
  const q = query.trim().toLowerCase();
  const enriched = statuses.map((s) => {
    const def = catalogDefForSpaceStatus(s.name);
    let groupKey: string;
    let groupName: string;
    let emoji: string;
    if (def) {
      groupKey = def.group;
      groupName = def.groupLabel;
      emoji = def.groupEmoji;
    } else if (s.category === 'todo') {
      groupKey = 'not_started';
      groupName = 'Not Started';
      emoji = '📥';
    } else if (s.category === 'closed' || s.category === 'done') {
      groupKey = 'done';
      groupName = 'Closed';
      emoji = '✅';
    } else {
      groupKey = 'in_motion';
      groupName = 'In Motion';
      emoji = '🏃';
    }
    return { status: s, description: def?.description || '', groupKey, groupName, emoji };
  });
  const filtered = enriched.filter(
    (e) =>
      !q ||
      e.status.name.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.groupName.toLowerCase().includes(q),
  );
  const map = new Map<string, GroupedSpaceStatus>();
  for (const e of filtered) {
    const hit = map.get(e.groupKey);
    if (hit) hit.items.push({ status: e.status, description: e.description });
    else map.set(e.groupKey, { groupName: e.groupName, emoji: e.emoji, items: [{ status: e.status, description: e.description }] });
  }
  const ordered: GroupedSpaceStatus[] = [];
  for (const g of STATUS_GROUP_ORDER) {
    const hit = map.get(g);
    if (hit) {
      ordered.push(hit);
      map.delete(g);
    }
  }
  for (const [, grp] of map) ordered.push(grp);
  return ordered;
}

// ── task-type grouping (mirrors web TaskTypeDropdown order) ─────────────────
const TYPE_GROUP_ORDER = [
  'Task Types',
  'Software Development',
  'Location-Based',
  'Meetings & Collaboration',
  'Learning & Exploration',
  'Follow-ups & Monitoring',
  'Media Creation',
  'Action-Oriented Activities',
  'Goals & Milestones',
  'Personal',
  'Planning & Review',
];

function taskTypeGroup(t: TaskType): string {
  return t.group_name || 'Other';
}

function groupTaskTypes(types: TaskType[], query: string): { group: string; items: TaskType[] }[] {
  const q = query.trim().toLowerCase();
  const filtered = types.filter(
    (t) =>
      !q ||
      t.name.toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      taskTypeGroup(t).toLowerCase().includes(q) ||
      t.key.toLowerCase().includes(q),
  );
  const out: { group: string; items: TaskType[] }[] = [];
  for (const g of TYPE_GROUP_ORDER) {
    const items = filtered.filter((t) => taskTypeGroup(t) === g);
    if (items.length) out.push({ group: g, items });
  }
  for (const t of filtered) {
    const g = taskTypeGroup(t);
    if (!TYPE_GROUP_ORDER.includes(g) && !out.some((o) => o.group === g)) {
      out.push({ group: g, items: filtered.filter((x) => taskTypeGroup(x) === g) });
    }
  }
  return out;
}

// ── work-date shortcuts (local dates) ────────────────────────────────────────
/** Upcoming Saturday (today if Saturday). */
function weekendYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return ymd(d);
}
/** Next Monday (7 days out if today is Monday). */
function nextWeekYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return ymd(d);
}
function shortDay(s: string): string {
  return new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
}

// ── compact month calendar (Monday-first) ────────────────────────────────────
function MiniCalendar({ value, onPick }: { value: string | null; onPick: (s: string) => void }) {
  const seed = value ? new Date(`${value}T00:00:00`) : new Date();
  const [view, setView] = useState({ y: seed.getFullYear(), m: seed.getMonth() });
  const todayStr = ymd(new Date());
  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const cellYmd = (day: number) => ymd(new Date(view.y, view.m, day));

  return (
    <div className="qa-cal">
      <div className="qa-cal-head">
        <button
          type="button"
          className="qa-cal-nav"
          aria-label="Previous month"
          onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))}
        >
          ‹
        </button>
        <span className="qa-cal-title">{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <button
          type="button"
          className="qa-cal-nav"
          aria-label="Next month"
          onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}
        >
          ›
        </button>
      </div>
      <div className="qa-cal-grid">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
          <span key={d} className="qa-cal-dow">{d}</span>
        ))}
        {cells.map((day, i) =>
          day === null ? (
            <span key={`e-${i}`} />
          ) : (
            <button
              key={day}
              type="button"
              className={`qa-cal-day${cellYmd(day) === value ? ' sel' : ''}${cellYmd(day) === todayStr ? ' today' : ''}`}
              onClick={() => onPick(cellYmd(day))}
            >
              {day}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

// ── pickable-list tree (cached briefly so new lists show up) ──────────────────
type PickableList = { id: string; name: string; spaceName: string; folderName: string | null; spaceId: string };
let pickCache: PickableList[] | null = null;
let pickCacheAt = 0;
const PICK_CACHE_TTL_MS = 30_000;

const ACCESS_RANK = { viewer: 0, commenter: 1, member: 2, manager: 3 } as const;
function canPick(l: ListLite): boolean {
  if (l.is_locked) return false;
  if (!l.my_access_level) return true; // inherits from space; server enforces on POST
  return ACCESS_RANK[l.my_access_level] >= ACCESS_RANK.member;
}

async function fetchPickableLists(): Promise<PickableList[]> {
  const workspaces = await fetchWorkspaces();
  const wid = workspaces[0]?.id;
  if (!wid) return [];
  const spaces = await fetchSpaces(wid);
  const details = await Promise.all(spaces.map((s) => fetchSpace(s.id).catch(() => null)));
  const out: PickableList[] = [];
  for (const full of details) {
    if (!full) continue;
    const add = (l: ListLite, folderName: string | null) => {
      if (canPick(l)) out.push({ id: l.id, name: l.name, spaceName: full.name, folderName, spaceId: full.id });
    };
    for (const l of full.lists || []) add(l, null);
    for (const f of full.folders || []) for (const l of f.lists || []) add(l, f.name);
  }
  return out;
}

async function loadPickableLists(): Promise<PickableList[]> {
  if (pickCache && Date.now() - pickCacheAt < PICK_CACHE_TTL_MS) return pickCache;
  pickCache = await fetchPickableLists();
  pickCacheAt = Date.now();
  return pickCache;
}

export default function QuickAdd() {
  const inputRef = useRef<HTMLInputElement>(null);
  const defaultListRef = useRef<SelectedList | null>(cachedPersonal);
  const win = getCurrentWindow();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('none');
  const [workDate, setWorkDate] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [selectedList, setSelectedList] = useState<SelectedList | null>(cachedPersonal);
  const [recents, setRecents] = useState<RecentList[]>([]);
  const [assignable, setAssignable] = useState<AssignableUser[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  // Auth is shared with the menu-bar window via auth.json — when empty we show
  // an inline sign-in form instead of just an error string.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authHydrated = useAuthStore((s) => s.hydrated);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  // Labels for the selected list's workspace (draft mode: attached after create).
  const [labelGroups, setLabelGroups] = useState<LabelPickerGroup[]>([]);
  const [labelQuery, setLabelQuery] = useState('');
  const [selectedLabels, setSelectedLabels] = useState<TaskTag[]>([]);
  // Task type + status (status value is a catalog key for `task` types,
  // a space-status name for every other type — mirrors the web panel).
  const [taskTypes, setTaskTypes] = useState<TaskType[] | null>(null);
  const [taskTypeId, setTaskTypeId] = useState<string | null>(null);
  const [typeSearch, setTypeSearch] = useState('');
  const [typeHi, setTypeHi] = useState(0);
  const [statusSearch, setStatusSearch] = useState('');
  const [statusHi, setStatusHi] = useState(0);
  const [spaceStatuses, setSpaceStatuses] = useState<SpaceStatus[]>([]);
  const [status, setStatus] = useState('open');
  // Mark the task being created as completed on add.
  const [completeOnCreate, setCompleteOnCreate] = useState(false);
  const [startTimerOnCreate, setStartTimerOnCreate] = useState(false);
  const [loggedInput, setLoggedInput] = useState('');
  const [estimateInput, setEstimateInput] = useState('');

  // Once the task is created we keep its id so a retry (e.g. after an attachment
  // upload fails) re-uses it instead of creating a duplicate task.
  const createdTaskRef = useRef<{ id: string } | null>(null);
  const loggedTimeAppliedRef = useRef(false);
  // dragenter/dragleave fire per-child; count depth so we only clear the drop
  // highlight when the cursor truly leaves the panel.
  const dragDepthRef = useRef(0);
  // True while a drag is hovering the panel — used to suppress the dismiss-on-
  // blur behaviour, since dragging a file in from another app blurs us first.
  const draggingRef = useRef(false);
  const hideTimerRef = useRef<number | null>(null);
  // Attachment uploads continue behind the scenes after the panel closes;
  // these keep their status visible/retryable whenever the panel resurfaces.
  const bgJobsRef = useRef<BgUploadJob[]>([]);
  const bgSeqRef = useRef(0);
  const [bgJobs, setBgJobs] = useState<BgUploadJob[]>([]);

  const cancelPendingHide = () => {
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const clearAttachments = () => {
    setAttachments((cur) => {
      for (const a of cur) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      return [];
    });
  };

  const reset = () => {
    setTitle('');
    setDescription('');
    setPriority('none');
    setWorkDate(null);
    setStartDate(null);
    setDueDate(null);
    setFocused(false);
    setOpenMenu(null);
    setPhase('idle');
    setError('');
    clearAttachments();
    createdTaskRef.current = null;
    dragDepthRef.current = 0;
    draggingRef.current = false;
    setDragOver(false);
    setSelectedLabels([]);
    setLabelQuery('');
    setCompleteOnCreate(false);
    setStartTimerOnCreate(false);
    setLoggedInput('');
    setEstimateInput('');
    loggedTimeAppliedRef.current = false;
    setLoginError('');
    // Assignee starts empty — the circle next to the pill self-assigns.
    setAssigneeIds([]);
    // Type starts empty too — never carry over the previous pick.
    setTaskTypeId(null);
    setTypeSearch('');
    setTypeHi(0);
    setStatusSearch('');
    setStatusHi(0);
    if (defaultListRef.current) setSelectedList(defaultListRef.current);
    void getRecentLists().then(setRecents);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const resolvePersonal = async () => {
    try {
      if (!cachedPersonal) {
        const p = await fetchPersonalList();
        cachedPersonal = { id: p.list.id, name: 'My Tasks', spaceId: p.space.id };
      }
      defaultListRef.current = cachedPersonal;
      setSelectedList((prev) => prev ?? cachedPersonal);
    } catch {
      /* surfaced on submit if it matters */
    }
  };

  useEffect(() => {
    // The quickadd webview is its own JS context — hydrate auth from the shared
    // store file (auth.json) so we have the latest tokens / userId.
    useAuthStore.getState().hydrate();
    void resolvePersonal();
    reset();

    // Rust emits this on EVERY summon (hotkey or tray). It's the authoritative
    // "start a fresh task" signal — tauri://focus alone is unreliable for a
    // non-activating NSPanel, which would leave the previously-added task in the
    // fields when the panel is reopened.
    const unlistenShow = win.listen('quickadd:show', () => {
      cancelPendingHide();
      useAuthStore.getState().hydrate();
      void resolvePersonal();
      reset();
    });

    const unlisten = win.onFocusChanged(({ payload: isFocused }) => {
      if (isFocused) {
        cancelPendingHide();
        useAuthStore.getState().hydrate();
        void resolvePersonal();
        reset();
      } else {
        // Spotlight behaviour: dismiss when focus is lost — but defer briefly.
        // Starting a file-drag from another app (Finder, a browser) blurs this
        // panel a moment before the drag actually enters it; the grace window
        // lets that drag arrive (which sets draggingRef) so we don't vanish
        // mid-drag.
        cancelPendingHide();
        hideTimerRef.current = window.setTimeout(() => {
          hideTimerRef.current = null;
          if (!draggingRef.current) void win.hide();
        }, 200);
      }
    });

    return () => {
      cancelPendingHide();
      void unlisten.then((fn) => fn());
      void unlistenShow.then((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load assignable users + labels whenever the target list changes.
  useEffect(() => {
    const lid = selectedList?.id;
    if (!lid) {
      setAssignable([]);
      setLabelGroups([]);
      setSelectedLabels([]);
      return;
    }
    let alive = true;
    fetchAssignableUsers(lid)
      .then((users) => {
        if (!alive) return;
        setAssignable(users);
        // Assignee stays empty by default; the self-assign circle adds the user.
      })
      .catch(() => {
        if (alive) {
          setAssignable([]);
          setAssigneeIds([]);
        }
      });
    // Labels are workspace-scoped; reset selection when the list changes
    // (mirrors the web TaskCreatePanel draftLabels reset).
    setSelectedLabels([]);
    setLabelQuery('');
    fetchLabelsForList(lid)
      .then((d) => {
        if (alive) setLabelGroups(d.groups || []);
      })
      .catch(() => {
        if (alive) setLabelGroups([]);
      });
    return () => {
      alive = false;
    };
  }, [selectedList?.id]);

  // Load task types once per app run; type starts empty (user picks it).
  useEffect(() => {
    let alive = true;
    fetchTaskTypes()
      .then((types) => {
        if (!alive) return;
        setTaskTypes(types);
        setTaskTypeId((cur) => (cur && types.some((t) => t.id === cur) ? cur : null));
      })
      .catch(() => {
        if (alive) setTaskTypes([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Resolve the selected list's space and load its statuses for non-`task` types.
  useEffect(() => {
    const list = selectedList;
    if (!list) {
      setSpaceStatuses([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        let spaceId = list.spaceId;
        if (!spaceId) {
          if (cachedPersonal && list.id === cachedPersonal.id) {
            spaceId = cachedPersonal.spaceId;
          } else {
            const lists = await loadPickableLists();
            spaceId = lists.find((l) => l.id === list.id)?.spaceId;
          }
        }
        if (!spaceId || !alive) return;
        const space = await fetchSpace(spaceId);
        if (alive) setSpaceStatuses(space.space_statuses || []);
      } catch {
        if (alive) setSpaceStatuses([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedList]);

  // Keep status valid when the type or the space's statuses change (web parity:
  // `task` types use the catalog, everything else uses space-status names).
  useEffect(() => {
    const t = taskTypes?.find((x) => x.id === taskTypeId);
    if (!t) return;
    if (t.key === 'task') {
      if (!TASK_STATUS_CATALOG.some((c) => c.key === status)) setStatus('open');
    } else {
      if (spaceStatuses.length === 0) return; // statuses still loading
      if (!spaceStatuses.some((s) => s.name === status)) {
        setStatus(spaceStatuses.find((s) => s.is_default)?.name ?? spaceStatuses[0].name);
      }
    }
  }, [taskTypes, taskTypeId, spaceStatuses, status]);



  const handleQuickSignIn = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!loginEmail.trim() || !loginPassword || loginLoading) return;
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await login(loginEmail.trim(), loginPassword);
      if (res.success && res.data) {
        await useAuthStore.getState().setAuth({
          accessToken: res.data.access_token,
          refreshToken: res.data.refresh_token,
          userEmail: res.data.user.email,
          displayName: res.data.user.display_name,
          userId: res.data.user.id,
        });
        setLoginPassword('');
        void resolvePersonal();
        reset();
      } else {
        setLoginError(res.error || 'Login failed');
      }
    } catch {
      setLoginError('Could not connect to server');
    } finally {
      setLoginLoading(false);
    }
  };

  const toggleLabel = (tag: TaskTag) =>
    setSelectedLabels((cur) =>
      cur.some((t) => t.id === tag.id) ? cur.filter((t) => t.id !== tag.id) : [...cur, tag],
    );

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || phase === 'saving') return;

    if (!useAuthStore.getState().accessToken) {
      setPhase('error');
      setError('Sign in below to add tasks.');
      return;
    }

    const loggedMinutes = loggedInput.trim() ? parseDuration(loggedInput) : null;
    const estimateMinutes = estimateInput.trim() ? parseDuration(estimateInput) : null;
    if ((loggedInput.trim() && (!loggedMinutes || loggedMinutes < 0))
      || (estimateInput.trim() && (!estimateMinutes || estimateMinutes < 0))) {
      setPhase('error');
      setError('Enter a positive duration, such as 1h 20m or 1 hour 20 minutes.');
      return;
    }

    let list = selectedList;
    if (!list) {
      try {
        if (!cachedPersonal) {
          const p = await fetchPersonalList();
          cachedPersonal = { id: p.list.id, name: 'My Tasks', spaceId: p.space.id };
        }
        list = cachedPersonal;
      } catch {
        setPhase('error');
        setError('Could not resolve your list. Try again.');
        return;
      }
    }

    setPhase('saving');
    setError('');
    try {
      // Re-use the already-created task on a retry (e.g. an attachment upload
      // failed last time) so we never create a duplicate.
      let task = createdTaskRef.current;
      if (!task) {
        task = await createTask({
          list_id: list.id,
          title: trimmed,
          description: description.trim() || undefined,
          status: status || undefined,
          priority: priority === 'none' ? undefined : priority,
          work_date: workDate || undefined,
          start_date: startDate || undefined,
          due_date: dueDate || undefined,
          task_type_id: taskTypeId || undefined,
          assignee_ids: assigneeIds.length ? assigneeIds : undefined,
          time_estimate: estimateMinutes ?? undefined,
          start_timer: startTimerOnCreate,
        });
        createdTaskRef.current = task;
        if (focused) {
          try {
            await setTaskFocus(task.id, true);
          } catch {
            /* focus is a nice-to-have; don't fail the whole add */
          }
        }
        // Labels picked before the task exists are attached now (web parity).
        for (const tag of selectedLabels) {
          try {
            await attachTaskLabel(task.id, tag.id);
          } catch {
            /* label attach is best-effort; task already exists */
          }
        }
        if (completeOnCreate) {
          try {
            await updateTaskStatus(task.id, 'done');
          } catch {
            /* leave the created task open if complete fails */
          }
        }
        if (!cachedPersonal || list.id !== cachedPersonal.id) {
          void pushRecentList({ id: list.id, name: list.name });
        }
      }

      // A successful time entry is never sent twice if a later step fails and
      // the user retries the same already-created task.
      if (loggedMinutes && !loggedTimeAppliedRef.current) {
        const seconds = loggedMinutes * 60;
        await logTaskTime(task.id, seconds, new Date(Date.now() - seconds * 1000).toISOString());
        loggedTimeAppliedRef.current = true;
      }

      // Hand dropped files to the background uploader and close right away —
      // the task exists, so slow or flaky uploads shouldn't hold the panel
      // open. Failures surface (with a retry) the next time it's summoned.
      if (attachments.length) {
        const job: BgUploadJob = {
          key: ++bgSeqRef.current,
          taskId: task.id,
          taskTitle: trimmed,
          files: attachments,
          active: false,
        };
        bgJobsRef.current.push(job);
        runBgUploads(job);
        setAttachments([]);
      }

      setPhase('done');
      setTimeout(() => {
        void win.hide();
      }, 550);
    } catch (e) {
      // A stale cached id (e.g. list deleted) — clear so the next try re-resolves.
      if (!selectedList) cachedPersonal = null;
      pickCache = null;
      pickCacheAt = 0;
      setPhase('error');
      setError(e instanceof Error ? e.message : 'Could not add task');
    }
  };

  const onContainerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (openMenu) setOpenMenu(null);
      else void win.hide();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const onTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      void submit();
    }
  };

  const toggleMenu = (key: Exclude<MenuKey, null>) =>
    setOpenMenu((cur) => {
      if (cur === key) return null;
      if (key === 'type') {
        setTypeSearch('');
        setTypeHi(0);
      }
      if (key === 'status') {
        setStatusSearch('');
        setStatusHi(0);
      }
      return key;
    });
  const pickList = (l: SelectedList) => {
    setSelectedList(l);
    setOpenMenu(null);
  };
  const toggleAssignee = (id: string) =>
    setAssigneeIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  // ── dropped-file attachments ───────────────────────────────────────────────
  const queueFiles = (files: FileList | File[]) => {
    const next: PendingAttachment[] = [];
    for (const file of Array.from(files)) {
      if (!file) continue;
      next.push({
        id: `att-${attachmentSeq++}`,
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      });
    }
    if (next.length) setAttachments((cur) => [...cur, ...next]);
  };

  const removeAttachment = (id: string) =>
    setAttachments((cur) => {
      const hit = cur.find((a) => a.id === id);
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
      return cur.filter((a) => a.id !== id);
    });

  // ── background attachment uploads (started on submit, survive dismissal) ───
  const syncBgJobs = () => setBgJobs([...bgJobsRef.current]);

  const runBgUploads = (job: BgUploadJob) => {
    job.active = true;
    syncBgJobs();
    void (async () => {
      const failed: PendingAttachment[] = [];
      for (const a of job.files) {
        try {
          await uploadTaskAttachment(job.taskId, a.file);
          if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
        } catch {
          failed.push(a);
        }
      }
      job.files = failed;
      job.active = false;
      // A completed upload job is not an error. Remove it instead of leaving an
      // inactive, empty job that renders as "0 files failed to upload".
      if (failed.length === 0) {
        bgJobsRef.current = bgJobsRef.current.filter((j) => j.key !== job.key);
      }
      syncBgJobs();
    })();
  };

  const retryBgJob = (key: number) => {
    const job = bgJobsRef.current.find((j) => j.key === key);
    if (!job || job.active) return;
    runBgUploads(job);
  };

  const dismissBgJob = (key: number) => {
    const job = bgJobsRef.current.find((j) => j.key === key);
    if (job) for (const a of job.files) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    bgJobsRef.current = bgJobsRef.current.filter((j) => j.key !== key);
    syncBgJobs();
  };

  const onDragEnter = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    draggingRef.current = true;
    cancelPendingHide();
    setDragOver(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    draggingRef.current = true;
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      draggingRef.current = false;
      setDragOver(false);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    draggingRef.current = false;
    setDragOver(false);
    if (e.dataTransfer.files?.length) queueFiles(e.dataTransfer.files);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // ── chips: My Tasks + all recents (+ current selection if off-list) ─────────
  // The row scrolls horizontally, so every recent location is reachable.
  const personalId = cachedPersonal?.id;
  const chips: SelectedList[] = [];
  if (defaultListRef.current) chips.push({ id: defaultListRef.current.id, name: 'My Tasks' });
  for (const r of recents) {
    if (r.id === personalId) continue;
    chips.push(r);
  }
  if (selectedList && !chips.some((c) => c.id === selectedList.id)) {
    chips.splice(1, 0, selectedList);
  }

  const selectedPriority = PRIORITIES.find((p) => p.value === priority)!;
  const loggedMinutes = loggedInput.trim() ? parseDuration(loggedInput) : null;
  const estimateMinutes = estimateInput.trim() ? parseDuration(estimateInput) : null;
  const assigneeLabel =
    assigneeIds.length === 0
      ? 'Assignee'
      : assigneeIds.length === 1
        ? assignable.find((u) => u.id === assigneeIds[0])?.display_name ||
          assignable.find((u) => u.id === assigneeIds[0])?.email ||
          '1 assignee'
        : `${assigneeIds.length} assignees`;

  const labelCount = selectedLabels.length;
  const labelButtonText =
    labelCount === 0 ? 'Labels' : labelCount === 1 ? selectedLabels[0].name : `${labelCount} labels`;

  // ── task type + status (derived) ──────────────────────────────────────────
  const currentType = taskTypes?.find((t) => t.id === taskTypeId) ?? null;
  const isTaskCatalogType = !currentType || currentType.key === 'task';
  const typeGroups = groupTaskTypes(taskTypes || [], typeSearch);
  const typeFlat = typeGroups.flatMap((g) => g.items);
  const pickType = (id: string) => {
    setTaskTypeId(id);
    const t = taskTypes?.find((x) => x.id === id);
    if (t) {
      if (t.key === 'task') {
        setStatus((cur) => (TASK_STATUS_CATALOG.some((c) => c.key === cur) ? cur : 'open'));
      } else if (spaceStatuses.length) {
        setStatus((cur) =>
          spaceStatuses.some((s) => s.name === cur)
            ? cur
            : (spaceStatuses.find((s) => s.is_default)?.name ?? spaceStatuses[0].name),
        );
      }
    }
    setOpenMenu(null);
  };
  const onTypeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setTypeHi((i) => (typeFlat.length ? (i + 1) % typeFlat.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setTypeHi((i) => (typeFlat.length ? (i - 1 + typeFlat.length) % typeFlat.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (typeFlat[typeHi]) pickType(typeFlat[typeHi].id);
    } else if (e.key === 'Escape') {
      setOpenMenu(null);
    }
  };
  const statusDef = isTaskCatalogType
    ? (TASK_STATUS_BY_KEY[status] || (LEGACY_STATUS_TO_KEY[status] ? TASK_STATUS_BY_KEY[LEGACY_STATUS_TO_KEY[status]] : undefined))
    : spaceStatuses.find((s) => s.name === status);
  const spaceStatusDef = !isTaskCatalogType && typeof status === 'string' ? catalogDefForSpaceStatus(status) : null;
  const statusLabel = isTaskCatalogType ? (statusDef as { label: string } | undefined)?.label ?? status : status;
  const statusColor = ((statusDef as { color: string } | undefined)?.color ?? spaceStatusDef?.color ?? '#6b7280');

  // ── status menu (web parity: searchable, grouped, described) ──────────────
  const catalogGroups = groupCatalogStatuses(statusSearch);
  const catalogFlat = catalogGroups.flatMap((g) => g.items);
  const spaceGroups = groupSpaceStatuses(spaceStatuses, statusSearch);
  const spaceFlat = spaceGroups.flatMap((g) => g.items);
  const statusFlatCount = isTaskCatalogType ? catalogFlat.length : spaceFlat.length;
  const pickStatus = (value: string) => {
    setStatus(value);
    setOpenMenu(null);
  };
  const onStatusKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setStatusHi((i) => (statusFlatCount ? (i + 1) % statusFlatCount : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setStatusHi((i) => (statusFlatCount ? (i - 1 + statusFlatCount) % statusFlatCount : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isTaskCatalogType) {
        const hit = catalogFlat[statusHi];
        if (hit) pickStatus(hit.key);
      } else {
        const hit = spaceFlat[statusHi];
        if (hit) pickStatus(hit.status.name);
      }
    } else if (e.key === 'Escape') {
      setOpenMenu(null);
    }
  };

  // ── self-assign circle ────────────────────────────────────────────────────
  const selfId = useAuthStore.getState().userId;
  const isSelfAssigned = !!selfId && assigneeIds.includes(selfId);
  const toggleSelfAssign = () => {
    if (!selfId) return;
    setAssigneeIds((cur) => (cur.includes(selfId) ? cur.filter((x) => x !== selfId) : [...cur, selfId]));
  };
  const selfName =
    (selfId && assignable.find((u) => u.id === selfId)?.display_name) ||
    (selfId && assignable.find((u) => u.id === selfId)?.email) ||
    'you';
  const lq = labelQuery.trim().toLowerCase();
  const filteredLabelGroups = (labelGroups || [])
    .map((g) => ({
      ...g,
      labels: g.labels.filter((l) => !lq || l.name.toLowerCase().includes(lq)),
    }))
    .filter((g) => g.labels.length > 0);

  if (authHydrated && !isAuthenticated) {
    return (
      <div className="qa-scroll" onKeyDown={onContainerKeyDown}>
        <div className="qa">
          <button
            type="button"
            className="qa-close"
            onClick={() => void win.hide()}
            title="Close (Esc)"
            aria-label="Close"
          >
            ×
          </button>
          <div className="qa-row">
            <span className="qa-icon">⚡</span>
            <div className="qa-signin-title">Sign in to SquadHub</div>
          </div>
          <p className="qa-signin-sub">
            Use your SquadHub account — the same one as the menu-bar app — to add tasks from here.
          </p>
          {loginError && <div className="qa-err">{loginError}</div>}
          <form className="qa-signin-form" onSubmit={(e) => void handleQuickSignIn(e)}>
            <input
              className="qa-signin-input"
              type="email"
              placeholder="you@company.com"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              autoFocus
              required
            />
            <input
              className="qa-signin-input"
              type="password"
              placeholder="Enter your password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              required
            />
            <button type="submit" className="qa-add-btn" disabled={loginLoading || !loginEmail.trim() || !loginPassword}>
              {loginLoading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
          <div className="qa-hint">Task title, labels and completion unlock after sign-in.</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="qa-scroll"
      onKeyDown={onContainerKeyDown}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={`qa${dragOver ? ' qa-drop-active' : ''}`}>
        {dragOver && <div className="qa-drop-overlay">Drop image to attach</div>}
        <button
          type="button"
          className="qa-close"
          onClick={() => void win.hide()}
          title="Close (Esc)"
          aria-label="Close"
        >
          ×
        </button>
      <div className="qa-row">
        <span className="qa-icon">+</span>
        <input
          ref={inputRef}
          className="qa-input"
          placeholder="Add a task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onTitleKeyDown}
          autoFocus
          disabled={phase === 'saving'}
        />
      </div>

      <div className="qa-desc">
        <textarea
          className="qa-textarea"
          placeholder="Add a description…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          disabled={phase === 'saving'}
        />
      </div>

      {/* Where: every recent location, scrollable */}
      <div className="qa-sec-label">Where</div>
      <div className="qa-chips qa-where">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`qa-chip${selectedList?.id === c.id ? ' active' : ''}`}
            onClick={() => pickList(c)}
            title={c.name}
          >
            {c.id === personalId ? '★ ' : ''}
            {c.name}
          </button>
        ))}
        <button
          type="button"
          className={`qa-chip qa-locsearch${openMenu === 'list' ? ' active' : ''}`}
          onClick={() => toggleMenu('list')}
          title="Search all locations"
          aria-label="Search locations"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>
      </div>

      {/* What: assignee first (circle self-assigns), then type/status/priority/labels */}
      <div className="qa-sec-label">What</div>
      <div className="qa-attrs">
        <span className="qa-assign-wrap">
          <button
            type="button"
            className={`qa-mecircle${isSelfAssigned ? ' on' : ''}`}
            title={isSelfAssigned ? `Assigned to ${selfName} — click to remove` : 'Assign to me'}
            aria-label={isSelfAssigned ? 'Remove self assignment' : 'Assign to me'}
            onClick={toggleSelfAssign}
          >
            {isSelfAssigned ? (
              <span className="qa-mecircle-initials">
                {initials(assignable.find((u) => u.id === selfId)?.display_name, assignable.find((u) => u.id === selfId)?.email)}
              </span>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className={`qa-pill${assigneeIds.length ? ' active' : ' muted'}`}
            onClick={() => toggleMenu('assignee')}
          >
            <span className="qa-pill-label">{assigneeLabel}</span>
          </button>
        </span>

        <button
          type="button"
          className={`qa-pill${taskTypeId ? ' active' : ' muted'}`}
          onClick={() => toggleMenu('type')}
        >
          <span className="qa-dot" style={{ background: currentType?.color || '#6b7280' }} />
          <span className="qa-pill-label">{currentType?.name || 'Type'}</span>
        </button>

        <button
          type="button"
          className="qa-pill active"
          onClick={() => toggleMenu('status')}
        >
          <span className="qa-dot" style={{ background: statusColor }} />
          <span className="qa-pill-label">{statusLabel}</span>
        </button>

        <button
          type="button"
          className={`qa-pill${priority !== 'none' ? ' active' : ' muted'}`}
          onClick={() => toggleMenu('priority')}
        >
          <span className="qa-dot" style={{ background: selectedPriority.color }} />
          <span className="qa-pill-label">{priority === 'none' ? 'Priority' : selectedPriority.label}</span>
        </button>

        <button
          type="button"
          className={`qa-pill${labelCount ? ' active' : ' muted'}`}
          onClick={() => toggleMenu('labels')}
          title={selectedList ? `Labels in ${selectedList.name}` : 'Labels'}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24H4a1 1 0 0 0-1 1v5.59a2 2 0 0 0 .59 1.41l9.58 9.59a2 2 0 0 0 2.83 0l4.59-4.59a2 2 0 0 0 0-2.83z" />
            <circle cx="7.5" cy="7.5" r="1" fill="currentColor" />
          </svg>
          <span className="qa-pill-label">{labelButtonText}</span>
        </button>
      </div>

      {/* When: work date, start→due range, estimate, logged */}
      <div className="qa-sec-label">When</div>
      <div className="qa-attrs">
        <button
          type="button"
          className={`qa-pill${workDate ? ' active' : ' muted'}`}
          onClick={() => toggleMenu('date')}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          <span className="qa-pill-label">{workDate ? `Work: ${dateLabel(workDate)}` : 'Work date'}</span>
        </button>

        <button
          type="button"
          className={`qa-pill${startDate || dueDate ? ' active' : ' muted'}`}
          onClick={() => toggleMenu('rangedate')}
        >
          <span aria-hidden>▶</span>
          <span className="qa-pill-label">
            {(startDate ? dateLabel(startDate) : 'Start')} → {(dueDate ? dateLabel(dueDate) : 'Due')}
          </span>
        </button>

        <button type="button" className={`qa-pill${estimateInput.trim() ? ' active' : ' muted'}`} onClick={() => toggleMenu('estimate')}>
          <span aria-hidden>◷</span>
          <span className="qa-pill-label">{estimateMinutes && estimateMinutes > 0 ? `Estimate ${formatDuration(estimateMinutes)}` : 'Estimate'}</span>
        </button>

        <button type="button" className={`qa-pill${loggedInput.trim() ? ' active' : ' muted'}`} onClick={() => toggleMenu('logged')}>
          <span aria-hidden>◴</span>
          <span className="qa-pill-label">{loggedMinutes && loggedMinutes > 0 ? `Logged ${formatDuration(loggedMinutes)}` : 'Time logged'}</span>
        </button>
      </div>

      {/* Details: focus, completion, timer */}
      <div className="qa-sec-label">Details</div>
      <div className="qa-attrs">
        <button
          type="button"
          className={`qa-pill qa-star${focused ? ' active' : ' muted'}`}
          onClick={() => setFocused((v) => !v)}
          title="Focus star"
        >
          {focused ? '★ Focused' : '☆ Focus'}
        </button>

        <button
          type="button"
          className={`qa-pill${completeOnCreate ? ' active' : ' muted'}`}
          onClick={() => {
            setCompleteOnCreate((v) => !v);
            setStartTimerOnCreate(false);
          }}
          title="Create this task already completed"
        >
          <span aria-hidden>✓</span>
          <span className="qa-pill-label">{completeOnCreate ? 'Complete on add' : 'Mark complete'}</span>
        </button>

        <button
          type="button"
          className={`qa-pill${startTimerOnCreate ? ' active' : ' muted'}`}
          onClick={() => {
            setStartTimerOnCreate((v) => !v);
            setCompleteOnCreate(false);
          }}
          aria-pressed={startTimerOnCreate}
          title="Start tracking as soon as this task is added"
        >
          <span aria-hidden>◷</span>
          <span className="qa-pill-label">{startTimerOnCreate ? 'Start timer on add' : 'Start timer'}</span>
        </button>
      </div>

      {labelCount > 0 && (
        <div className="qa-labelsel">
          {selectedLabels.map((t) => (
            <button
              key={t.id}
              type="button"
              className="qa-labelchip"
              onClick={() => toggleLabel(t)}
              title="Remove label"
            >
              <span className="qa-dot" style={{ background: t.color || '#6b7280' }} />
              <span className="qa-labelchip-name">{t.name}</span>
              <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}

      {/* Inline menus (one at a time; they push content down so nothing clips) */}
      {openMenu === 'list' && <ListPicker onPick={pickList} />}

      {(openMenu === 'logged' || openMenu === 'estimate') && (
        <div className="qa-menu qa-duration-menu">
          <label className="qa-duration-label" htmlFor="qa-duration-input">
            {openMenu === 'logged' ? 'Time already logged' : 'Time estimate'}
          </label>
          <input
            id="qa-duration-input"
            className="qa-search qa-duration-input"
            value={openMenu === 'logged' ? loggedInput : estimateInput}
            onChange={(e) => {
              if (openMenu === 'logged') setLoggedInput(e.target.value);
              else setEstimateInput(e.target.value);
              if (phase === 'error') { setPhase('idle'); setError(''); }
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setOpenMenu(null); } }}
            placeholder="1 hour 20 minutes"
            aria-invalid={!!(openMenu === 'logged' ? loggedInput.trim() && !loggedMinutes : estimateInput.trim() && !estimateMinutes)}
            autoFocus
          />
          <div className="qa-duration-hint">
            {openMenu === 'logged'
              ? 'Adds a time entry when you create the task.'
              : '1d = 8h · 1w = 5d'}
            {' · '}Try 1h 20m or 1:20.
          </div>
          <div className="qa-duration-readback">
            {openMenu === 'logged'
              ? loggedInput.trim() && (loggedMinutes && loggedMinutes > 0 ? formatDuration(loggedMinutes) : 'Enter a positive duration')
              : estimateInput.trim() && (estimateMinutes && estimateMinutes > 0 ? formatDuration(estimateMinutes) : 'Enter a positive duration')}
          </div>
        </div>
      )}

      {openMenu === 'priority' && (
        <div className="qa-menu">
          <div className="qa-menu-scroll">
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                type="button"
                className="qa-opt-row"
                onClick={() => {
                  setPriority(p.value);
                  setOpenMenu(null);
                }}
              >
                <span className="qa-dot" style={{ background: p.color }} />
                <span className="qa-opt-main">{p.label}</span>
                {priority === p.value && <span className="qa-check">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {openMenu === 'assignee' && (
        <div className="qa-menu">
          <div className="qa-menu-scroll">
            {assignable.length === 0 ? (
              <div className="qa-menu-empty">No assignable members</div>
            ) : (
              assignable.map((u) => {
                const on = assigneeIds.includes(u.id);
                return (
                  <button key={u.id} type="button" className="qa-opt-row" onClick={() => toggleAssignee(u.id)}>
                    <span className="qa-avatar">{initials(u.display_name, u.email)}</span>
                    <span className="qa-opt-main">{u.display_name || u.email}</span>
                    {on && <span className="qa-check">✓</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {openMenu === 'date' && (
        <div className="qa-menu">
          <div className="qa-quickchips">
            {[
              { label: 'Today', value: todayYmd() },
              { label: 'Tomorrow', value: tomorrowYmd() },
              { label: 'This weekend', value: weekendYmd() },
              { label: 'Next week', value: nextWeekYmd() },
            ].map((c) => (
              <button
                key={c.label}
                type="button"
                className={`qa-chip qa-qchip${workDate === c.value ? ' active' : ''}`}
                onClick={() => {
                  setWorkDate(c.value);
                  setOpenMenu(null);
                }}
              >
                <span className="qa-qchip-label">{c.label}</span>
                <span className="qa-qchip-sub">{shortDay(c.value)}</span>
              </button>
            ))}
          </div>
          <MiniCalendar
            value={workDate}
            onPick={(s) => {
              setWorkDate(s);
              setOpenMenu(null);
            }}
          />
          <div className="qa-menu-foot">
            <span>{workDate ? dateLabel(workDate) : 'No date set'}</span>
            <button
              type="button"
              className="qa-linkbtn"
              onClick={() => {
                setWorkDate(null);
                setOpenMenu(null);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {openMenu === 'rangedate' && (
        <div className="qa-menu">
          <div className="qa-quickchips">
            <button
              type="button"
              className="qa-chip"
              onClick={() => {
                setStartDate(todayYmd());
                setDueDate(tomorrowYmd());
                setOpenMenu(null);
              }}
            >
              <span className="qa-qchip-label">Today → Tomorrow</span>
            </button>
            <button
              type="button"
              className="qa-chip"
              onClick={() => {
                setStartDate(null);
                setDueDate(null);
                setOpenMenu(null);
              }}
            >
              <span className="qa-qchip-label">Clear dates</span>
            </button>
          </div>
          <div className="qa-range">
            <label>
              Start
              <input
                type="date"
                className="qa-date-input"
                value={startDate || ''}
                onChange={(e) => setStartDate(e.target.value || null)}
              />
            </label>
            <label>
              Due
              <input
                type="date"
                className="qa-date-input"
                value={dueDate || ''}
                onChange={(e) => setDueDate(e.target.value || null)}
              />
            </label>
          </div>
        </div>
      )}

      {openMenu === 'type' && (
        <div className="qa-menu">
          <input
            className="qa-search"
            autoFocus
            placeholder="Search task types (e.g. Focus, Plan, Call)…"
            value={typeSearch}
            onChange={(e) => {
              setTypeSearch(e.target.value);
              setTypeHi(0);
            }}
            onKeyDown={onTypeKeyDown}
          />
          <div className="qa-menu-scroll qa-type-scroll">
            {!taskTypes && <div className="qa-menu-empty">Loading task types…</div>}
            {taskTypes && typeGroups.length === 0 && (
              <div className="qa-menu-empty">No task types found — try a different term</div>
            )}
            {typeGroups.map((g) => (
              <div key={g.group}>
                <div className="qa-grouphead qa-type-group">
                  {g.group}
                  <span className="qa-type-count">{g.items.length}</span>
                </div>
                {g.items.map((t) => {
                  const flatIdx = typeFlat.indexOf(t);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`qa-opt-row qa-type-row${flatIdx === typeHi ? ' hi' : ''}`}
                      onClick={() => pickType(t.id)}
                      onMouseEnter={() => setTypeHi(flatIdx)}
                    >
                      <span className="qa-type-badge" style={{ backgroundColor: `${t.color}22`, color: t.color }}>
                        <span className="qa-dot" style={{ background: t.color }} />
                      </span>
                      <span className="qa-type-main">
                        <span className="qa-type-name">
                          {t.name}
                          {t.is_default && <span className="qa-type-default">Default</span>}
                        </span>
                        {!!t.description && <span className="qa-type-desc">{t.description}</span>}
                      </span>
                      {t.id === taskTypeId && <span className="qa-check">✓</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="qa-menu-foot">
            <span>{typeFlat.length} task type{typeFlat.length !== 1 ? 's' : ''}</span>
            <span>↑↓ navigate · ↵ pick</span>
          </div>
        </div>
      )}

      {openMenu === 'status' && (
        <div className="qa-menu">
          <div className="qa-status-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              className="qa-status-search-input"
              autoFocus
              placeholder="Search statuses (e.g. Focus, In Progress)…"
              value={statusSearch}
              onChange={(e) => {
                setStatusSearch(e.target.value);
                setStatusHi(0);
              }}
              onKeyDown={onStatusKeyDown}
            />
            {statusSearch && (
              <button
                type="button"
                className="qa-status-search-clear"
                onClick={() => setStatusSearch('')}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          <div className="qa-menu-hint">
            {isTaskCatalogType ? 'Task workflow statuses' : `Space statuses · ${currentType?.name || ''}`}
          </div>
          <div className="qa-menu-scroll qa-status-scroll">
            {isTaskCatalogType ? (
              catalogGroups.length === 0 ? (
                <div className="qa-menu-empty">
                  <div className="qa-empty-title">No statuses match “{statusSearch}”</div>
                  <div className="qa-empty-sub">Try searching with a different term</div>
                </div>
              ) : (
                catalogGroups.map((g) => (
                  <div key={g.group}>
                    <div className="qa-grouphead qa-status-group">
                      <span className="qa-status-group-label">
                        <span aria-hidden>{g.emoji}</span>
                        <span>{g.label}</span>
                      </span>
                      <span className="qa-type-count">{g.items.length}</span>
                    </div>
                    {g.items.map((s) => {
                      const flatIdx = catalogFlat.indexOf(s);
                      const selected = status === s.key;
                      return (
                        <button
                          key={s.key}
                          type="button"
                          className={`qa-opt-row qa-status-row${selected ? ' selected' : ''}${flatIdx === statusHi ? ' hi' : ''}`}
                          onClick={() => pickStatus(s.key)}
                          onMouseEnter={() => setStatusHi(flatIdx)}
                        >
                          <span className="qa-status-badge" style={{ backgroundColor: `${s.color}29`, color: s.color }}>
                            <span className="qa-dot" style={{ background: s.color }} />
                          </span>
                          <span className="qa-status-main">
                            <span className="qa-status-name">{s.label}</span>
                            {!!s.description && <span className="qa-status-desc">{s.description}</span>}
                          </span>
                          {selected && (
                            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )
            ) : spaceStatuses.length === 0 ? (
              <div className="qa-menu-empty">Loading statuses…</div>
            ) : spaceGroups.length === 0 ? (
              <div className="qa-menu-empty">
                <div className="qa-empty-title">No statuses found</div>
                <div className="qa-empty-sub">Try searching with a different term</div>
              </div>
            ) : (
              spaceGroups.map((g) => (
                <div key={g.groupName}>
                  <div className="qa-grouphead qa-status-group">
                    <span className="qa-status-group-label">
                      <span aria-hidden>{g.emoji}</span>
                      <span>{g.groupName}</span>
                    </span>
                    <span className="qa-type-count">{g.items.length}</span>
                  </div>
                  {g.items.map(({ status: s, description }) => {
                    const flatIdx = spaceFlat.findIndex((f) => f.status.id === s.id);
                    const selected = status === s.name;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`qa-opt-row qa-status-row${selected ? ' selected' : ''}${flatIdx === statusHi ? ' hi' : ''}`}
                        onClick={() => pickStatus(s.name)}
                        onMouseEnter={() => setStatusHi(flatIdx)}
                      >
                        <span className="qa-status-badge" style={{ backgroundColor: `${s.color}29`, color: s.color }}>
                          <span className="qa-dot" style={{ background: s.color }} />
                        </span>
                        <span className="qa-status-main">
                          <span className="qa-status-name">
                            {s.name}
                            {s.is_default && <span className="qa-type-default">Default</span>}
                          </span>
                          {!!description && <span className="qa-status-desc">{description}</span>}
                        </span>
                        {selected && (
                          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          <div className="qa-menu-foot">
            <span>{statusFlatCount} status{statusFlatCount !== 1 ? 'es' : ''} available</span>
            <span>↑↓ navigate · ↵ pick</span>
          </div>
        </div>
      )}

      {openMenu === 'labels' && (
        <div className="qa-menu">
          <input
            className="qa-search"
            autoFocus
            placeholder={selectedList ? `Search labels in ${selectedList.name}…` : 'Search labels…'}
            value={labelQuery}
            onChange={(e) => setLabelQuery(e.target.value)}
          />
          <div className="qa-menu-scroll">
            {!selectedList && <div className="qa-menu-empty">Pick a list to see its labels</div>}
            {selectedList && filteredLabelGroups.length === 0 && (
              <div className="qa-menu-empty">{lq ? 'No labels match' : 'No labels in this workspace yet'}</div>
            )}
            {filteredLabelGroups.map((g) => (
              <div key={g.group.id}>
                <div className="qa-grouphead">{g.group.name}</div>
                {g.labels.map((tag) => {
                  const on = selectedLabels.some((t) => t.id === tag.id);
                  return (
                    <button key={tag.id} type="button" className="qa-opt-row" onClick={() => toggleLabel(tag)}>
                      <span className="qa-dot" style={{ background: tag.color || '#6b7280' }} />
                      <span className="qa-opt-main">{tag.name}</span>
                      {on && <span className="qa-check">✓</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="qa-attachments">
          {attachments.map((a) => (
            <div key={a.id} className="qa-att" title={a.file.name}>
              {a.previewUrl ? (
                <img className="qa-att-thumb" src={a.previewUrl} alt={a.file.name} />
              ) : (
                <div className="qa-att-thumb qa-att-file">📎</div>
              )}
              <span className="qa-att-name">{a.file.name}</span>
              <button
                type="button"
                className="qa-att-remove"
                onClick={() => removeAttachment(a.id)}
                title="Remove"
                aria-label={`Remove ${a.file.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {bgJobs.some((j) => j.active || j.files.length > 0) && (
        <div className="qa-bgjobs">
          {bgJobs.filter((j) => j.active || j.files.length > 0).map((j) => (
            <div key={j.key} className="qa-bgjob">
              {j.active ? (
                <span className="qa-bg-note">
                  Uploading {j.files.length} {j.files.length === 1 ? 'attachment' : 'attachments'} · “{j.taskTitle}”
                </span>
              ) : (
                <>
                  <span className="qa-err">
                    “{j.taskTitle}” — {j.files.length} {j.files.length === 1 ? 'file' : 'files'} failed to upload
                  </span>
                  <button type="button" className="qa-chip" onClick={() => retryBgJob(j.key)}>
                    Retry
                  </button>
                  <button
                    type="button"
                    className="qa-att-remove"
                    onClick={() => dismissBgJob(j.key)}
                    title="Dismiss"
                    aria-label="Dismiss failed uploads"
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

<div className="qa-footer">
        <div className="qa-hint">
          {phase === 'saving' && <span>Adding…</span>}
          {phase === 'done' && <span className="qa-ok">Added ✓</span>}
          {phase === 'error' && <span className="qa-err">{error}</span>}
          {phase === 'idle' && (
            <span>
              <b>Enter</b> to add · <b>Esc</b> to dismiss
            </span>
          )}
        </div>
        <button
          type="button"
          className="qa-add-btn"
          onClick={() => void submit()}
          disabled={!title.trim() || phase === 'saving'}
        >
          Add a Task
        </button>
      </div>
      </div>
    </div>
  );
}

// ── list picker (search across all spaces/folders the user can post to) ───────
function ListPicker({ onPick }: { onPick: (l: SelectedList) => void }) {
  const [query, setQuery] = useState('');
  const [lists, setLists] = useState<PickableList[] | null>(pickCache);
  const [err, setErr] = useState('');

  useEffect(() => {
    // Show cached lists instantly but always re-validate in the background —
    // otherwise lists created since this window last opened never appear.
    let alive = true;
    loadPickableLists()
      .then((r) => alive && setLists(r))
      .catch((e) => {
        if (alive && !pickCache) setErr(e instanceof Error ? e.message : 'Failed to load lists');
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = query.trim().toLowerCase();
  const matches = (lists || []).filter(
    (l) =>
      !q ||
      l.name.toLowerCase().includes(q) ||
      l.spaceName.toLowerCase().includes(q) ||
      (l.folderName || '').toLowerCase().includes(q),
  );

  return (
    <div className="qa-menu">
      <input
        className="qa-search"
        autoFocus
        placeholder="Search lists…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="qa-menu-scroll">
        {err && <div className="qa-menu-empty">{err}</div>}
        {!err && !lists && <div className="qa-menu-empty">Loading lists…</div>}
        {!err && lists && matches.length === 0 && <div className="qa-menu-empty">No lists found</div>}
        {matches.map((l) => (
          <button key={l.id} type="button" className="qa-opt" onClick={() => onPick({ id: l.id, name: l.name, spaceId: l.spaceId })}>
            <span className="qa-opt-main">{l.name}</span>
            <span className="qa-opt-sub">{l.folderName ? `${l.spaceName} / ${l.folderName}` : l.spaceName}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
