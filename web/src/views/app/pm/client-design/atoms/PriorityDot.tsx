import type { TaskPriority } from '@squadhub/shared';

const PRIO_COLOR: Record<string, string> = {
  urgent: 'var(--cd-danger)',
  high: 'var(--cd-review)',
  normal: 'var(--cd-fg-2)',
  low: 'var(--cd-fg-3)',
  none: 'var(--cd-fg-3)',
  Low: 'var(--cd-fg-3)',
  Normal: 'var(--cd-fg-2)',
  High: 'var(--cd-review)',
  Urgent: 'var(--cd-danger)',
};

const PRIO_LABEL: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
  none: 'None',
};

export default function PriorityDot({
  priority,
  showLabel = true,
}: {
  priority: TaskPriority | string;
  showLabel?: boolean;
}) {
  const color = PRIO_COLOR[priority] || 'var(--cd-fg-3)';
  const label = PRIO_LABEL[priority] || priority;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {showLabel && <span style={{ color: 'var(--cd-fg-1)' }}>{label}</span>}
    </span>
  );
}

export const PRIORITY_CHOICES: { label: string; value: TaskPriority; color: string }[] = [
  { label: 'Low', value: 'low', color: 'var(--cd-fg-3)' },
  { label: 'Normal', value: 'normal', color: 'var(--cd-fg-2)' },
  { label: 'High', value: 'high', color: 'var(--cd-review)' },
];
