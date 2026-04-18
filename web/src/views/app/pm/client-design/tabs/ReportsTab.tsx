import { useMemo } from 'react';
import type { RequestRowData } from '../atoms/RequestRow';
import { coverFor, seedFromId } from '../atoms/CoverArt';
import type { DesignPlan } from '../../../../../hooks/useClientDesignPlan';
import { formatHours } from '../atoms/LiveTimer';

export default function ReportsTab({
  requests,
  plan,
}: {
  requests: RequestRowData[];
  plan: DesignPlan;
}) {
  const done = useMemo(() => requests.filter((r) => r._derivedStatus === 'done'), [requests]);

  const thisWeek = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    return done.filter((r) => r.updated_at && new Date(r.updated_at) >= start);
  }, [done]);

  const thisMonth = useMemo(() => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return done.filter((r) => r.updated_at && new Date(r.updated_at) >= start);
  }, [done]);

  const trend = useMemo(() => {
    const buckets: { w: string; v: number; current?: boolean }[] = [];
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - i * 7 - weekStart.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const count = done.filter((r) => {
        const d = new Date(r.updated_at);
        return d >= weekStart && d < weekEnd;
      }).length;
      buckets.push({
        w: `W${Math.ceil((weekStart.getDate() + 6 - weekStart.getDay()) / 7) + weekStart.getMonth() * 5}`,
        v: count,
        current: i === 0,
      });
    }
    return buckets;
  }, [done]);

  const categoryBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of requests) {
      const c = ((r.metadata as any)?.category as string | undefined) || 'Other';
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const max = entries[0]?.[1] || 1;
    return entries.slice(0, 9).map(([name, count]) => ({
      name,
      count,
      pct: Math.round((count / max) * 100),
    }));
  }, [requests]);

  const chartW = 100;
  const chartH = 100;
  const maxT = Math.max(1, ...trend.map((t) => t.v));
  const pts = trend.map((t, i) => {
    const x = (i / Math.max(1, trend.length - 1)) * chartW;
    const y = chartH - (t.v / maxT) * chartH;
    return [x, y] as [number, number];
  });
  const path = pts.map((p, i) => (i === 0 ? `M${p[0]} ${p[1]}` : `L${p[0]} ${p[1]}`)).join(' ');
  const area = pts.length ? `${path} L${chartW} ${chartH} L0 ${chartH} Z` : '';

  const lastMonthCount = 0;
  const mom = lastMonthCount ? Math.round(((thisMonth.length - lastMonthCount) / lastMonthCount) * 100) : 0;

  return (
    <div className="cd-rep-grid">
      <div className="cd-rep-card span-4">
        <div className="cd-rep-label">Completed this week</div>
        <div className="cd-rep-big">
          {thisWeek.length}
          <span className="unit">works</span>
        </div>
        <div className="cd-rep-meta-row">
          <span>
            <b>{thisWeek.length}</b> delivered
          </span>
          <span>
            <b>{new Set(thisWeek.map((r) => (r.metadata as any)?.category || 'Other')).size}</b>{' '}
            categories
          </span>
        </div>
      </div>
      <div className="cd-rep-card span-4">
        <div className="cd-rep-label">Completed this month</div>
        <div className="cd-rep-big">
          {thisMonth.length}
          <span className="unit">works</span>
        </div>
        <div className="cd-rep-meta-row">
          <span>
            Last month: <b>{lastMonthCount}</b>
          </span>
          <span>
            <b>{mom > 0 ? `+${mom}` : mom}%</b> MoM
          </span>
        </div>
      </div>
      <div className="cd-rep-card span-4" style={{ borderRight: 0 }}>
        <div className="cd-rep-label">Total delivered</div>
        <div className="cd-rep-big">
          {done.length}
          <span className="unit">works</span>
        </div>
        <div className="cd-rep-meta-row">
          <span>All time</span>
          <span>
            <b>{done.length}</b> in archive
          </span>
        </div>
      </div>

      <div className="cd-rep-card span-8">
        <div className="cd-rep-card-head">
          <div>
            <div className="cd-rep-label">Completion trend</div>
            <div style={{ fontSize: 13, color: 'var(--cd-fg-1)', marginTop: 4 }}>
              Works delivered per week · last 8 weeks
            </div>
          </div>
          <div
            className="hstack"
            style={{ gap: 14, fontFamily: 'var(--cd-font-mono)', fontSize: 10.5, color: 'var(--cd-fg-2)' }}
          >
            <span>
              <span
                style={{
                  display: 'inline-block',
                  width: 9,
                  height: 9,
                  borderRadius: 2,
                  background: 'var(--cd-acc)',
                  verticalAlign: 'middle',
                  marginRight: 5,
                }}
              />
              Delivered
            </span>
            <span style={{ color: 'var(--cd-fg-3)' }}>● current week</span>
          </div>
        </div>
        <svg className="cd-chart-svg" viewBox={`0 0 ${chartW} ${chartH + 18}`} preserveAspectRatio="none">
          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <line
              key={g}
              x1="0"
              x2={chartW}
              y1={g * chartH}
              y2={g * chartH}
              stroke="rgba(20,20,25,0.05)"
              strokeWidth="0.3"
            />
          ))}
          {area && <path d={area} fill="rgba(21,21,26,0.06)" />}
          {path && (
            <path
              d={path}
              fill="none"
              stroke="var(--cd-acc)"
              strokeWidth="0.8"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {pts.map((p, i) => (
            <g key={i}>
              <circle
                cx={p[0]}
                cy={p[1]}
                r={trend[i].current ? 1.4 : 0.9}
                fill={trend[i].current ? 'var(--cd-acc-fg)' : 'var(--cd-acc)'}
                stroke={trend[i].current ? 'var(--cd-acc)' : 'none'}
                strokeWidth="0.6"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={p[0]}
                y={p[1] - 3}
                fontSize="3"
                fill="var(--cd-fg-2)"
                textAnchor="middle"
                fontFamily="ui-monospace"
              >
                {trend[i].v}
              </text>
              <text
                x={p[0]}
                y={chartH + 6}
                fontSize="3"
                fill="var(--cd-fg-3)"
                textAnchor="middle"
                fontFamily="ui-monospace"
              >
                {trend[i].w}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="cd-rep-card span-4" style={{ borderRight: 0 }}>
        <div className="cd-rep-card-head">
          <div>
            <div className="cd-rep-label">Hours used</div>
            <div style={{ fontSize: 13, color: 'var(--cd-fg-1)', marginTop: 4 }}>
              This week vs allotment
            </div>
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              fontFamily: 'var(--cd-font-serif)',
              fontSize: 44,
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            {plan.usedWeek}
            <span
              style={{
                fontFamily: 'var(--cd-font-mono)',
                fontSize: 13,
                color: 'var(--cd-fg-2)',
                marginLeft: 6,
              }}
            >
              / {plan.weeklyHours}h
            </span>
          </div>
          <div
            style={{
              height: 6,
              background: 'var(--cd-bg-3)',
              borderRadius: 3,
              marginTop: 14,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, (plan.usedWeek / plan.weeklyHours) * 100)}%`,
                background: 'var(--cd-acc)',
              }}
            />
          </div>
          <div className="cd-rep-meta-row" style={{ marginTop: 12 }}>
            <span>
              Today: <b>{formatHours(plan.usedToday)}</b>
            </span>
            <span>
              Left today: <b>{formatHours(Math.max(0, plan.dailyHours - plan.usedToday))}</b>
            </span>
          </div>
          <div
            style={{
              fontFamily: 'var(--cd-font-mono)',
              fontSize: 10.5,
              color: 'var(--cd-fg-3)',
              marginTop: 10,
            }}
          >
            Daily unused hours don't carry over.
          </div>
        </div>
      </div>

      <div className="cd-rep-card span-6">
        <div className="cd-rep-card-head">
          <div>
            <div className="cd-rep-label">Category breakdown</div>
            <div style={{ fontSize: 13, color: 'var(--cd-fg-1)', marginTop: 4 }}>
              By work type
            </div>
          </div>
        </div>
        <div style={{ marginTop: 4 }}>
          {categoryBreakdown.length === 0 && (
            <div
              style={{
                padding: 20,
                fontFamily: 'var(--cd-font-mono)',
                fontSize: 11,
                color: 'var(--cd-fg-3)',
                textAlign: 'center',
              }}
            >
              No categorized requests yet
            </div>
          )}
          {categoryBreakdown.map((c) => (
            <div className="cd-cat-row" key={c.name}>
              <div className="cd-cat-name">{c.name}</div>
              <div className="cd-cat-bar">
                <div className="cd-cat-bar-fill" style={{ width: `${c.pct}%` }} />
              </div>
              <div className="cd-cat-count">{c.count}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="cd-rep-card span-6" style={{ borderRight: 0 }}>
        <div className="cd-rep-card-head">
          <div>
            <div className="cd-rep-label">Recently delivered</div>
            <div style={{ fontSize: 13, color: 'var(--cd-fg-1)', marginTop: 4 }}>
              Last completed works
            </div>
          </div>
        </div>
        <div className="cd-gallery">
          {done.slice(0, 6).map((r) => {
            const cat = (r.metadata as any)?.category as string | undefined;
            return (
              <div className="cd-gallery-item" key={r.id}>
                <div
                  className="cd-gallery-cover"
                  style={{
                    backgroundImage: coverFor(seedFromId(r.id), cat || 'artwork'),
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />
                <div className="cd-gallery-body">
                  <div className="cd-gallery-title">{r.title}</div>
                  <div className="cd-gallery-meta">
                    {formatHours((r.time_tracked || 0) / 3600)}
                  </div>
                </div>
              </div>
            );
          })}
          {done.length === 0 && (
            <div
              style={{
                padding: 20,
                fontFamily: 'var(--cd-font-mono)',
                fontSize: 11,
                color: 'var(--cd-fg-3)',
                textAlign: 'center',
                gridColumn: '1/-1',
              }}
            >
              No completed works yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
