import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RequestRowData } from '../atoms/RequestRow';
import type { DesignPlan } from '../../../../../hooks/useClientDesignPlan';
import {
  useClientDesignTimeHistory,
  ELAPSED_ENABLED,
  type WeekPoint,
  type MonthPoint,
} from '../../../../../hooks/useClientDesignTimeHistory';
import api from '../../../../../services/api';
import { formatHours } from '../atoms/LiveTimer';

type PeriodKey = 'this_month' | 'prev_month' | 'custom';

// ---------------------------------------------------------------------------
// Date helpers (Monday-based weeks, matching useClientDesignPlan / history)
// ---------------------------------------------------------------------------
function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = (day + 6) % 7;
  const out = startOfDay(d);
  out.setDate(out.getDate() - diff);
  return out;
}
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function pctDelta(curr: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((curr - prev) / prev) * 100);
}

// ---------------------------------------------------------------------------
// Small presentational atoms
// ---------------------------------------------------------------------------
function ElapsedTag() {
  return <span className="cd-soon">soon</span>;
}

/** Renders an elapsed-hours value; disabled placeholder until the feature ships. */
function elapsedDisplay(hours: number): string {
  return ELAPSED_ENABLED ? formatHours(hours) : '—';
}

function Delta({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  if (value == null) {
    return <span style={{ color: 'var(--cd-fg-3)' }}>—</span>;
  }
  const up = value > 0;
  const flat = value === 0;
  return (
    <span style={{ color: flat ? 'var(--cd-fg-2)' : up ? 'var(--cd-done)' : 'var(--cd-danger)' }}>
      {up ? '▲' : flat ? '·' : '▼'} {up ? '+' : ''}
      {value}%{suffix}
    </span>
  );
}

/** A horizontal usage bar: filled = used, optionally over-budget in red. */
function UsageBar({ used, allot }: { used: number; allot: number }) {
  const pct = allot > 0 ? Math.min(100, (used / allot) * 100) : used > 0 ? 100 : 0;
  const over = allot > 0 && used > allot;
  return (
    <div className="cd-bar-track">
      <div
        className={`cd-bar-fill${over ? ' over' : ''}`}
        style={{ width: `${over ? 100 : pct}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function ReportsTab({
  requests,
  plan,
  folderId,
}: {
  requests: RequestRowData[];
  plan: DesignPlan;
  folderId: string;
}) {
  const history = useClientDesignTimeHistory(folderId, plan);

  // ---- Completed tasks ------------------------------------------------------
  const done = useMemo(
    () => requests.filter((r) => r._derivedStatus === 'done'),
    [requests],
  );

  const now = startOfDay(new Date());
  const weekStart = useMemo(() => startOfWeek(now), [now.getTime()]);
  const lastWeekStart = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    return d;
  }, [weekStart]);
  const monthStart = useMemo(() => new Date(now.getFullYear(), now.getMonth(), 1), [now.getTime()]);
  const lastMonthStart = useMemo(
    () => new Date(now.getFullYear(), now.getMonth() - 1, 1),
    [now.getTime()],
  );

  // Tasks carry no updated_at/completed_at column, so fall back to the day the
  // work was scheduled (work_date) and finally created_at. Without this, every
  // completion-date figure below (counts + "Completed tasks by week") is empty.
  const completedAt = (r: RequestRowData) => {
    const ts = r.updated_at || (r as any).work_date || (r as any).created_at;
    return ts ? new Date(ts) : null;
  };

  const counts = useMemo(() => {
    let thisWeek = 0, lastWeek = 0, thisMonth = 0, lastMonth = 0;
    for (const r of done) {
      const d = completedAt(r);
      if (!d) continue;
      if (d >= weekStart) thisWeek++;
      else if (d >= lastWeekStart) lastWeek++;
      if (d >= monthStart) thisMonth++;
      else if (d >= lastMonthStart && d < monthStart) lastMonth++;
    }
    return { thisWeek, lastWeek, thisMonth, lastMonth, total: done.length };
  }, [done, weekStart, lastWeekStart, monthStart, lastMonthStart]);

  // ---- Completed tasks grouped by completion week --------------------------
  const weekGroups = useMemo(() => {
    const groups = new Map<string, RequestRowData[]>();
    for (const r of done) {
      const d = completedAt(r);
      if (!d) continue;
      const key = toISODate(startOfWeek(d));
      const arr = groups.get(key) || [];
      arr.push(r);
      groups.set(key, arr);
    }
    const thisKey = toISODate(weekStart);
    const lastKey = toISODate(lastWeekStart);
    return Array.from(groups.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // most recent first
      .map(([key, tasks]) => {
        const ws = new Date(`${key}T00:00:00`);
        const we = new Date(ws);
        we.setDate(we.getDate() + 6);
        const label =
          key === thisKey ? 'This week' : key === lastKey ? 'Last week' : `${shortDate(ws)} – ${shortDate(we)}`;
        const sorted = [...tasks].sort(
          (a, b) => +(completedAt(b) ?? 0) - +(completedAt(a) ?? 0),
        );
        const actualHours = sorted.reduce((s, t) => s + (t.time_tracked || 0) / 3600, 0);
        return { key, label, range: `${shortDate(ws)} – ${shortDate(we)}`, tasks: sorted, actualHours };
      });
  }, [done, weekStart, lastWeekStart]);

  const [openWeeks, setOpenWeeks] = useState<Record<string, boolean>>({});
  const isOpen = (key: string, index: number) =>
    openWeeks[key] ?? index < 2; // current + last week open by default

  // ---- Derived time figures -------------------------------------------------
  const weekRemaining = Math.max(0, plan.weeklyHours - plan.usedWeek);

  // ---- Period selector (drives the month column + its task count) -----------
  const todayISO = toISODate(now);
  const [period, setPeriod] = useState<PeriodKey>('this_month');
  const [customFrom, setCustomFrom] = useState(() => toISODate(monthStart));
  const [customTo, setCustomTo] = useState(todayISO);

  const periodRange = useMemo(() => {
    if (period === 'prev_month') {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        from: toISODate(s), to: toISODate(e),
        label: 'Previous month', countLabel: 'last month',
        // No remaining/allotment for a completed month — show time spent only.
        // (The Monthly history section already charts past months vs allotment.)
        allot: null as number | null, isCurrent: false,
      };
    }
    if (period === 'custom') {
      const s = new Date(`${customFrom}T00:00:00`);
      const e = new Date(`${customTo}T00:00:00`);
      return {
        from: customFrom, to: customTo,
        label: `${shortDate(s)} – ${shortDate(e)}`, countLabel: 'in range',
        allot: null as number | null, isCurrent: false,
      };
    }
    return {
      from: toISODate(monthStart), to: todayISO,
      label: 'This month', countLabel: 'this month',
      allot: plan.monthlyHours as number | null, isCurrent: true,
    };
  }, [period, customFrom, customTo, now, monthStart, todayISO, plan.monthlyHours]);

  const { data: periodData } = useQuery({
    queryKey: ['folder-time-period', folderId, periodRange.from, periodRange.to],
    queryFn: async () => {
      try {
        const r = await api.get(
          `/pm/folders/${folderId}/time-summary?from=${periodRange.from}&to=${periodRange.to}`,
        );
        return r.data.data as { date: string; total_work_seconds: number }[];
      } catch {
        return [] as { date: string; total_work_seconds: number }[];
      }
    },
    enabled: !!folderId && !!periodRange.from && !!periodRange.to,
  });

  const periodUsed = useMemo(() => {
    if (!periodData) return periodRange.isCurrent ? plan.usedMonth : 0;
    const secs = periodData.reduce((s, d) => s + (d.total_work_seconds || 0), 0);
    return Math.round((secs / 3600) * 10) / 10;
  }, [periodData, periodRange.isCurrent, plan.usedMonth]);

  const periodRemaining =
    periodRange.allot != null ? Math.max(0, periodRange.allot - periodUsed) : null;

  const periodTaskCount = useMemo(() => {
    const from = new Date(`${periodRange.from}T00:00:00`);
    const to = new Date(`${periodRange.to}T23:59:59`);
    return done.filter((r) => {
      const d = completedAt(r);
      return d != null && d >= from && d <= to;
    }).length;
  }, [done, periodRange.from, periodRange.to]);

  return (
    <div className="cd-rep2">
      {/* ---------------- Section 1: hours this week / period / counts ---------------- */}
      <div className="cd-rep2-section-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="cd-rep-label">Time tracking</div>
          <div className="cd-rep-sub">Actual hours worked vs. your plan allotment</div>
          <div className="cd-tt-legend" style={{ marginTop: 8 }}>
            <span><i className="sw actual" /> Actual — time worked</span>
            <span className={ELAPSED_ENABLED ? '' : 'is-off'}>
              <i className="sw elapsed" /> Elapsed — idle time still billed {!ELAPSED_ENABLED && <ElapsedTag />}
            </span>
          </div>
        </div>
        <div className="cd-period">
          <select
            className="cd-period-select"
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodKey)}
            aria-label="Reporting period"
          >
            <option value="this_month">This month</option>
            <option value="prev_month">Previous month</option>
            <option value="custom">Custom…</option>
          </select>
          {period === 'custom' && (
            <span className="cd-period-dates">
              <input
                type="date"
                className="cd-period-date"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              <span className="sep">→</span>
              <input
                type="date"
                className="cd-period-date"
                value={customTo}
                min={customFrom}
                max={todayISO}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </span>
          )}
        </div>
      </div>

      <div className="cd-rep-grid">
        {/* Col 1 — hours this week */}
        <div className="cd-rep-card span-5">
          <div className="cd-rep-label">This week</div>
          <div className="cd-rep-big" style={{ fontSize: 40 }}>
            {formatHours(plan.usedWeek)}
            <span className="unit">/ {plan.weeklyHours}h</span>
          </div>
          <UsageBar used={plan.usedWeek} allot={plan.weeklyHours} />
          <div className="cd-stat-row">
            <div className="cd-stat">
              <div className="cd-stat-label">Actual</div>
              <div className="cd-stat-val">{formatHours(plan.usedWeek)}</div>
            </div>
            <div className="cd-stat">
              <div className="cd-stat-label">Elapsed {!ELAPSED_ENABLED && <ElapsedTag />}</div>
              <div className="cd-stat-val is-muted">{elapsedDisplay(0)}</div>
            </div>
            <div className="cd-stat">
              <div className="cd-stat-label">Total</div>
              <div className="cd-stat-val">{formatHours(plan.usedWeek)}</div>
            </div>
            <div className="cd-stat">
              <div className="cd-stat-label">Remaining</div>
              <div className="cd-stat-val" style={{ color: weekRemaining > 0 ? 'var(--cd-done)' : 'var(--cd-fg-2)' }}>
                {formatHours(weekRemaining)}
              </div>
            </div>
          </div>
        </div>

        {/* Col 2 — hours for the selected period (month / prev / custom) */}
        <div className="cd-rep-card span-5">
          <div className="cd-rep-label">{periodRange.label}</div>
          <div className="cd-rep-big" style={{ fontSize: 40 }}>
            {formatHours(periodUsed)}
            {periodRange.allot != null && <span className="unit">/ {periodRange.allot}h</span>}
          </div>
          {periodRange.allot != null ? (
            <UsageBar used={periodUsed} allot={periodRange.allot} />
          ) : (
            <div className="cd-bar-track">
              <div className="cd-bar-fill" style={{ width: '100%', opacity: 0.22 }} />
            </div>
          )}
          <div className="cd-stat-row">
            <div className="cd-stat">
              <div className="cd-stat-label">Actual</div>
              <div className="cd-stat-val">{formatHours(periodUsed)}</div>
            </div>
            <div className="cd-stat">
              <div className="cd-stat-label">Elapsed {!ELAPSED_ENABLED && <ElapsedTag />}</div>
              <div className="cd-stat-val is-muted">{elapsedDisplay(0)}</div>
            </div>
            <div className="cd-stat">
              <div className="cd-stat-label">Total</div>
              <div className="cd-stat-val">{formatHours(periodUsed)}</div>
            </div>
            <div className="cd-stat">
              <div className="cd-stat-label">Remaining</div>
              <div className="cd-stat-val" style={{ color: periodRemaining && periodRemaining > 0 ? 'var(--cd-done)' : 'var(--cd-fg-2)' }}>
                {periodRemaining != null ? formatHours(periodRemaining) : '—'}
              </div>
            </div>
          </div>
        </div>

        {/* Col 3 — task counts (less prominent) */}
        <div className="cd-rep-card span-2" style={{ borderRight: 0 }}>
          <div className="cd-rep-label">Tasks done</div>
          <div className="cd-counts">
            <div className="cd-count-item">
              <div className="cd-count-num">{counts.thisWeek}</div>
              <div className="cd-count-label">this week</div>
              <div className="cd-count-delta">
                <Delta value={pctDelta(counts.thisWeek, counts.lastWeek)} suffix=" WoW" />
              </div>
            </div>
            <div className="cd-count-item">
              <div className="cd-count-num">{periodTaskCount}</div>
              <div className="cd-count-label">{periodRange.countLabel}</div>
              {periodRange.isCurrent && (
                <div className="cd-count-delta">
                  <Delta value={pctDelta(counts.thisMonth, counts.lastMonth)} suffix=" MoM" />
                </div>
              )}
            </div>
            <div className="cd-count-foot">{counts.total} delivered all-time</div>
          </div>
        </div>
      </div>

      {/* ---------------- Daily time spent ---------------- */}
      <div className="cd-rep-card span-12" style={{ borderRight: 0 }}>
        <div className="cd-rep2-section-head" style={{ marginBottom: 4 }}>
          <div>
            <div className="cd-rep-label">Daily time spent</div>
            <div className="cd-rep-sub">Hours logged per day · last 14 days</div>
          </div>
        </div>
        <div className="cd-tl-head">
          <span>Day</span>
          <span>Hours used vs. daily allotment</span>
          <span className="r">Actual</span>
          <span className="r">Elapsed</span>
        </div>
        {history.days.map((d) => {
          const over = d.allotHours > 0 && d.actualHours > d.allotHours;
          return (
            <div
              className={`cd-tl-row${d.today ? ' is-today' : ''}${d.weekend ? ' is-weekend' : ''}`}
              key={d.date}
            >
              <span className="cd-tl-label">{d.label}</span>
              <div className="cd-tl-bar">
                <UsageBar used={d.actualHours} allot={d.allotHours} />
              </div>
              <span className={`cd-tl-val${over ? ' over' : ''}`}>{formatHours(d.actualHours)}</span>
              <span className="cd-tl-val is-muted">{elapsedDisplay(d.elapsedHours)}</span>
            </div>
          );
        })}
      </div>

      {/* ---------------- Historical: weekly + monthly ---------------- */}
      <div className="cd-rep-grid">
        <HistoryCard
          title="Weekly history"
          subtitle="Hours per week · last 10 weeks"
          rows={history.weeks.map((w: WeekPoint) => ({
            key: w.key,
            label: w.label,
            actual: w.actualHours,
            allot: w.allotHours,
            current: w.current,
          }))}
          allotLabel="weekly allotment"
        />
        <HistoryCard
          title="Monthly history"
          subtitle="Hours per month · last 6 months"
          rows={history.months.map((m: MonthPoint) => ({
            key: m.key,
            label: m.label,
            actual: m.actualHours,
            allot: m.allotHours,
            current: m.current,
          }))}
          allotLabel="monthly allotment (approx. for past months)"
          borderRight0
        />
      </div>

      {/* ---------------- Completed tasks by week ---------------- */}
      <div className="cd-rep-card span-12" style={{ borderRight: 0, borderBottom: 0 }}>
        <div className="cd-rep2-section-head" style={{ marginBottom: 10 }}>
          <div>
            <div className="cd-rep-label">Completed tasks by week</div>
            <div className="cd-rep-sub">Delivered work grouped by completion week, with time spent on each</div>
          </div>
        </div>

        {weekGroups.length === 0 && (
          <div className="cd-rep2-empty">No completed tasks yet.</div>
        )}

        {weekGroups.map((g, gi) => {
          const open = isOpen(g.key, gi);
          return (
            <div className={`cd-wk-group${open ? '' : ' collapsed'}`} key={g.key}>
              <button
                className="cd-wk-head"
                onClick={() => setOpenWeeks((s) => ({ ...s, [g.key]: !open }))}
              >
                <svg className="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="cd-wk-title">{g.label}</span>
                <span className="cd-wk-range">{g.range}</span>
                <span className="cd-wk-count">{g.tasks.length} {g.tasks.length === 1 ? 'task' : 'tasks'}</span>
                <span className="cd-wk-hours">{formatHours(g.actualHours)}</span>
              </button>

              {open && (
                <>
                  <div className="cd-wk-task cd-wk-task-head">
                    <span />
                    <span>Task</span>
                    <span>Completed</span>
                    <span className="r">Actual</span>
                    <span className="r">Elapsed</span>
                  </div>
                  {g.tasks.map((t) => {
                    const cat = (t.metadata as any)?.category as string | undefined;
                    return (
                      <div className="cd-wk-task" key={t.id}>
                        <span className="cd-wk-dot" />
                        <span className="cd-wk-task-title">
                          {t.title}
                          {cat && <span className="tag">{cat}</span>}
                        </span>
                        <span className="cd-wk-task-date">
                          {(() => {
                            const d = completedAt(t);
                            return d ? shortDate(d) : '—';
                          })()}
                        </span>
                        <span className="cd-wk-task-val">{formatHours((t.time_tracked || 0) / 3600)}</span>
                        <span className="cd-wk-task-val is-muted">{elapsedDisplay(0)}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekly / monthly history card
// ---------------------------------------------------------------------------
function HistoryCard({
  title,
  subtitle,
  rows,
  allotLabel,
  borderRight0,
}: {
  title: string;
  subtitle: string;
  rows: { key: string; label: string; actual: number; allot: number; current: boolean }[];
  allotLabel: string;
  borderRight0?: boolean;
}) {
  return (
    <div className="cd-rep-card span-6" style={borderRight0 ? { borderRight: 0 } : undefined}>
      <div className="cd-rep-label">{title}</div>
      <div className="cd-rep-sub" style={{ marginBottom: 12 }}>{subtitle}</div>
      {rows.map((r) => {
        const over = r.allot > 0 && r.actual > r.allot;
        return (
          <div className={`cd-tl-row${r.current ? ' is-today' : ''}`} key={r.key}>
            <span className="cd-tl-label">{r.label}</span>
            <div className="cd-tl-bar">
              <UsageBar used={r.actual} allot={r.allot} />
            </div>
            <span className={`cd-tl-val${over ? ' over' : ''}`}>{formatHours(r.actual)}</span>
            <span className="cd-tl-val is-muted">/ {r.allot}h</span>
          </div>
        );
      })}
      <div className="cd-rep-sub" style={{ marginTop: 10, fontSize: 10.5 }}>
        Bars are relative to {allotLabel}.
      </div>
    </div>
  );
}
