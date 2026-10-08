import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import type { Task } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { showToast } from '../../../components/Toast';
import { useIsMobile } from '../../../hooks/useIsMobile';
import api from '../../../services/api';
import AddEntrySplitButton from './AddEntrySplitButton';
import {
  useWorkBlock,
  useActiveWorkBlockRun,
  usePatchWorkBlockConfig,
  useUpsertWorkBlockConfig,
  useLinkTaskToWorkBlock,
  useUnlinkTaskFromWorkBlock,
  type WorkBlockRun,
  type WorkBlockTaskTime,
  type WorkBlockCompletion,
} from '../../../hooks/useWorkBlocks';
import {
  describeRecurrence,
  formatMinute,
  minuteToInputTime,
  inputTimeToMinute,
  type Recurrence,
} from '../../../utils/workBlockRecurrence';
import TaskCreatePanel from './TaskCreatePanel';

interface Props {
  task: Task;
  canEdit: boolean;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return `${seconds}s`;
}

function formatRunDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `Today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Inline editor for the schedule (start / end / recurrence). Designed to be
// small and forgiving — the user can toggle out without saving.
function ScheduleEditor({
  taskId,
  initial,
  onClose,
}: {
  taskId: string;
  initial: { start_minute: number; end_minute: number; recurrence: Recurrence };
  onClose: () => void;
}) {
  const [startTime, setStartTime] = useState(minuteToInputTime(initial.start_minute));
  const [endTime, setEndTime] = useState(minuteToInputTime(initial.end_minute === 1440 ? 1439 : initial.end_minute));
  const [recurrence, setRecurrence] = useState<Recurrence>(initial.recurrence);
  const upsert = useUpsertWorkBlockConfig();
  const save = () => {
    const sm = inputTimeToMinute(startTime);
    const em = inputTimeToMinute(endTime);
    if (em <= sm) {
      // Surface inline rather than alert — the disabled save button does this.
      return;
    }
    upsert.mutate(
      { task_id: taskId, config: { start_minute: sm, end_minute: em, recurrence } },
      { onSuccess: () => onClose() },
    );
  };
  const sm = inputTimeToMinute(startTime);
  const em = inputTimeToMinute(endTime);
  const canSave = em > sm;

  return (
    <div className="wb-schedule-editor flex flex-col gap-2 rounded-lg border border-[color:var(--sh-hair-3)] bg-[color:var(--surface-alt)] p-3">
      <div className="flex items-center gap-2 text-[12px]">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide opacity-60">Start</span>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="rounded border border-[color:var(--sh-hair-3)] bg-[color:var(--surface)] px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide opacity-60">End</span>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="rounded border border-[color:var(--sh-hair-3)] bg-[color:var(--surface)] px-2 py-1"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[12px]">
        <span className="text-[10px] uppercase tracking-wide opacity-60">Repeats</span>
        <select
          value={recurrence.kind}
          onChange={(e) => {
            const kind = e.target.value as Recurrence['kind'];
            setRecurrence((r) => ({
              ...r,
              kind,
              weekdays: kind === 'weekly' ? r.weekdays ?? [1] : undefined,
              day_of_month: kind === 'monthly' ? r.day_of_month ?? 1 : undefined,
            }));
          }}
          className="rounded border border-[color:var(--sh-hair-3)] bg-[color:var(--surface)] px-2 py-1"
        >
          <option value="none">Does not repeat</option>
          <option value="daily">Every day</option>
          <option value="weekdays">Every weekday</option>
          <option value="weekly">Weekly on…</option>
          <option value="monthly">Monthly on a day</option>
        </select>
      </label>
      {recurrence.kind === 'weekly' && (
        <div className="flex flex-wrap gap-1 text-[11px]">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, idx) => {
            const active = recurrence.weekdays?.includes(idx) ?? false;
            return (
              <button
                key={idx}
                type="button"
                onClick={() =>
                  setRecurrence((r) => {
                    const set = new Set(r.weekdays || []);
                    set.has(idx) ? set.delete(idx) : set.add(idx);
                    return { ...r, weekdays: Array.from(set).sort() };
                  })
                }
                className="rounded border px-2 py-1"
                style={{
                  borderColor: active ? 'var(--sh-accent)' : 'var(--sh-hair-3)',
                  background: active ? 'color-mix(in oklch, var(--sh-accent) 18%, transparent)' : 'var(--surface)',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {recurrence.kind === 'monthly' && (
        <label className="flex items-center gap-2 text-[12px]">
          <span className="opacity-60">Day of month:</span>
          <input
            type="number"
            min={1}
            max={28}
            value={recurrence.day_of_month ?? 1}
            onChange={(e) =>
              setRecurrence((r) => ({ ...r, day_of_month: Math.max(1, Math.min(28, parseInt(e.target.value, 10) || 1)) }))
            }
            className="w-16 rounded border border-[color:var(--sh-hair-3)] bg-[color:var(--surface)] px-2 py-1"
          />
        </label>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-[12px] opacity-70 hover:opacity-100">
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave || upsert.isPending}
          className="rounded bg-[color:var(--sh-ink)] px-3 py-1 text-[12px] font-medium text-[color:var(--surface)] disabled:opacity-40"
        >
          {upsert.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ── Link-a-task quick search ────────────────────────────────────────────────
// Deliberately narrower than useWorkspaceSearch (which also sweeps chat
// messages): the inline link row only needs task titles, and this fires on
// every keystroke while the row is open.
interface LinkSearchTask {
  id: string;
  title: string;
  status: string | null;
  priority: string | null;
  list_name: string | null;
  space_name: string | null;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// The row accepts a bare task id, a pasted task URL, or a typed title.
function taskIdFromInput(raw: string): string | null {
  const match = raw.match(UUID_RE);
  return match ? match[0] : null;
}

function useTaskSearch(workspaceId: string | undefined, query: string, enabled: boolean) {
  const q = query.trim();
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    if (!enabled || !q) {
      setDebounced('');
      return undefined;
    }
    const timer = window.setTimeout(() => setDebounced(q), 180);
    return () => window.clearTimeout(timer);
  }, [q, enabled]);

  return useQuery<LinkSearchTask[]>({
    queryKey: ['pm-task-link-search', workspaceId ?? '', debounced],
    queryFn: async () => {
      const res = await api.get('/pm/search', {
        params: { workspace_id: workspaceId, q: debounced, limit: 8 },
      });
      return (res.data?.data?.tasks || []) as LinkSearchTask[];
    },
    enabled: !!workspaceId && !!debounced && enabled,
    staleTime: 30_000,
  });
}

export default function WorkBlockSections({ task, canEdit }: Props) {
  const { data: bundle } = useWorkBlock(task.id);
  const { data: active } = useActiveWorkBlockRun();
  const unlink = useUnlinkTaskFromWorkBlock();
  const link = useLinkTaskToWorkBlock();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  // Linked tasks — mirrors the Subtasks tray: collapsible header, inline
  // add row, rows that open the task they point at.
  const isMobile = useIsMobile();
  const [linksCollapsed, setLinksCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [linkQuery, setLinkQuery] = useState('');
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const linksOpen = isMobile || !linksCollapsed;
  const links = bundle?.links || [];
  const search = useTaskSearch(workspaceId, linkQuery, adding);
  const candidates = (search.data || []).filter(
    (t) => t.id !== task.id && !links.some((l) => l.linked_task_id === t.id),
  );
  const setPeekTask = usePMStore((s) => s.setPeekTask);
  const linkToBlock = (linkedTaskId: string) => {
    if (linkedTaskId === task.id) {
      showToast('A time block cannot link to itself', 'error');
      return;
    }
    link.mutate(
      { work_block_task_id: task.id, linked_task_id: linkedTaskId },
      {
        onSuccess: () => setLinkQuery(''),
        onError: () => showToast('Could not link that task', 'error'),
      },
    );
  };

  const config = bundle?.config || null;
  const activeRunForThisBlock: WorkBlockRun | null = useMemo(() => {
    if (!active || active.task.id !== task.id) return null;
    // Find the bundle row that matches the active run id (so we get its
    // completions[] array hydrated). Fallback to the active payload's run.
    const matched = (bundle?.runs || []).find((r) => r.id === active.run.id);
    return matched || (active.run as WorkBlockRun);
  }, [active, bundle?.runs, task.id]);

  const pastRuns = (bundle?.runs || []).filter((r) => r.ended_at);

  return (
    <div className="wb-sections flex flex-col gap-4 border-t border-[color:var(--sh-hair-3)] pt-4">
      {/* Schedule row */}
      <section>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide opacity-60">Schedule</h4>
        {editing ? (
          <ScheduleEditor
            taskId={task.id}
            initial={{
              start_minute: config?.start_minute ?? 9 * 60,
              end_minute: config?.end_minute ?? 10 * 60,
              recurrence: config?.recurrence ?? { kind: 'none' },
            }}
            onClose={() => setEditing(false)}
          />
        ) : config ? (
          <button
            type="button"
            onClick={() => canEdit && setEditing(true)}
            className="flex w-full items-center gap-3 rounded-lg border border-[color:var(--sh-hair-3)] bg-[color:var(--surface-alt)] px-3 py-2 text-left text-[12px] hover:border-[color:var(--sh-accent)]"
          >
            <span className="font-medium">
              {formatMinute(config.start_minute)} – {formatMinute(config.end_minute === 1440 ? 1439 : config.end_minute)}
            </span>
            <span className="opacity-60">·</span>
            <span className="opacity-80">{describeRecurrence(config.recurrence)}</span>
          </button>
        ) : (
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => setEditing(true)}
            className="rounded border border-dashed border-[color:var(--sh-hair-3)] px-3 py-2 text-[12px] opacity-70 hover:opacity-100"
          >
            + Set schedule
          </button>
        )}
      </section>

      {/* Activity during this run (live) — merges per-task timer overlaps
          with task completions so the user sees "what did I touch + what
          did I finish" in one place. */}
      {activeRunForThisBlock && !activeRunForThisBlock.ended_at && (
        <ActivitySection
          run={activeRunForThisBlock}
          title="Activity during this run"
          emptyHint="Nothing yet — start a task timer or mark a task done while this run is active."
          live
        />
      )}

      {/* Manually linked tasks — a first-class tray, structured exactly like
          the Subtasks tray so the panel reads as one system. */}
      <div className="td-section-rule" style={{ margin: 0 }} />
      <section className="td-tray" data-sec="linked-tasks" data-open={linksOpen ? 'true' : undefined}>
        <div className="td-section-strong">
          <button
            type="button"
            className="td-sec-toggle"
            data-open={linksOpen ? 'true' : undefined}
            aria-expanded={linksOpen}
            onClick={() => setLinksCollapsed((prev) => !prev)}
          >
            <svg className="chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m6 9 6 6 6-6" />
            </svg>
            <span className="title">Linked tasks</span>
          </button>
          {links.length > 0 && <span className="td-section-count-strong">{links.length}</span>}
          {canEdit && (
            <AddEntrySplitButton
              label="Link task"
              sectionLabel="New task…"
              onAdd={() => {
                setLinksCollapsed(false);
                setAdding(true);
                window.setTimeout(() => linkInputRef.current?.focus(), 0);
              }}
              onAddSection={() => {
                setLinksCollapsed(false);
                setCreating(true);
              }}
              disabled={adding}
            />
          )}
        </div>
        <div className="td-tray-card">
          {linksOpen && (links.length > 0 || canEdit || adding) && (
            <div className="td-subtask-list">
              {links.map((l) => {
                const linked = l.task;
                return (
                  <button
                    key={l.linked_task_id}
                    type="button"
                    className="td-subtask-row"
                    onClick={() => setPeekTask(l.linked_task_id)}
                    title={linked?.title ?? l.linked_task_id}
                  >
                    <span className="td-link-ico" aria-hidden>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                    </span>
                    <span className="title">{linked?.title ?? 'Untitled task'}</span>
                    {linked?.status && <span className="td-subtask-code">{linked.status}</span>}
                    {canEdit && (
                      <span
                        role="button"
                        tabIndex={0}
                        className="td-link-x"
                        title="Unlink"
                        onClick={(e) => {
                          e.stopPropagation();
                          unlink.mutate(
                            { work_block_task_id: task.id, linked_task_id: l.linked_task_id },
                            { onError: () => showToast('Could not unlink that task', 'error') },
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          e.stopPropagation();
                          unlink.mutate(
                            { work_block_task_id: task.id, linked_task_id: l.linked_task_id },
                            { onError: () => showToast('Could not unlink that task', 'error') },
                          );
                        }}
                      >
                        ×
                      </span>
                    )}
                  </button>
                );
              })}

              {adding && candidates.length > 0 && (
                <div className="td-link-results">
                  {candidates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="td-link-result"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => linkToBlock(t.id)}
                    >
                      <span className="title">{t.title}</span>
                      <span className="td-subtask-mini">
                        {[t.space_name, t.list_name].filter(Boolean).join(' / ') || '—'}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {canEdit && adding ? (
                <input
                  ref={linkInputRef}
                  autoFocus
                  value={linkQuery}
                  onChange={(e) => setLinkQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const uuid = taskIdFromInput(linkQuery);
                      if (uuid) linkToBlock(uuid);
                      else if (candidates[0]) linkToBlock(candidates[0].id);
                      else if (linkQuery.trim()) showToast('No matching task found', 'error');
                    } else if (e.key === 'Escape') {
                      e.stopPropagation();
                      setAdding(false);
                    }
                  }}
                  onBlur={() => setAdding(false)}
                  placeholder="Search a task to link…"
                  className="td-link-input"
                />
              ) : canEdit ? (
                <button
                  type="button"
                  className="td-subtask-add-row"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setAdding(true);
                  }}
                  onClick={() => setAdding(true)}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span>Link a task</span>
                </button>
              ) : null}
            </div>
          )}
          {linksOpen && links.length === 0 && !canEdit && !adding && (
            <p className="text-[12.5px] text-[color:var(--sh-ink-4)]">No linked tasks.</p>
          )}
        </div>
      </section>

      {/* Run history */}
      {pastRuns.length > 0 && (
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide opacity-60">Run history</h4>
          <ul className="flex flex-col gap-2">
            {pastRuns.slice(0, 10).map((r) => {
              const activityRows = mergeActivity(r);
              return (
                <li
                  key={r.id}
                  className="rounded border border-[color:var(--sh-hair-3)] bg-[color:var(--surface-alt)] px-3 py-2 text-[12px]"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{formatRunDate(r.started_at)}</span>
                    <span className="opacity-50">·</span>
                    <span className="opacity-80">{formatDuration(r.duration_seconds)}</span>
                    <span className="opacity-50">·</span>
                    <span className="opacity-80">{activityRows.length} task{activityRows.length === 1 ? '' : 's'}</span>
                  </div>
                  {activityRows.length > 0 && (
                    <ul className="mt-1.5 flex flex-col gap-0.5">
                      {activityRows.map((row) => (
                        <li key={row.taskId}>
                          <ActivityRowItem row={row} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Create a task from inside the block — same drawer the global "+" uses,
          portaled to <body> so the detail panel's backdrop-filter can't trap it.
          The new task is linked to this block the moment it's created. */}
      {creating &&
        typeof document !== 'undefined' &&
        createPortal(
          <TaskCreatePanel
            key={`wb-create-${task.id}`}
            pickable
            workspaceId={workspaceId}
            initialSpaceId={task.space?.id ?? null}
            initialListId={task.list_id}
            initialDraft={{
              title: '',
              description: '',
              status: 'todo',
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
            }}
            onCreated={(created) => {
              link.mutate(
                { work_block_task_id: task.id, linked_task_id: created.id },
                {
                  onSuccess: () => setCreating(false),
                  onError: (err) => {
                    console.error('Failed to link new task to time block:', err);
                    showToast('Task created, but could not link it to this time block', 'error');
                    setCreating(false);
                  },
                },
              );
            }}
            onClose={() => setCreating(false)}
          />,
          document.body,
        )}
    </div>
  );
}

// =========================================================================
// Activity merger: collapse a run's task_times[] + completions[] into one
// row per task with totalSeconds + completed flag. Live rows (ended_at===null)
// get their elapsed counted from started_at to now so the UI ticks.
// =========================================================================
interface ActivityRow {
  taskId: string;
  title: string;
  totalSeconds: number;
  completed: boolean;
  hasOpenTimer: boolean;
}

function mergeActivity(run: WorkBlockRun, nowMs: number = Date.now()): ActivityRow[] {
  const byTask = new Map<string, ActivityRow>();
  const ensure = (taskId: string, title: string): ActivityRow => {
    const row = byTask.get(taskId);
    if (row) return row;
    const fresh: ActivityRow = { taskId, title, totalSeconds: 0, completed: false, hasOpenTimer: false };
    byTask.set(taskId, fresh);
    return fresh;
  };

  for (const tt of (run.task_times || []) as WorkBlockTaskTime[]) {
    const row = ensure(tt.task_id, tt.task?.title ?? tt.task_id);
    if (tt.duration_seconds && tt.duration_seconds > 0) {
      row.totalSeconds += tt.duration_seconds;
    } else if (!tt.ended_at) {
      row.hasOpenTimer = true;
      row.totalSeconds += Math.max(0, Math.floor((nowMs - new Date(tt.started_at).getTime()) / 1000));
    }
  }
  for (const c of (run.completions || []) as WorkBlockCompletion[]) {
    const row = ensure(c.completed_task_id, c.task?.title ?? c.completed_task_id);
    row.completed = true;
  }
  // Stable order: tasks with the most time first; then completed-only; then alphabetical.
  return Array.from(byTask.values()).sort((a, b) => {
    if (a.totalSeconds !== b.totalSeconds) return b.totalSeconds - a.totalSeconds;
    if (a.completed !== b.completed) return a.completed ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

// Shared row renderer for both live activity and run history. Each row is a
// clickable button that opens the linked task; status pills are tinted by kind.
function ActivityRowItem({ row }: { row: ActivityRow }) {
  const setPeekTask = usePMStore((s) => s.setPeekTask);
  return (
    <button
      type="button"
      onClick={() => setPeekTask(row.taskId)}
      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-[color:var(--sh-hair-3)]"
    >
      <span
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
          row.hasOpenTimer ? 'animate-pulse bg-emerald-500' : 'bg-[color:var(--sh-ink-4)]'
        }`}
      />
      <span className="flex-1 truncate">{row.title}</span>
      {row.totalSeconds > 0 && (
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums"
          style={{
            background: row.hasOpenTimer
              ? 'color-mix(in oklch, #10b981 18%, transparent)'
              : 'color-mix(in oklch, #8b5cf6 14%, transparent)',
            color: row.hasOpenTimer ? '#047857' : '#5b21b6',
          }}
        >
          {formatDuration(row.totalSeconds)}
        </span>
      )}
      {row.completed && (
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
          style={{
            background: 'color-mix(in oklch, #7c3aed 14%, transparent)',
            color: '#5b21b6',
          }}
        >
          Completed
        </span>
      )}
    </button>
  );
}

function ActivitySection({
  run,
  title,
  emptyHint,
  live = false,
}: {
  run: WorkBlockRun;
  title: string;
  emptyHint: string;
  live?: boolean;
}) {
  // Tick once per second when live so open task-time durations advance.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return undefined;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live]);

  const rows = useMemo(() => mergeActivity(run, nowMs), [run, nowMs]);

  return (
    <section>
      <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide opacity-70">
        {live && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />}
        {title}
      </h4>
      {rows.length === 0 ? (
        <p className="text-[12px] opacity-60">{emptyHint}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.taskId}>
              <ActivityRowItem row={row} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
