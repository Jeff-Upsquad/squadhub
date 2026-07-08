'use client';

import { useMemo, useState } from 'react';
import PeriodPicker from './PeriodPicker';
import OverviewTab from './OverviewTab';
import BreakdownTab from './BreakdownTab';
import TargetsTab from './TargetsTab';
import TeamTab from './TeamTab';
import {
  MONTH_NAMES,
  PeriodQuery,
  PeriodType,
  addDaysStr,
  localDateStr,
  mondayOf,
  pad2,
  rangeLabel,
} from './shared';

type Tab = 'overview' | 'breakdown' | 'targets' | 'team';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'breakdown', label: 'Breakdown' },
  { key: 'targets', label: 'Targets' },
  { key: 'team', label: 'Team' },
];

export default function SalesDashboardModule() {
  const now = useMemo(() => new Date(), []);
  const [tab, setTab] = useState<Tab>('overview');

  // Period state (owned here, shared by Overview + Breakdown).
  const [periodType, setPeriodType] = useState<PeriodType>('week');
  const [weekCursor, setWeekCursor] = useState<string>(() => mondayOf(localDateStr(new Date())));
  const [monthCursor, setMonthCursor] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });
  const [custom, setCustom] = useState({ start: '', end: '' });

  function step(delta: number) {
    if (periodType === 'week') {
      setWeekCursor((prev) => addDaysStr(prev, delta * 7));
    } else if (periodType === 'month') {
      setMonthCursor((prev) => {
        let { year, month } = prev;
        let m = month + delta;
        while (m < 1) { m += 12; year -= 1; }
        while (m > 12) { m -= 12; year += 1; }
        return { year, month: m };
      });
    }
  }

  function resetToNow() {
    setWeekCursor(mondayOf(localDateStr(new Date())));
    setMonthCursor({ year: now.getFullYear(), month: now.getMonth() + 1 });
  }

  const periodQuery: PeriodQuery =
    periodType === 'week'
      ? { period_type: 'week', anchor: weekCursor }
      : periodType === 'month'
        ? { period_type: 'month', anchor: `${monthCursor.year}-${pad2(monthCursor.month)}` }
        : { period_type: 'custom', start: custom.start, end: custom.end };

  const periodReady =
    periodType !== 'custom' || Boolean(custom.start && custom.end && custom.start <= custom.end);

  const periodLabel =
    periodType === 'week'
      ? rangeLabel(weekCursor, addDaysStr(weekCursor, 6))
      : periodType === 'month'
        ? `${MONTH_NAMES[monthCursor.month - 1]} ${monthCursor.year}`
        : periodReady
          ? rangeLabel(custom.start, custom.end)
          : 'Custom range';

  const showPeriodPicker = tab === 'overview' || tab === 'breakdown';

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">
          Sales Dashboard
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Leads, calls, conversions, and revenue per sales team member for the selected period,
          from the Squad CRM pipeline.
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-4 inline-flex rounded-lg border border-divider bg-surface p-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.key
                ? 'bg-[#EEF2FF] text-accent'
                : 'text-foreground-muted hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {showPeriodPicker && (
        <PeriodPicker
          periodType={periodType}
          onPeriodTypeChange={setPeriodType}
          label={periodLabel}
          onStep={step}
          onReset={resetToNow}
          custom={custom}
          onCustomChange={setCustom}
        />
      )}

      {tab === 'overview' && (
        <OverviewTab periodQuery={periodQuery} enabled={periodReady} fallbackLabel={periodLabel} />
      )}
      {tab === 'breakdown' && (
        <BreakdownTab periodQuery={periodQuery} enabled={periodReady} fallbackLabel={periodLabel} />
      )}
      {tab === 'targets' && <TargetsTab />}
      {tab === 'team' && <TeamTab />}
    </div>
  );
}
