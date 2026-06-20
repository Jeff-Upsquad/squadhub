import { useMemo, useState } from 'react';
import type { RequestRowData } from '../atoms/RequestRow';
import type { DesignPlan } from '../../../../../hooks/useClientDesignPlan';
import {
  useClientDesignTimeHistory,
  ELAPSED_ENABLED,
  type WeekPoint,
  type MonthPoint,
} from '../../../../../hooks/useClientDesignTimeHistory';
import { formatHours } from '../atoms/LiveTimer';

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

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="cd-spark">
      {values.map((v, i) => (
        <span key={i} style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
      ))}
    </div>
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

  const completedAt = (r: RequestRowData) => (r.updated_at ? new Date(r.updated_at) : null);

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

  // Tasks completed per week aligned to the history week buckets (for spark).
  const weeklyCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of done) {
      const d = completedAt(r);
      if (!d) continue;
      const key = toISODate(startOfWeek(d));
      map.set(key, (map.get(key) || 0) + 1);
    }
    return history.weeks.map((w) => map.get(w.key) || 0);
  }, [done, history.weeks]);

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
          (a, b) => +new Date(b.updated_at) - +new Date(a.updated_at),
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
  const monthRemaining = Math.max(0, plan.monthlyHours - plan.usedMonth);

  return (
    <div className="cd-rep2">
      {/* ---------------- KPI strip: task counts + hours ---------------- */}
      <div className="cd-kpi-row">
        <div className="cd-kpi">
          <div className="cd-kpi-label">Completed this week</div>
          <div className="cd-kpi-value">
            <span className="cd-kpi-num">{counts.thisWeek}</span>
            <span className="cd-kpi-unit">tasks</span>
          </div>
          <div className="cd-kpi-delta">
            <Delta value={pctDelta(counts.thisWeek, counts.lastWeek)} suffix=" WoW" />
          </div>
          <Spark values={weeklyCounts.slice(-8)} />
        </div>

        <div className="cd-kpi">
          <div className="cd-kpi-label">Completed this month</div>
          <div className="cd-kpi-value">
            <span className="cd-kpi-num">{counts.thisMonth}</span>
            <span className="cd-kpi-unit">tasks</span>
          </div>
          <div className="cd-kpi-delta">
            <Delta value={pctDelta(counts.thisMonth, counts.lastMonth)} suffix=" MoM" />
          </div>
        </div>

        <div className="cd-kpi">
          <div className="cd-kpi-label">Total delivered</div>
          <div className="cd-kpi-value">
            <span className="cd-kpi-num">{counts.total}</span>
            <span className="cd-kpi-unit">tasks</span>
          </div>
          <div className="cd-kpi-delta" style={{ color: 'var(--cd-fg-3)' }}>
            all time
          </div>
        </div>

        <div className="cd-kpi">
          <div className="cd-kpi-label">Hours this week</div>
          <div className="cd-kpi-value">
            <span className="cd-kpi-num">{plan.usedWeek}</span>
            <span className="cd-kpi-unit">/ {plan.weeklyHours}h</span>
          </div>
          <div className="cd-kpi-delta">{formatHours(weekRemaining)} left</div>
          <Spark values={history.weeks.slice(-8).map((w) => w.actualHours)} />
        </div>

        <div className="cd-kpi">
          <div className="cd-kpi-label">Hours this month</div>
          <div className="cd-kpi-value">
            <span className="cd-kpi-num">{plan.usedMonth}</span>
            <span className="cd-kpi-unit">/ {plan.monthlyHours}h</span>
          </div>
          <div className="cd-kpi-delta">{formatHours(monthRemaining)} left</div>
          <Spark values={history.months.map((m) => m.actualHours)} />
        </div>
      </div>

      {/* ---------------- Time tracking: this week / this month ---------------- */}
      <div className="cd-rep2-section-head">
        <div>
          <div className="cd-rep-label">Time tracking</div>
          <div className="cd-rep-sub">Actual hours worked vs. your plan allotment</div>
        </div>
        <div className="cd-tt-legend">
          <span><i className="sw actual" /> Actual — time worked</span>
          <span className={ELAPSED_ENABLED ? '' : 'is-off'}>
            <i className="sw elapsed" /> Elapsed — idle time still billed {!ELAPSED_ENABLED && <ElapsedTag />}
          </span>
        </div>
      </div>

      <div className="cd-rep-grid">
        {([
          {
            label: 'This week',
            used: plan.usedWeek,
            allot: plan.weeklyHours,
            remaining: weekRemaining,
          },
          {
            label: 'This month',
            used: plan.usedMonth,
            allot: plan.monthlyHours,
            remaining: monthRemaining,
          },
        ] as const).map((t, i) => (
          <div className="cd-rep-card span-6" key={t.label} style={i === 1 ? { borderRight: 0 } : undefined}>
            <div className="cd-rep-label">{t.label}</div>
            <div className="cd-rep-big" style={{ fontSize: 40 }}>
              {formatHours(t.used)}
              <span className="unit">/ {t.allot}h</span>
            </div>
            <UsageBar used={t.used} allot={t.allot} />
            <div className="cd-stat-row">
              <div className="cd-stat">
                <div className="cd-stat-label">Actual</div>
                <div className="cd-stat-val">{formatHours(t.used)}</div>
              </div>
              <div className="cd-stat">
                <div className="cd-stat-label">Elapsed {!ELAPSED_ENABLED && <ElapsedTag />}</div>
                <div className="cd-stat-val is-muted">{elapsedDisplay(0)}</div>
              </div>
              <div className="cd-stat">
                <div className="cd-stat-label">Total</div>
                <div className="cd-stat-val">{formatHours(t.used)}</div>
              </div>
              <div className="cd-stat">
                <div className="cd-stat-label">Remaining</div>
                <div className="cd-stat-val" style={{ color: t.remaining > 0 ? 'var(--cd-done)' : 'var(--cd-fg-2)' }}>
                  {formatHours(t.remaining)}
                </div>
              </div>
            </div>
          </div>
        ))}
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
                          {t.updated_at ? shortDate(new Date(t.updated_at)) : '—'}
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
