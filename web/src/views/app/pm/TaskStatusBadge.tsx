import { getTaskStatusDef, type SpaceStatus } from '@squadhub/shared';

export default function TaskStatusBadge({
  status,
  originalStatus,
  className = '',
}: {
  status: SpaceStatus | { name?: string; color?: string; label?: string } | string | undefined | null;
  originalStatus?: string | null;
  className?: string;
}) {
  if (!status) return null;
  let name = '';
  let color = '#6b7280';
  const rawKey = typeof status === 'string' ? status : (status as any).key || status.name || '';
  if (typeof status === 'string') {
    const def = getTaskStatusDef(status);
    name = def?.label || status;
    color = def?.color || '#6b7280';
  } else {
    name = status.name || (status as any).label || '';
    color = status.color || '#6b7280';
  }
  if (!name) return null;

  // Placeholder ("current status") stages park a task: the original stage
  // leads and the placeholder trails, muted.
  const isParked = rawKey === 'waiting_on_dependency' || rawKey === 'unblocked'
    || !!getTaskStatusDef(rawKey)?.is_placeholder
    || (name.toUpperCase().includes('WAITING') && name.toUpperCase().includes('DEPEND'))
    || name.toUpperCase() === 'UNBLOCKED';
  const origDef = originalStatus ? getTaskStatusDef(originalStatus) : null;
  const origLabel = origDef?.label || originalStatus || null;
  const origColor = origDef?.color || '#6b7280';
  const showParked = isParked && !!origLabel;
  const leadColor = showParked ? origColor : color;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
      style={{
        backgroundColor: `${leadColor}18`,
        color: leadColor,
      }}
      title={showParked ? `${origLabel} · currently ${name}` : undefined}
    >
      <span
        className="h-1.5 w-1.5 rounded-full shrink-0"
        style={{ backgroundColor: leadColor }}
      />
      <span>{showParked ? origLabel : name}</span>
      {showParked && (
        <span className="sw-parked-chip">
          <span className="sw-parked-dot" style={{ backgroundColor: color }} />
          <span>{name}</span>
        </span>
      )}
    </span>
  );
}
