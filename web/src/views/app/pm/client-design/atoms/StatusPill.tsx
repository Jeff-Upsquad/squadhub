import type { SpaceStatus } from '@squadhub/shared';

export type RequestStatus = 'queued' | 'progress' | 'review' | 'done';

const LEGACY_LABELS: Record<RequestStatus, string> = {
  queued: 'Queued',
  progress: 'In Progress',
  review: 'In Review',
  done: 'Completed',
};

const LEGACY_COLORS: Record<RequestStatus, string> = {
  queued: 'var(--cd-queued)',
  progress: 'var(--cd-progress)',
  review: 'var(--cd-review)',
  done: 'var(--cd-done)',
};

export function resolveStatus(taskStatus: string | undefined, statuses: SpaceStatus[]): { name: string; color: string } {
  if (!taskStatus) return { name: '—', color: '#9ca3af' };
  const match = statuses.find((s) => s.name === taskStatus);
  if (match) return { name: match.name, color: match.color };
  // 'done' is purple (#7c3aed) to match the app-wide completed-task color scheme.
  const legacyColor: Record<string, string> = { todo: '#6b7280', active: '#3b82f6', done: '#7c3aed', closed: '#6b7280' };
  const legacyName: Record<string, string> = { todo: 'To Do', active: 'Active', done: 'Done', closed: 'Closed' };
  if (taskStatus in legacyColor) return { name: legacyName[taskStatus], color: legacyColor[taskStatus] };
  return { name: taskStatus, color: '#6b7280' };
}

export default function StatusPill({ status, name, color }: { status: RequestStatus; name?: string; color?: string }) {
  return (
    <span className={`cd-pill ${status}`}>
      <span className="dot" />
      {name || LEGACY_LABELS[status]}
    </span>
  );
}

export function StatusDot({ status, taskStatus, statuses }: { status: RequestStatus; taskStatus?: string; statuses?: SpaceStatus[] }) {
  const resolved = taskStatus && statuses ? resolveStatus(taskStatus, statuses) : null;
  const dotColor = resolved?.color || LEGACY_COLORS[status];
  return (
    <span
      className={`cd-req-status-dot${status !== 'queued' ? ' filled' : ''}`}
      style={{ color: dotColor }}
    />
  );
}

export const STATUS_LABELS = LEGACY_LABELS;
