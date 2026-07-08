'use client';

import { PeriodType } from './shared';

const TYPE_LABEL: Record<PeriodType, string> = {
  week: 'Week',
  month: 'Month',
  custom: 'Custom',
};

// Granularity toggle + ‹ label › stepper (adapted from GrossProfitModule's
// period controls); custom swaps the stepper for two inclusive date inputs.
export default function PeriodPicker({
  periodType,
  onPeriodTypeChange,
  label,
  onStep,
  onReset,
  custom,
  onCustomChange,
}: {
  periodType: PeriodType;
  onPeriodTypeChange: (t: PeriodType) => void;
  label: string;
  onStep: (delta: number) => void;
  onReset: () => void;
  custom: { start: string; end: string };
  onCustomChange: (c: { start: string; end: string }) => void;
}) {
  const resetLabel = periodType === 'month' ? 'This month' : 'This week';

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-lg border border-divider bg-surface p-0.5">
        {(['week', 'month', 'custom'] as PeriodType[]).map((t) => (
          <button
            key={t}
            onClick={() => onPeriodTypeChange(t)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              periodType === t
                ? 'bg-[#EEF2FF] text-accent'
                : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      {periodType === 'custom' ? (
        <div className="inline-flex items-center gap-2 rounded-lg border border-divider bg-surface px-2 py-1">
          <input
            type="date"
            value={custom.start}
            max={custom.end || undefined}
            onChange={(e) => onCustomChange({ ...custom, start: e.target.value })}
            className="rounded-md border border-divider px-2 py-1 text-xs text-foreground"
            aria-label="Custom period start"
          />
          <span className="text-xs text-foreground-dim">to</span>
          <input
            type="date"
            value={custom.end}
            min={custom.start || undefined}
            onChange={(e) => onCustomChange({ ...custom, end: e.target.value })}
            className="rounded-md border border-divider px-2 py-1 text-xs text-foreground"
            aria-label="Custom period end"
          />
        </div>
      ) : (
        <>
          <div className="inline-flex items-center gap-1 rounded-lg border border-divider bg-surface px-1 py-0.5">
            <button
              onClick={() => onStep(-1)}
              className="rounded-md p-1.5 text-foreground-dim hover:bg-surface-alt hover:text-foreground"
              aria-label="Previous period"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="min-w-[9rem] text-center text-sm font-semibold text-foreground">
              {label}
            </span>
            <button
              onClick={() => onStep(1)}
              className="rounded-md p-1.5 text-foreground-dim hover:bg-surface-alt hover:text-foreground"
              aria-label="Next period"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          <button
            onClick={onReset}
            className="rounded-md border border-divider bg-surface px-3 py-1.5 text-xs text-foreground-muted hover:text-foreground"
          >
            {resetLabel}
          </button>
        </>
      )}
    </div>
  );
}
