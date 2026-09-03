'use client';
import { useMyFlags, useMyStrikes } from '../../../hooks/useSopBreaches';

function sevColor(s: string) {
  if (s === 'high') return 'bg-red-500';
  if (s === 'medium') return 'bg-amber-500';
  return 'bg-emerald-500';
}

export default function MyBreachesPage() {
  const { data: flags, isLoading: fLoading } = useMyFlags();
  const { data: strikes, isLoading: sLoading } = useMyStrikes();

  const totalPoints = (strikes || []).reduce((a: number, x: any) => a + (x.points || 0), 0);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-[20px] font-bold text-[var(--sh-ink)]">My SOP breaches</h1>
      <p className="mt-1 text-[12.5px] text-[var(--sh-ink-3)]">
        Flags within their time window count toward strikes. A strike is issued when flags ≥ threshold.
      </p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] p-4 text-center">
          <div className="text-[22px] font-bold text-[var(--sh-ink)]">{flags?.length ?? 0}</div>
          <div className="text-[11px] uppercase tracking-wider text-[var(--sh-ink-3)]">Flags</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
          <div className="text-[22px] font-bold text-amber-900">{strikes?.length ?? 0}</div>
          <div className="text-[11px] uppercase tracking-wider text-amber-700">Strikes</div>
        </div>
        <div className="rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] p-4 text-center">
          <div className="text-[22px] font-bold text-[var(--sh-ink)]">{totalPoints}</div>
          <div className="text-[11px] uppercase tracking-wider text-[var(--sh-ink-3)]">Strike points</div>
        </div>
      </div>

      <h2 className="mt-6 text-[13px] font-semibold text-[var(--sh-ink)]">Recent flags</h2>
      {fLoading ? <p className="mt-2 text-[12px] text-[var(--sh-ink-3)]">Loading…</p> : !flags || flags.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-[var(--sh-hair)] bg-[var(--sh-hair-3)] p-4 text-center text-[12px] text-[var(--sh-ink-3)]">No flags — keep following the SOPs!</p>
      ) : (
        <div className="mt-2 space-y-2">
          {flags.map((f: any) => (
            <div key={f.id} className="flex items-center gap-3 rounded-xl border border-[var(--sh-hair)] bg-[var(--surface)] px-4 py-3">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${sevColor(f.rule?.severity || 'medium')}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-[var(--sh-ink)]">{f.item?.title || f.item_id}{f.lesson ? ` › ${f.lesson.title}` : ''}</div>
                <div className="text-[11px] text-[var(--sh-ink-3)]">
                  {f.rule ? `${f.rule.severity} · ${f.rule.flag_threshold} flags / ${f.rule.window_value} ${f.rule.window_unit}s → ${f.rule.strike_points} pt` : ''} · {new Date(f.created_at).toLocaleString()} {f.reason ? `· ${f.reason}` : ''}
                </div>
              </div>
              <a href={`/resources/${f.item_id}${f.lesson_id ? `?lesson=${f.lesson_id}` : ''}`} className="shrink-0 rounded-md border border-[var(--sh-hair)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-medium text-[var(--sh-ink)] hover:bg-[var(--sh-hair-3)]">View SOP →</a>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-6 text-[13px] font-semibold text-[var(--sh-ink)]">Strikes</h2>
      {sLoading ? <p className="mt-2 text-[12px] text-[var(--sh-ink-3)]">Loading…</p> : !strikes || strikes.length === 0 ? (
        <p className="mt-2 text-[12px] text-[var(--sh-ink-3)]">No strikes.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {strikes.map((s: any) => (
            <div key={s.id} className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">{s.points} pt</span>
                <span className="text-[12.5px] font-medium text-red-900">{s.flag_count} flags in {s.window_value} {s.window_unit}s</span>
                <span className={`ml-1 h-2 w-2 rounded-full ${sevColor(s.severity)}`} />
                <span className="text-[11px] uppercase text-red-700">{s.severity}</span>
                <span className="ml-auto text-[11px] text-red-700">{new Date(s.created_at).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
