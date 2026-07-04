import type { Task, SpaceStatus } from '@squadhub/shared';
import Avatar from './Avatar';
import LiveTimer, { formatHours } from './LiveTimer';
import { StatusDot } from './StatusPill';
import { IconMore } from './Icons';
import { usePMStore } from '../../../../../stores/pmStore';
import type { RequestStatus } from './StatusPill';

export interface RequestRowData extends Task {
  /** Coarse 4-bucket lane, derived from the resolved stage's category. */
  _derivedStatus: RequestStatus;
  /** The exact design/video-space stage this task sits in (8-stage pipeline). */
  _stage?: SpaceStatus | null;
  _listName?: string;
}

export function dueLabel(due: string | null): string {
  if (!due) return '—';
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function daysUntilDue(due: string | null): number | null {
  if (!due) return null;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export default function RequestRow({
  request,
  onClick,
}: {
  request: RequestRowData;
  onClick?: () => void;
}) {
  const assignee = request.assignees?.[0];
  const timerState = usePMStore((s) => s.timers.find((t) => t.taskId === request.id) ?? null);
  const isTicking = !!timerState;
  const dueIn = daysUntilDue(request.due_date);
  const dueCls = dueIn != null ? (dueIn < 0 ? 'over' : dueIn <= 1 ? 'soon' : '') : '';
  const category = (request.metadata as any)?.category as string | undefined;
  const hours = (request.time_tracked || 0) / 3600;

  return (
    <div className="cd-req-row" onClick={onClick} role="button">
      <StatusDot status={request._derivedStatus} />
      <span className="cd-req-title">
        {request.title}
        {category && <span className="tag">{category}</span>}
      </span>
      <span className="cd-req-designer">
        {assignee ? (
          <>
            <Avatar person={assignee} size="xs" />
            <span className="nowrap" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {(assignee.display_name || assignee.email || '').split(' ')[0]}
            </span>
          </>
        ) : (
          <span className="muted mono" style={{ fontSize: 10.5 }}>
            unassigned
          </span>
        )}
      </span>
      <span>
        {isTicking ? (
          <LiveTimer
            ticking
            startedAt={timerState.startedAt}
            baseTracked={timerState.baseTracked}
          />
        ) : request._derivedStatus === 'queued' ? (
          <span className="mono muted" style={{ fontSize: 10.5 }}>
            —
          </span>
        ) : (
          <span className="mono" style={{ fontSize: 11, color: 'var(--cd-fg-1)' }}>
            {formatHours(hours)}
          </span>
        )}
      </span>
      <span className={`cd-req-due ${dueCls}`}>{dueLabel(request.due_date)}</span>
      <button
        className="cd-topbar-btn"
        style={{ padding: 3 }}
        onClick={(e) => e.stopPropagation()}
        aria-label="More"
      >
        <IconMore size={14} />
      </button>
    </div>
  );
}
