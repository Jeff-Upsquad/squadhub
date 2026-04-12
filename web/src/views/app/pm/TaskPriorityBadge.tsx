import type { TaskPriority } from '@squadhub/shared';

const config: Record<TaskPriority, { label: string; badgeColor: string; flagColor: string; icon: string }> = {
  urgent: { label: 'Urgent', badgeColor: '#ef4444', flagColor: '#ef4444', icon: '!!!' },
  high:   { label: 'High',   badgeColor: '#f97316', flagColor: '#f97316', icon: '!!' },
  normal: { label: 'Normal', badgeColor: '#3b82f6', flagColor: '#3b82f6', icon: '!' },
  low:    { label: 'Low',    badgeColor: '#6b7280', flagColor: '#22c55e', icon: '\u2193' },
  none:   { label: 'None',   badgeColor: '#374151', flagColor: '#374151', icon: '\u2014' },
};

function FlagIcon({ color }: { color: string }) {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" fill={`${color}30`} />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

export default function TaskPriorityBadge({ priority, variant = 'badge' }: { priority: TaskPriority; variant?: 'badge' | 'flag' }) {
  const c = config[priority];
  if (priority === 'none') return null;

  if (variant === 'flag') {
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <FlagIcon color={c.flagColor} />
        <span style={{ color: c.flagColor }} className="font-medium">{c.label}</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `${c.badgeColor}18`,
        color: c.badgeColor,
      }}
    >
      {c.icon} {c.label}
    </span>
  );
}
