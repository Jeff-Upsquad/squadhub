import type { TaskPriority } from '@squadhub/shared';

const config: Record<TaskPriority, { label: string; color: string; icon: string }> = {
  urgent: { label: 'Urgent', color: '#ef4444', icon: '!!!' },
  high:   { label: 'High',   color: '#f97316', icon: '!!' },
  normal: { label: 'Normal', color: '#3b82f6', icon: '!' },
  low:    { label: 'Low',    color: '#6b7280', icon: '\u2193' },
  none:   { label: 'None',   color: '#374151', icon: '\u2014' },
};

export default function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  const c = config[priority];
  if (priority === 'none') return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `${c.color}18`,
        color: c.color,
      }}
    >
      {c.icon} {c.label}
    </span>
  );
}
