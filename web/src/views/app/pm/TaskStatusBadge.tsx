import { getTaskStatusDef, type SpaceStatus } from '@squadhub/shared';

export default function TaskStatusBadge({
  status,
  className = '',
}: {
  status: SpaceStatus | { name?: string; color?: string; label?: string } | string | undefined | null;
  className?: string;
}) {
  if (!status) return null;
  let name = '';
  let color = '#6b7280';
  if (typeof status === 'string') {
    const def = getTaskStatusDef(status);
    name = def?.label || status;
    color = def?.color || '#6b7280';
  } else {
    name = status.name || (status as any).label || '';
    color = status.color || '#6b7280';
  }
  if (!name) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
      style={{
        backgroundColor: `${color}18`,
        color,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {name}
    </span>
  );
}
