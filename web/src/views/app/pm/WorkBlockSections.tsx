import { useEffect, useMemo, useState } from 'react';
import type { Task } from '@squadhub/shared';
import { usePMStore } from '../../../stores/pmStore';
import {
  useWorkBlock,
  useActiveWorkBlockRun,
  usePatchWorkBlockConfig,
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
  const patch = usePatchWorkBlockConfig();
  const save = () => {
    const sm = inputTimeToMinute(startTime);
    const em = inputTimeToMinute(endTime);
    if (em <= sm) {
      // Surface inline rather than alert — the disabled save button does this.
      return;
    }
    patch.mutate(
      { task_id: taskId, patch: { start_minute: sm, end_minute: em, recurrence } },
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
          disabled={!canSave || patch.isPending}
          className="rounded bg-[color:var(--sh-ink)] px-3 py-1 text-[12px] font-medium text-[color:var(--surface)] disabled:opacity-40"
        >
          {patch.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function WorkBlockSections({ task, canEdit }: Props) {
  const { data: bundle } = useWorkBlock(task.id);
  const { data: active } = useActiveWorkBlockRun();
  const unlink = useUnlinkTaskFromWorkBlock();
  const link = useLinkTaskToWorkBlock();
  const [editing, setEditing] = useState(false);
  const [linkInput, setLinkInput] = useState('');

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

      {/* Manually linked tasks */}
      <section>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide opacity-60">Linked tasks</h4>
        <ul className="flex flex-col gap-1.5">
          {(bundle?.links || []).map((l) => (
            <li key={l.linked_task_id} className="flex items-center gap-2 text-[12px]">
              <span className="flex-1">{l.task?.title ?? l.linked_task_id}</span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => unlink.mutate({ work_block_task_id: task.id, linked_task_id: l.linked_task_id })}
                  className="opacity-50 hover:opacity-100"
                  title="Unlink"
                >
                  ×
                </button>
              )}
            </li>
          ))}
          {(bundle?.links || []).length === 0 && (
            <li className="text-[12px] opacity-60">No linked tasks.</li>
          )}
        </ul>
        {canEdit && (
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="Paste task ID to link…"
              className="flex-1 rounded border border-[color:var(--sh-hair-3)] bg-[color:var(--surface)] px-2 py-1 text-[12px]"
            />
            <button
              type="button"
              disabled={!linkInput.trim() || link.isPending}
              onClick={() => {
                link.mutate(
                  { work_block_task_id: task.id, linked_task_id: linkInput.trim() },
                  { onSuccess: () => setLinkInput('') },
                );
              }}
              className="rounded bg-[color:var(--sh-ink)] px-2 py-1 text-[12px] font-medium text-[color:var(--surface)] disabled:opacity-40"
            >
              Link
            </button>
          </div>
        )}
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
            background: 'color-mix(in oklch, #10b981 14%, transparent)',
            color: '#047857',
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
