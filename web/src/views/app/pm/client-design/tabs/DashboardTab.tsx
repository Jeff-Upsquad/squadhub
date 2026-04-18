import { useMemo } from 'react';
import type { RequestRowData } from '../atoms/RequestRow';
import RequestRow from '../atoms/RequestRow';
import HoursBars from '../atoms/HoursBars';
import Avatar from '../atoms/Avatar';
import type { DesignPlan } from '../../../../../hooks/useClientDesignPlan';

export default function DashboardTab({
  requests,
  plan,
  onOpenRequest,
  onSwitchTab,
}: {
  requests: RequestRowData[];
  plan: DesignPlan;
  onOpenRequest: (r: RequestRowData) => void;
  onSwitchTab: (tab: string) => void;
}) {
  const active = useMemo(() => requests.filter((r) => r._derivedStatus !== 'done'), [requests]);
  const inProgress = useMemo(() => requests.filter((r) => r._derivedStatus === 'progress'), [requests]);

  const remainingWeek = Math.max(0, plan.weeklyHours - plan.usedWeek);
  const pctOfPlan = plan.weeklyHours
    ? Math.round((plan.usedWeek / plan.weeklyHours) * 100)
    : 0;
  const remainingToday = Math.max(0, plan.dailyHours - plan.usedToday);

  const kpis = [
    {
      label: 'Active requests',
      dot: 'var(--cd-progress)',
      num: active.length,
      unit: 'open',
      delta: `${inProgress.length} in progress`,
      spark: [3, 4, 3, 5, 4, 6, 5, active.length % 9 || 7],
    },
    {
      label: 'In progress',
      dot: 'var(--cd-progress)',
      num: inProgress.length,
      unit: 'tasks',
      delta: `${new Set(inProgress.flatMap((r) => r.assignees?.map((a) => a.id) || [])).size} designers working`,
      spark: [1, 2, 2, 1, 3, 2, 3, 2],
    },
    {
      label: 'Hours used today',
      dot: 'var(--cd-acc)',
      num: plan.usedToday,
      unit: `/ ${plan.dailyHours}h`,
      delta: `${remainingToday.toFixed(1)}h remaining`,
      spark: [1, 3, 2, 4, 3, 2, 3, 2],
    },
    {
      label: 'Used this week',
      dot: 'var(--cd-review)',
      num: plan.usedWeek,
      unit: `/ ${plan.weeklyHours}h`,
      delta: `${pctOfPlan}% of plan`,
      spark: [2, 3, 4, 3, 4, 3, 4, 3],
    },
    {
      label: 'Remaining week',
      dot: 'var(--cd-done)',
      num: Math.round(remainingWeek * 10) / 10,
      unit: 'hours left',
      delta: "Unused doesn't roll over",
      spark: [8, 7, 6, 5, 4, 4, 3, 3],
    },
  ];

  // Designer roster = unique assignees across active work
  const designers = useMemo(() => {
    const seen = new Map<string, NonNullable<RequestRowData['assignees']>[number]>();
    for (const r of active) {
      for (const a of r.assignees || []) {
        if (!seen.has(a.id)) seen.set(a.id, a);
      }
    }
    return Array.from(seen.values());
  }, [active]);

  // Activity = last 7 updated_at (mock messages based on status)
  const activity = useMemo(() => {
    const sorted = [...requests]
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
      .slice(0, 7);
    return sorted.map((r) => {
      const actor = r.assignees?.[0] || r.creator;
      let verb = 'updated';
      if (r._derivedStatus === 'progress') verb = 'started';
      else if (r._derivedStatus === 'review') verb = 'moved to review';
      else if (r._derivedStatus === 'done') verb = 'completed';
      else verb = 'submitted';
      return { r, actor, verb };
    });
  }, [requests]);

  function relTime(iso: string): string {
    const delta = Date.now() - new Date(iso).getTime();
    const min = Math.floor(delta / 60000);
    if (min < 1) return 'now';
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h`;
    const d = Math.floor(hr / 24);
    return `${d}d`;
  }

  return (
    <>
      <div className="cd-kpi-row">
        {kpis.map((k) => (
          <div className="cd-kpi" key={k.label}>
            <div className="cd-kpi-label">
              <span className="cd-kpi-dot" style={{ background: k.dot }} />
              {k.label}
            </div>
            <div className="cd-spark">
              {k.spark.map((v, i) => (
                <span key={i} style={{ height: `${Math.max(4, v * 3)}px`, opacity: 0.3 + i * 0.08 }} />
              ))}
            </div>
            <div className="cd-kpi-value">
              <span className="cd-kpi-num">{k.num}</span>
              <span className="cd-kpi-unit">{k.unit}</span>
            </div>
            <div className="cd-kpi-delta">{k.delta}</div>
          </div>
        ))}
      </div>

      <div className="cd-ov-cols">
        <div className="cd-ov-col">
          <div className="cd-section-head">
            <div className="cd-section-title">
              Active work
              <span className="mono-count">{active.length}</span>
            </div>
            <button className="cd-section-action" onClick={() => onSwitchTab('requests')}>
              View all →
            </button>
          </div>
          {active.length > 0 && (
            <div className="cd-list-head-row">
              <span />
              <span>Title</span>
              <span>Assigned</span>
              <span>Timer</span>
              <span className="right">Due</span>
              <span />
            </div>
          )}
          {active.slice(0, 7).map((r) => (
            <RequestRow key={r.id} request={r} onClick={() => onOpenRequest(r)} />
          ))}
          {active.length === 0 && (
            <div
              style={{
                padding: 24,
                fontFamily: 'var(--cd-font-mono)',
                fontSize: 11,
                color: 'var(--cd-fg-3)',
                border: '1px dashed var(--cd-br-1)',
                borderRadius: 6,
                textAlign: 'center',
                marginTop: 4,
              }}
            >
              No active design requests. Press <b style={{ color: 'var(--cd-fg-1)' }}>N</b> to submit one.
            </div>
          )}

          <div style={{ marginTop: 28 }}>
            <div className="cd-section-head">
              <div className="cd-section-title">
                Hours this week
                <span className="mono-count">
                  {plan.usedWeek}h / {plan.weeklyHours}h
                </span>
              </div>
              <button className="cd-section-action" onClick={() => onSwitchTab('reports')}>
                See report →
              </button>
            </div>
            <HoursBars days={plan.days} />
          </div>
        </div>

        <div className="cd-ov-col">
          <div className="cd-section-head">
            <div className="cd-section-title">
              Your squad
              <span className="mono-count">{designers.length}</span>
            </div>
          </div>
          {designers.length === 0 && (
            <div
              style={{
                padding: 16,
                fontFamily: 'var(--cd-font-mono)',
                fontSize: 11,
                color: 'var(--cd-fg-3)',
                border: '1px dashed var(--cd-br-1)',
                borderRadius: 6,
                textAlign: 'center',
              }}
            >
              No designers assigned yet
            </div>
          )}
          {designers.map((d) => {
            const onTask = active.find((r) =>
              r.assignees?.some((a) => a.id === d.id) && r._derivedStatus === 'progress',
            );
            return (
              <div key={d.id} className="cd-designer-card">
                <Avatar person={d} size="lg" />
                <div className="cd-designer-info">
                  <div className="cd-designer-name">{d.display_name || d.email}</div>
                  <div className="cd-designer-role">{'designer'}</div>
                  {onTask && (
                    <div className="cd-designer-now">
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: 'var(--cd-progress)',
                          display: 'inline-block',
                        }}
                      />
                      Working on {onTask.title.slice(0, 32)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div className="cd-section-head" style={{ marginTop: 24 }}>
            <div className="cd-section-title">Activity</div>
          </div>
          {activity.length === 0 && (
            <div
              style={{
                padding: 16,
                fontFamily: 'var(--cd-font-mono)',
                fontSize: 11,
                color: 'var(--cd-fg-3)',
                border: '1px dashed var(--cd-br-1)',
                borderRadius: 6,
                textAlign: 'center',
              }}
            >
              No activity yet
            </div>
          )}
          {activity.map(({ r, actor, verb }, i) => (
            <div key={r.id + '-' + i} className="cd-activity-item">
              <div className="cd-activity-avatar">
                {actor ? <Avatar person={actor} size="xs" /> : <span className="cd-avatar xs">?</span>}
              </div>
              <div className="cd-activity-text">
                <b>{actor?.display_name || actor?.email || 'Someone'}</b> {verb}{' '}
                <span className="ref">{r.title.slice(0, 40)}</span>
              </div>
              <div className="cd-activity-time">{relTime(r.updated_at)}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
