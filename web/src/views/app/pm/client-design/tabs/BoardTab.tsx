import type { RequestRowData } from '../atoms/RequestRow';
import { daysUntilDue, dueLabel } from '../atoms/RequestRow';
import Avatar from '../atoms/Avatar';
import LiveTimer, { formatHours } from '../atoms/LiveTimer';
import PriorityDot from '../atoms/PriorityDot';
import { coverFor, seedFromId, shortRequestId } from '../atoms/CoverArt';
import { IconPlus, IconCalendar } from '../atoms/Icons';
import { STATUS_LABELS } from '../atoms/StatusPill';
import type { RequestStatus } from '../atoms/StatusPill';
import { usePMStore } from '../../../../../stores/pmStore';

const COLUMNS: { key: RequestStatus; color: string }[] = [
  { key: 'queued', color: 'var(--cd-queued)' },
  { key: 'progress', color: 'var(--cd-progress)' },
  { key: 'review', color: 'var(--cd-review)' },
  { key: 'done', color: 'var(--cd-done)' },
];

export default function BoardTab({
  byStatus,
  onOpenRequest,
  onNewRequest,
}: {
  byStatus: Record<RequestStatus, RequestRowData[]>;
  onOpenRequest: (r: RequestRowData) => void;
  onNewRequest: () => void;
}) {
  return (
    <div className="cd-board">
      {COLUMNS.map((c) => {
        const items = byStatus[c.key] || [];
        return (
          <div className="cd-board-col" key={c.key}>
            <div className="cd-board-col-head">
              <div className="cd-board-col-title">
                <span
                  style={{ width: 8, height: 8, borderRadius: '50%', background: c.color }}
                />
                {STATUS_LABELS[c.key]}
              </div>
              <span className="cd-board-col-count">{items.length}</span>
              {c.key === 'queued' && (
                <button
                  className="cd-topbar-btn"
                  onClick={onNewRequest}
                  style={{ padding: 3 }}
                  aria-label="New request"
                >
                  <IconPlus size={14} />
                </button>
              )}
            </div>
            <div className="cd-board-col-body">
              {items.map((r) => (
                <BoardCard key={r.id} request={r} onClick={() => onOpenRequest(r)} />
              ))}
              {items.length === 0 && (
                <div
                  style={{
                    padding: 20,
                    fontFamily: 'var(--cd-font-mono)',
                    fontSize: 10.5,
                    color: 'var(--cd-fg-3)',
                    textAlign: 'center',
                    border: '1px dashed var(--cd-br-0)',
                    borderRadius: 6,
                  }}
                >
                  Nothing here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BoardCard({
  request,
  onClick,
}: {
  request: RequestRowData;
  onClick: () => void;
}) {
  const timerState = usePMStore((s) => s.timer);
  const isTicking = timerState?.taskId === request.id;
  const assignee = request.assignees?.[0];
  const category = (request.metadata as any)?.category as string | undefined;
  const hours = (request.time_tracked || 0) / 3600;
  const dueIn = daysUntilDue(request.due_date);

  return (
    <div className="cd-board-card" onClick={onClick}>
      {request._derivedStatus !== 'queued' && (
        <div
          className="cd-board-card-cover"
          style={{
            backgroundImage: coverFor(seedFromId(request.id), category || 'artwork'),
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}
      <div className="cd-board-card-head">
        <span className="cd-board-card-id">{shortRequestId(request)}</span>
        <PriorityDot priority={request.priority} showLabel={false} />
      </div>
      <div className="cd-board-card-title">{request.title}</div>
      {request.description && <div className="cd-board-card-desc">{request.description}</div>}
      <div className="cd-board-card-meta">
        <div className="cd-board-card-meta-left">
          {assignee ? (
            <Avatar person={assignee} size="xs" />
          ) : (
            <span className="mono" style={{ color: 'var(--cd-fg-3)' }}>
              unassigned
            </span>
          )}
          {category && (
            <span className="mono" style={{ color: 'var(--cd-fg-2)' }}>
              {category}
            </span>
          )}
        </div>
        <div className="cd-board-card-meta-left">
          {isTicking ? (
            <LiveTimer
              ticking
              startedAt={timerState.startedAt}
              baseTracked={timerState.baseTracked}
            />
          ) : (
            request._derivedStatus !== 'queued' && (
              <span className="mono">{formatHours(hours)}</span>
            )
          )}
          {request.due_date && (
            <span
              className="mono"
              style={{
                color:
                  dueIn != null && dueIn < 0
                    ? 'var(--cd-danger)'
                    : dueIn === 0
                      ? 'var(--cd-review)'
                      : 'var(--cd-fg-2)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <IconCalendar size={10} /> {dueLabel(request.due_date)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
