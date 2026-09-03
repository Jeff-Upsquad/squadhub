'use client';
import { useState } from 'react';
import { useMyFlags, useMyStrikes } from '../../hooks/useSopBreaches';

function severityColor(s: string) {
  if (s === 'high') return 'bg-red-500';
  if (s === 'medium') return 'bg-amber-500';
  return 'bg-emerald-500';
}

export default function FlagNotificationCard() {
  const { data: flags } = useMyFlags();
  const { data: strikes } = useMyStrikes();
  const [expanded, setExpanded] = useState(false);

  if (!flags || flags.length === 0) return null;

  const totalFlags = flags.length;
  const totalStrikes = strikes?.length || 0;
  const totalPoints = (strikes || []).reduce((s, x: any) => s + (x.points || 0), 0);
  const recent = flags.slice(0, 3);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-amber-900">SOP enforcement</p>
          <p className="mt-0.5 text-[12px] text-amber-800">
            You have <b>{totalFlags}</b> flag{totalFlags !== 1 ? 's' : ''} · <b>{totalStrikes}</b> strike{totalStrikes !== 1 ? 's' : ''} · <b>{totalPoints}</b> pt
          </p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
        >
          {expanded ? 'Hide' : 'View'}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {recent.map((f: any) => (
          <div key={f.id} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${severityColor(f.rule?.severity || 'medium')}`} />
            <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--sh-ink)]">
              {f.item?.title || f.item_id}
              {f.rule?.lesson_id ? ' › page' : ''} — {f.rule ? `${f.rule.severity} · ${f.rule.window_value} ${f.rule.window_unit}s · ${f.rule.flag_threshold} flags → ${f.rule.strike_points}pt` : 'flagged'}
            </span>
            <a
              href={f.item?.slug ? `/resources/${f.item.id}` : `/resources/${f.item_id}`}
              className="shrink-0 text-[11px] font-medium text-amber-700 hover:underline"
            >
              View SOP →
            </a>
          </div>
        ))}
      </div>

      {expanded && flags.length > 3 && (
        <div className="mt-2 space-y-1.5">
          {flags.slice(3).map((f: any) => (
            <div key={f.id} className="flex items-center gap-2 rounded-lg border border-[var(--sh-hair)] bg-white px-3 py-1.5 text-[11px] text-[var(--sh-ink-3)]">
              <span className={`h-1.5 w-1.5 rounded-full ${severityColor(f.rule?.severity || 'medium')}`} />
              <span className="truncate">{new Date(f.created_at).toLocaleDateString()} — {f.reason || 'Flagged'}</span>
              <a href={`/resources/${f.item_id}${f.lesson_id ? `?lesson=${f.lesson_id}` : ''}`} className="ml-auto shrink-0 text-amber-700 hover:underline">View</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
