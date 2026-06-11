import { useState } from 'react';
import { describeTaskRecurrence } from '@squadhub/shared';
import { useRoutines, useSetRoutinePaused, useRunRoutineNow, useDeleteRoutine, type Routine } from '../../hooks/useRoutines';
import { usePMStore } from '../../stores/pmStore';
import { showToast } from '../../components/Toast';
import GlobalCreateTaskModal from './pm/GlobalCreateTaskModal';

// Routines management view: every recurring-task template the user can see,
// with its cadence, location, next firing date and pause/run-now controls.
// Templates never appear in normal task lists — this page is where they live.

function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function initialOf(name: string | undefined | null): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

// "Today" / "Tomorrow" / "Mon, Jun 16" for a YYYY-MM-DD next-run date.
function formatRunDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

const REPEAT_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </svg>
);

function RoutineRow({ routine }: { routine: Routine }) {
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const setPaused = useSetRoutinePaused();
  const runNow = useRunRoutineNow();
  const deleteRoutine = useDeleteRoutine();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const paused = !!routine.recurrence_paused;
  const location = [routine.space?.name, routine.folder?.name, routine.list?.name]
    .filter(Boolean)
    .join(' / ');

  return (
    <div
      className="group grid cursor-pointer items-center gap-3 border-b px-4 py-[10px] transition hover:bg-[color:var(--sh-hair-3)]"
      style={{
        borderColor: 'var(--sh-hair-2)',
        gridTemplateColumns: 'minmax(220px, 2fr) minmax(150px, 1.2fr) minmax(120px, 1fr) 80px 110px 150px',
        opacity: paused ? 0.55 : 1,
      }}
      onClick={() => setActiveTask(routine.id)}
      title="Open routine"
    >
      {/* Title + location */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[#a855f7]">{REPEAT_ICON}</span>
          <span className="truncate text-[13.5px] font-medium text-[color:var(--sh-ink)]">{routine.title}</span>
          {paused && (
            <span className="shrink-0 rounded-full border px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-[color:var(--sh-ink-3)]" style={{ borderColor: 'var(--sh-hair)' }}>
              Paused
            </span>
          )}
        </div>
        {location && (
          <div className="mt-[2px] truncate pl-[22px] text-[11.5px] text-[color:var(--sh-ink-4)]">{location}</div>
        )}
      </div>

      {/* Cadence */}
      <div className="truncate text-[12.5px] text-[color:var(--sh-ink-2)]">
        {describeTaskRecurrence(routine.recurrence)}
        {routine.recurrence?.ends_on && (
          <span className="text-[color:var(--sh-ink-4)]"> · until {routine.recurrence.ends_on}</span>
        )}
      </div>

      {/* Assignees */}
      <div className="flex items-center">
        {(routine.assignees || []).length === 0 && (
          <span className="text-[12px] text-[color:var(--sh-ink-4)]">Unassigned</span>
        )}
        {(routine.assignees || []).slice(0, 3).map((u) => (
          <span
            key={u.id}
            title={u.display_name || u.email}
            className="-ml-1 grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-white first:ml-0"
            style={{ background: `oklch(0.6 0.12 ${hashHue(u.id)})`, border: '2px solid var(--surface)' }}
          >
            {initialOf(u.display_name || u.email)}
          </span>
        ))}
        {(routine.assignees || []).length > 3 && (
          <span className="ml-1 text-[11px] text-[color:var(--sh-ink-3)]">+{(routine.assignees || []).length - 3}</span>
        )}
      </div>

      {/* Spawn count */}
      <div className="text-[12.5px] tabular-nums text-[color:var(--sh-ink-2)]">{routine.instance_count}×</div>

      {/* Next run */}
      <div className="text-[12.5px] text-[color:var(--sh-ink-2)]">
        {paused ? '—' : formatRunDate(routine.next_occurrence)}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-1 opacity-0 transition group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          disabled={runNow.isPending}
          onClick={() => {
            runNow.mutate(routine.id, {
              onSuccess: (data) => showToast(data.outcome === 'created' ? 'Today’s copy created' : 'Already created for today'),
            });
          }}
          className="rounded-[7px] border px-2 py-1 text-[11.5px] text-[color:var(--sh-ink-2)] hover:bg-[color:var(--sh-hair-3)] hover:text-[color:var(--sh-ink)] disabled:opacity-50"
          style={{ borderColor: 'var(--sh-hair)' }}
          title="Create today's copy now"
        >
          Run now
        </button>
        <button
          type="button"
          onClick={() => setPaused.mutate({ id: routine.id, paused: !paused })}
          className="rounded-[7px] border px-2 py-1 text-[11.5px] text-[color:var(--sh-ink-2)] hover:bg-[color:var(--sh-hair-3)] hover:text-[color:var(--sh-ink)]"
          style={{ borderColor: 'var(--sh-hair)' }}
          title={paused ? 'Resume spawning' : 'Pause spawning'}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!confirmingDelete) {
              setConfirmingDelete(true);
              window.setTimeout(() => setConfirmingDelete(false), 2500);
              return;
            }
            deleteRoutine.mutate(routine.id, {
              onSuccess: () => showToast('Routine deleted — past copies kept'),
            });
          }}
          className={`rounded-[7px] border px-2 py-1 text-[11.5px] transition ${
            confirmingDelete
              ? 'border-red-400 bg-red-500/10 text-red-500'
              : 'text-[color:var(--sh-ink-3)] hover:bg-[color:var(--sh-hair-3)] hover:text-red-500'
          }`}
          style={confirmingDelete ? undefined : { borderColor: 'var(--sh-hair)' }}
          title="Delete this routine (already-created copies are kept)"
        >
          {confirmingDelete ? 'Sure?' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

export default function RoutinesView() {
  const { data: routines, isLoading } = useRoutines();
  const [showCreate, setShowCreate] = useState(false);

  const active = (routines || []).filter((r) => !r.recurrence_paused);
  const paused = (routines || []).filter((r) => r.recurrence_paused);

  return (
    <div className="sh-view h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1060px] px-6 pb-16 pt-8">
        {/* Header */}
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2
              className="serif text-[32px] text-[var(--sh-ink)]"
              style={{ fontFamily: 'var(--font-serif, Plus Jakarta Sans, sans-serif)', letterSpacing: '-0.01em' }}
            >
              Routines
            </h2>
            <p className="mt-1 max-w-[560px] text-[12.5px] leading-relaxed text-[color:var(--sh-ink-3)]">
              Recurring tasks. Each routine creates a fresh copy of itself on schedule — assignees,
              description and checklists included — so daily and weekly work shows up on its own.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-[9px] bg-[var(--sh-ink)] px-3 py-[7px] text-[12.5px] font-medium text-[var(--surface)] transition hover:opacity-90"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            New routine
          </button>
        </div>

        {isLoading ? (
          <div className="py-20 text-center text-[13px] text-[color:var(--sh-ink-3)]">Loading routines…</div>
        ) : (routines || []).length === 0 ? (
          <div
            className="flex flex-col items-center rounded-2xl border border-dashed px-6 py-16 text-center"
            style={{ borderColor: 'var(--sh-hair)' }}
          >
            <div className="mb-3 grid h-12 w-12 place-items-center rounded-full text-[#a855f7]" style={{ background: 'color-mix(in oklch, #a855f7 12%, transparent)' }}>
              {REPEAT_ICON}
            </div>
            <h3 className="text-[15px] font-medium text-[color:var(--sh-ink)]">No routines yet</h3>
            <p className="mt-1 max-w-[420px] text-[12.5px] leading-relaxed text-[color:var(--sh-ink-3)]">
              Create one here, or open any task and set <strong>Repeat</strong> in its detail panel.
              A daily stand-up doc, a Monday report, invoicing on the 1st — set it once and the task
              keeps coming back.
            </p>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="mt-4 rounded-[9px] bg-[var(--sh-ink)] px-3.5 py-[7px] text-[12.5px] font-medium text-[var(--surface)] transition hover:opacity-90"
            >
              New routine
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface)' }}>
            {/* Column headers */}
            <div
              className="grid items-center gap-3 border-b px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-[color:var(--sh-ink-4)]"
              style={{
                borderColor: 'var(--sh-hair-2)',
                gridTemplateColumns: 'minmax(220px, 2fr) minmax(150px, 1.2fr) minmax(120px, 1fr) 80px 110px 150px',
                background: 'var(--surface-alt, transparent)',
              }}
            >
              <span>Routine</span>
              <span>Repeats</span>
              <span>Assignees</span>
              <span>Spawned</span>
              <span>Next run</span>
              <span />
            </div>
            {[...active, ...paused].map((r) => (
              <RoutineRow key={r.id} routine={r} />
            ))}
          </div>
        )}

        {(routines || []).length > 0 && (
          <p className="mt-3 text-[11.5px] text-[color:var(--sh-ink-4)]">
            New copies are created shortly after midnight (IST). Tip: any task can become a routine —
            open it and set <strong>Repeat</strong>.
          </p>
        )}
      </div>

      {showCreate && <GlobalCreateTaskModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
