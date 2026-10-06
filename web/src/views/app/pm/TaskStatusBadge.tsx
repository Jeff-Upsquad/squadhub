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

  const isWaitingOrUnblocked = rawKey === 'waiting_on_dependency' || rawKey === 'unblocked'
    || (name.toUpperCase().includes('WAITING') && name.toUpperCase().includes('DEPEND'))
    || name.toUpperCase() === 'UNBLOCKED';
  const origDef = originalStatus ? getTaskStatusDef(originalStatus) : null;
  const origLabel = origDef?.label || originalStatus || null;
  const origColor = origDef?.color || '#6b7280';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
      style={{
        backgroundColor: `${color}18`,
        color,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <span>{name}</span>
      {isWaitingOrUnblocked && origLabel && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[10px] font-medium border shrink-0"
          style={{
            borderColor: `${color}40`,
            backgroundColor: `${origColor}18`,
            color: origColor,
          }}
          title={`Original status: ${origLabel}`}
        >
          <span className="h-1 w-1 rounded-full shrink-0" style={{ backgroundColor: origColor }} />
          <span>{origLabel}</span>
        </span>
      )}
    </span>
  );
}
