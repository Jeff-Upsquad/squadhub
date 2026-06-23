import { useMemo, useState } from 'react';
import type { SpaceStatus } from '@squadhub/shared';
import type { RequestRowData } from '../atoms/RequestRow';
import { daysUntilDue, dueLabel } from '../atoms/RequestRow';
import Avatar from '../atoms/Avatar';
import LiveTimer, { formatHours } from '../atoms/LiveTimer';
import PriorityDot from '../atoms/PriorityDot';
import { coverFor, seedFromId, shortRequestId } from '../atoms/CoverArt';
import { IconPlus, IconCalendar } from '../atoms/Icons';
import { sortStages } from '../../../../../lib/designSpaceLists';
import { usePMStore } from '../../../../../stores/pmStore';

export default function BoardTab({
  requests,
  statuses,
  onOpenRequest,
  onNewRequest,
  onMoveStage,
}: {
  requests: RequestRowData[];
  statuses: SpaceStatus[];
  onOpenRequest: (r: RequestRowData) => void;
  onNewRequest: () => void;
  onMoveStage: (taskId: string, statusName: string) => void;
}) {
  const columns = useMemo(() => sortStages(statuses), [statuses]);

  const byStage = useMemo(() => {
    const map: Record<string, RequestRowData[]> = {};
    for (const c of columns) map[c.id] = [];
    for (const r of requests) {
      const id = r._stage?.id;
      if (id && map[id]) map[id].push(r);
    }
    return map;
  }, [requests, columns]);

  if (columns.length === 0) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: 'center',
          fontFamily: 'var(--cd-font-mono)',
          fontSize: 11,
          color: 'var(--cd-fg-3)',
        }}
      >
        Loading stages…
      </div>
    );
  }

  return (
    <div className="cd-board">
      {columns.map((status, idx) => (
        <BoardColumn
          key={status.id}
          status={status}
          items={byStage[status.id] || []}
          isIntake={idx === 0}
          onOpenRequest={onOpenRequest}
          onNewRequest={onNewRequest}
          onMoveStage={onMoveStage}
        />
      ))}
    </div>
  );
}

function BoardColumn({
  status,
  items,
  isIntake,
  onOpenRequest,
  onNewRequest,
  onMoveStage,
}: {
  status: SpaceStatus;
  items: RequestRowData[];
  isIntake: boolean;
  onOpenRequest: (r: RequestRowData) => void;
  onNewRequest: () => void;
  onMoveStage: (taskId: string, statusName: string) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) onMoveStage(taskId, status.name);
  };

  return (
    <div
      className="cd-board-col"
      data-dragover={isDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="cd-board-col-head">
        <div className="cd-board-col-title">
          <span
            style={{ width: 8, height: 8, borderRadius: '50%', background: status.color }}
          />
          {status.name}
        </div>
        <span className="cd-board-col-count">{items.length}</span>
        {isIntake && (
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
          <div
            key={r.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/plain', r.id)}
          >
            <BoardCard request={r} onClick={() => onOpenRequest(r)} />
          </div>
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
  // Intake stages (New Request / Checking) read as "not started yet": skip the
  // cover art + logged-hours chrome the way the old `queued` lane did.
  const started = request._stage?.category !== 'todo';

  return (
    <div className="cd-board-card" onClick={onClick}>
      {started && (
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
            started && <span className="mono">{formatHours(hours)}</span>
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
