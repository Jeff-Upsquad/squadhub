'use client';

/**
 * Mobile Home for partners and internal staff — a port of the **Partner**
 * Android app's `ui/home/HomeScreen.kt`, which is a different screen from the
 * Business app's spaces-first Home:
 *
 *   briefing grid  →  action chips  →  today's list  →  the workspace tree
 *
 * The briefing leads with a carbon TODAY statement tile (count set in the
 * display serif) flanked by Overdue and New, with Tomorrow and All-open as
 * quiet stats beneath. That's the partner's question — "what am I on the hook
 * for today" — where a client's is "which of my spaces do I want".
 */

import type { Task } from '@squadhub/shared';
import { useMyTasksSummary } from '../hooks/useMyTasksSummary';
import { useNewTasks } from '../hooks/useNewTasks';
import { usePMStore } from '../stores/pmStore';
import { MGroupHead, MIcon } from './MobileKit';
import { MobileSpaceGroups } from './MobileHome';
import { useMobileSpaces, type OpenTarget } from './useMobileSpaces';

export type PartnerAction = 'my-home' | 'meetings' | 'checkin' | 'my-tasks';

export default function MobilePartnerHome({
  workspaceId,
  onOpen,
  onCreateIn,
  onAction,
}: {
  workspaceId: string | undefined;
  onOpen: (t: OpenTarget) => void;
  onCreateIn: (t: OpenTarget) => void;
  onAction: (a: PartnerAction) => void;
}) {
  const { data: buckets, isLoading } = useMyTasksSummary();
  const { data: newTasks } = useNewTasks();
  const { groups } = useMobileSpaces(workspaceId);
  const setActiveTask = usePMStore((s) => s.setActiveTask);

  const n = (v: number | undefined) => (isLoading || v == null ? '—' : String(v));
  const today = buckets?.today ?? [];
  const overdue = buckets?.overdue ?? [];
  const tomorrow = buckets?.tomorrow ?? [];
  const allOpen = buckets
    ? buckets.overdue.length +
      buckets.today.length +
      buckets.tomorrow.length +
      buckets.upcoming.length +
      buckets.later.length
    : undefined;
  const newCount = newTasks?.length;

  return (
    <div style={{ padding: '16px 0 96px' }}>
      {/* ── Briefing ─────────────────────────────────────────────── */}
      <div className="mph-grid" data-tour="briefing">
        <button
          type="button"
          className="mph-today"
          onClick={() => onAction('my-tasks')}
        >
          <span className="mph-today-head">
            <em>TODAY</em>
            {today.length > 0 && <i className="mph-dot" aria-hidden />}
          </span>
          <b>{n(today.length)}</b>
          <span className="mph-today-sub">
            {isLoading
              ? ''
              : today.length === 0
                ? 'All clear — nothing scheduled.'
                : truncate(today[0].title, 48)}
          </span>
        </button>

        <div className="mph-minis">
          <button
            type="button"
            className="mph-tile"
            data-alert={overdue.length > 0 ? 'true' : undefined}
            onClick={() => onAction('my-tasks')}
          >
            <em>Overdue</em>
            <b>{n(overdue.length)}</b>
          </button>
          <button type="button" className="mph-tile" onClick={() => onAction('my-tasks')}>
            <em>
              New
              {(newCount ?? 0) > 0 && <i className="mph-ping" aria-hidden />}
            </em>
            <b>{n(newCount)}</b>
          </button>
        </div>
      </div>

      <div className="mph-quiet">
        <button type="button" onClick={() => onAction('my-tasks')}>
          <em>Tomorrow</em>
          <b>{n(tomorrow.length)}</b>
        </button>
        <button type="button" onClick={() => onAction('my-tasks')}>
          <em>All open</em>
          <b>{n(allOpen)}</b>
        </button>
      </div>

      {/* ── Action chips ─────────────────────────────────────────── */}
      <div className="mph-chips">
        <button type="button" onClick={() => onAction('my-home')}>
          {MIcon.home}
          <span>My Home</span>
        </button>
        <button type="button" onClick={() => onAction('meetings')}>
          {MIcon.meeting}
          <span>Meetings</span>
        </button>
        {/* The one accent-tinted action on the page, as on Android. */}
        <button type="button" className="is-accent" onClick={() => onAction('checkin')}>
          {MIcon.checkin}
          <span>Check-in</span>
        </button>
      </div>

      {/* ── Today's tasks ────────────────────────────────────────── */}
      <MGroupHead title="Today" count={today.length || undefined} />
      {today.length === 0 ? (
        <p className="msh-hint">
          {isLoading ? 'Loading your day…' : 'Nothing scheduled for today.'}
        </p>
      ) : (
        today.slice(0, 6).map((t) => (
          <TaskLine key={t.id} task={t} onOpen={() => setActiveTask(t.id)} />
        ))
      )}

      {/* ── Workspace ────────────────────────────────────────────── */}
      <MobileSpaceGroups groups={groups} onOpen={onOpen} onCreateIn={onCreateIn} />
    </div>
  );
}

function TaskLine({ task, onOpen }: { task: Task; onOpen: () => void }) {
  return (
    <button type="button" className="mph-task" onClick={onOpen}>
      <span className="mph-task-dot" data-p={task.priority ?? 'none'} aria-hidden />
      <span className="mph-task-body">
        <b>{task.title}</b>
      </span>
      <span className="msh-row-chev">{MIcon.chevron}</span>
    </button>
  );
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}
