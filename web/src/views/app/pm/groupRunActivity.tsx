import { usePMStore } from '../../../stores/pmStore';
import type { GroupRun, GroupRunTaskTime, GroupRunCompletion } from '../../../hooks/useGroupRuns';

// Shared formatting + activity-merge helpers for the group-run UI (the header
// control popover and the grouped-task detail panel both use these).

export function formatClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return `${seconds}s`;
}

export function formatRunDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `Today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export interface ActivityRow {
  taskId: string;
  title: string;
  totalSeconds: number;
  completed: boolean;
  hasOpenTimer: boolean;
}

// Collapse a run's task_times[] + completions[] into one row per task. Live
// rows (ended_at===null) count elapsed from started_at to `nowMs` so the UI ticks.
export function mergeActivity(run: GroupRun, nowMs: number = Date.now()): ActivityRow[] {
  const byTask = new Map<string, ActivityRow>();
  const ensure = (taskId: string, title: string): ActivityRow => {
    const existing = byTask.get(taskId);
    if (existing) return existing;
    const fresh: ActivityRow = { taskId, title, totalSeconds: 0, completed: false, hasOpenTimer: false };
    byTask.set(taskId, fresh);
    return fresh;
  };
  for (const tt of (run.task_times || []) as GroupRunTaskTime[]) {
    const row = ensure(tt.task_id, tt.task?.title ?? tt.task_id);
    if (tt.duration_seconds && tt.duration_seconds > 0) row.totalSeconds += tt.duration_seconds;
    else if (!tt.ended_at) {
      row.hasOpenTimer = true;
      row.totalSeconds += Math.max(0, Math.floor((nowMs - new Date(tt.started_at).getTime()) / 1000));
    }
  }
  for (const c of (run.completions || []) as GroupRunCompletion[]) {
    ensure(c.completed_task_id, c.task?.title ?? c.completed_task_id).completed = true;
  }
  return Array.from(byTask.values()).sort((a, b) => {
    if (a.totalSeconds !== b.totalSeconds) return b.totalSeconds - a.totalSeconds;
    if (a.completed !== b.completed) return a.completed ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

export function ActivityRowItem({ row }: { row: ActivityRow }) {
  const setPeekTask = usePMStore((s) => s.setPeekTask);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setPeekTask(row.taskId); }}
      className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-[color:var(--sh-hair-3)]"
    >
      <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${row.hasOpenTimer ? 'animate-pulse bg-emerald-500' : 'bg-[color:var(--sh-ink-4)]'}`} />
      <span className="flex-1 truncate">{row.title}</span>
      {row.totalSeconds > 0 && (
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums"
          style={{
            background: row.hasOpenTimer ? 'color-mix(in oklch, #10b981 18%, transparent)' : 'color-mix(in oklch, #8b5cf6 14%, transparent)',
            color: row.hasOpenTimer ? '#047857' : '#5b21b6',
          }}
        >
          {formatDuration(row.totalSeconds)}
        </span>
      )}
      {row.completed && (
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: 'color-mix(in oklch, #7c3aed 14%, transparent)', color: '#5b21b6' }}>
          Completed
        </span>
      )}
    </button>
  );
}
