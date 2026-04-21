interface Props {
  workSeconds: number;
  breakSeconds: number;
  noWorkSeconds: number;
  officeHoursTotalSeconds?: number;
  maxBreakMinutes?: number;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function TodayTimeSummary({
  workSeconds,
  breakSeconds,
  noWorkSeconds,
  officeHoursTotalSeconds,
  maxBreakMinutes,
}: Props) {
  const tracked = workSeconds + breakSeconds + noWorkSeconds;
  const hasOffice = typeof officeHoursTotalSeconds === 'number' && officeHoursTotalSeconds > 0;

  const denominator = hasOffice ? (officeHoursTotalSeconds as number) : tracked;
  const workPct = denominator > 0 ? (workSeconds / denominator) * 100 : 0;
  const breakPct = denominator > 0 ? (breakSeconds / denominator) * 100 : 0;
  const noWorkPct = denominator > 0 ? (noWorkSeconds / denominator) * 100 : 0;
  const trackedPct = workPct + breakPct + noWorkPct;
  const cappedTrackedPct = Math.min(trackedPct, 100);
  const overBySeconds = hasOffice ? Math.max(0, tracked - (officeHoursTotalSeconds as number)) : 0;
  const unaccountedSeconds = hasOffice ? Math.max(0, (officeHoursTotalSeconds as number) - tracked) : 0;

  const breakLimitSeconds = typeof maxBreakMinutes === 'number' ? maxBreakMinutes * 60 : null;
  const breakTickPct = hasOffice && breakLimitSeconds && breakLimitSeconds > 0
    ? Math.min((breakLimitSeconds / (officeHoursTotalSeconds as number)) * 100, 100)
    : null;
  const breakOverLimit = breakLimitSeconds !== null && breakSeconds > breakLimitSeconds;

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Today's Time</h4>
        {overBySeconds > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600">
            +{formatDuration(overBySeconds)} over
          </span>
        )}
      </div>

      {(hasOffice || tracked > 0) && (
        <div className="relative mb-3 h-2.5 overflow-hidden rounded-full bg-[#E2E8F0]">
          <div className="flex h-full" style={{ width: `${cappedTrackedPct}%` }}>
            {workPct > 0 && <div className="bg-blue-500" style={{ width: `${(workPct / trackedPct) * 100}%` }} />}
            {breakPct > 0 && <div className="bg-amber-400" style={{ width: `${(breakPct / trackedPct) * 100}%` }} />}
            {noWorkPct > 0 && <div className="bg-gray-400" style={{ width: `${(noWorkPct / trackedPct) * 100}%` }} />}
          </div>
          {breakTickPct !== null && (
            <div
              className="pointer-events-none absolute top-0 h-full w-px bg-red-500"
              style={{ left: `${breakTickPct}%` }}
              title={`Max break: ${maxBreakMinutes}m`}
            />
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-lg font-bold text-blue-600">{formatDuration(workSeconds)}</p>
          <p className="text-[10px] uppercase tracking-wider text-[#90A1B9]">Work</p>
        </div>
        <div>
          <p className="text-lg font-bold text-amber-500">{formatDuration(breakSeconds)}</p>
          <p className="text-[10px] uppercase tracking-wider text-[#90A1B9]">Break</p>
        </div>
        <div>
          <p className="text-lg font-bold text-gray-500">{formatDuration(noWorkSeconds)}</p>
          <p className="text-[10px] uppercase tracking-wider text-[#90A1B9]">No Work</p>
        </div>
      </div>

      {hasOffice && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {unaccountedSeconds > 0 && (
            <span className="rounded-full bg-[#E2E8F0] px-2 py-0.5 text-[10px] font-medium text-[#62748E]">
              Unaccounted: {formatDuration(unaccountedSeconds)}
            </span>
          )}
          {breakOverLimit && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600">
              Break over limit
            </span>
          )}
        </div>
      )}

      {!hasOffice && tracked === 0 && (
        <p className="mt-1 text-center text-xs text-[#90A1B9]">Start a timer to begin tracking</p>
      )}
    </div>
  );
}
