export interface HoursDay {
  day: string;
  used: number;
  allot: number;
  over: number;
  today?: boolean;
  weekend?: boolean;
  future?: boolean;
}

export default function HoursBars({ days }: { days: HoursDay[] }) {
  const maxVal = Math.max(...days.map((d) => Math.max(d.allot, d.used + d.over))) || 4;
  return (
    <>
      <div className="cd-hours-bars">
        {days.map((d) => {
          const allotPct = (d.allot / maxVal) * 100;
          const usedPct = (Math.min(d.used, d.allot) / maxVal) * 100;
          const overPct = (d.over / maxVal) * 100;
          return (
            <div className="cd-hours-bar-wrap" key={d.day}>
              <div
                className={`cd-hours-bar${d.today ? ' cd-hours-bar-today' : ''}`}
                style={{ height: `${allotPct || 6}%`, opacity: d.weekend ? 0.3 : 1 }}
              >
                {d.over > 0 && (
                  <div
                    className="cd-hours-bar-over"
                    style={{ height: `${(overPct / (allotPct || 1)) * 100}%` }}
                  />
                )}
                <div
                  className="cd-hours-bar-used"
                  style={{ height: `${(usedPct / (allotPct || 1)) * 100}%` }}
                />
              </div>
              <div className={`cd-hours-bar-label${d.today ? ' active' : ''}`}>{d.day}</div>
            </div>
          );
        })}
      </div>
      <div className="cd-hours-legend">
        <span>
          <span className="sw allot" /> Allotment
        </span>
        <span>
          <span className="sw used" /> Used
        </span>
        <span>
          <span className="sw over" /> Over budget
        </span>
        <span style={{ marginLeft: 'auto', color: 'var(--cd-fg-3)' }}>
          Unused hours don't roll over
        </span>
      </div>
    </>
  );
}
