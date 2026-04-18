export type RequestStatus = 'queued' | 'progress' | 'review' | 'done';

const LABELS: Record<RequestStatus, string> = {
  queued: 'Queued',
  progress: 'In Progress',
  review: 'In Review',
  done: 'Completed',
};

export default function StatusPill({ status }: { status: RequestStatus }) {
  return (
    <span className={`cd-pill ${status}`}>
      <span className="dot" />
      {LABELS[status]}
    </span>
  );
}

export function StatusDot({ status }: { status: RequestStatus }) {
  const color = {
    queued: 'var(--cd-queued)',
    progress: 'var(--cd-progress)',
    review: 'var(--cd-review)',
    done: 'var(--cd-done)',
  }[status];
  return (
    <span
      className={`cd-req-status-dot${status !== 'queued' ? ' filled' : ''}`}
      style={{ color }}
    />
  );
}

export const STATUS_LABELS = LABELS;
