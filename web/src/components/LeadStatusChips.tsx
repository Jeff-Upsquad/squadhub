import type { SubmissionStatus } from '@squadhub/shared';
import { PIPELINE_STATUSES } from '@squadhub/shared';

export const STATUS_META: Record<SubmissionStatus, { label: string; color: string }> = {
  new:         { label: 'New',         color: '#3B82F6' },
  in_progress: { label: 'In Progress', color: '#F59E0B' },
  selection:   { label: 'Selection',   color: '#8B5CF6' },
  converted:   { label: 'Converted',   color: '#10B981' },
  onboarding:  { label: 'Onboarding',  color: '#6366F1' },
  closed:      { label: 'Closed',      color: '#6B7280' },
};

type Props = {
  value: SubmissionStatus;
  onChange?: (status: SubmissionStatus) => void;
  disabled?: boolean;
  loading?: boolean;
};

export default function LeadStatusChips({ value, onChange, disabled, loading }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PIPELINE_STATUSES.map((status) => {
        const meta = STATUS_META[status];
        const active = status === value;
        const clickable = !disabled && !loading && onChange && !active;
        const style: React.CSSProperties = active
          ? { backgroundColor: meta.color, color: '#ffffff' }
          : { backgroundColor: `${meta.color}18`, color: meta.color };
        return (
          <button
            key={status}
            type="button"
            onClick={clickable ? () => onChange!(status) : undefined}
            disabled={!clickable}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition ${
              clickable ? 'cursor-pointer hover:opacity-90' : active ? 'cursor-default' : 'cursor-not-allowed opacity-60'
            }`}
            style={style}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: active ? '#ffffff' : meta.color }} />
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}
