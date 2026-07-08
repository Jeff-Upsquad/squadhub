'use client';

import { Funnel, formatPct } from './shared';

// Hand-rolled horizontal funnel: each stage's bar width is its share of the
// leads count; the caption under each stage shows the drop-off from the
// previous one.
const STAGE_COLORS = ['bg-[#C7D2FE]', 'bg-[#A5B4FC]', 'bg-[#818CF8]', 'bg-[#6366F1]'];

export default function FunnelBars({ funnel }: { funnel: Funnel }) {
  const stages = [
    { label: 'Leads', value: funnel.leads, from: 'created' },
    { label: 'Deals', value: funnel.deals, from: 'of leads' },
    { label: 'Converted', value: funnel.converted, from: 'of deals' },
    { label: 'Closed', value: funnel.closed, from: 'of converted' },
  ];
  const max = Math.max(funnel.leads, 1);

  return (
    <div className="space-y-2">
      {stages.map((stage, i) => {
        const widthPct = Math.max((stage.value / max) * 100, stage.value > 0 ? 2 : 0);
        const prev = i > 0 ? stages[i - 1].value : null;
        const caption =
          i === 0
            ? 'created in period'
            : prev && prev > 0
              ? `${formatPct((stage.value / prev) * 100)} ${stage.from}`
              : `— ${stage.from}`;
        return (
          <div key={stage.label} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs text-foreground-muted">{stage.label}</span>
            <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-canvas ring-1 ring-divider">
              <div
                className={`h-full rounded-md ${STAGE_COLORS[i]}`}
                style={{ width: `${widthPct}%` }}
              />
              <span className="absolute inset-y-0 left-2 flex items-center text-xs font-semibold text-foreground">
                {stage.value.toLocaleString('en-IN')}
              </span>
            </div>
            <span className="w-28 shrink-0 text-right text-[11px] text-foreground-dim">{caption}</span>
          </div>
        );
      })}
    </div>
  );
}
