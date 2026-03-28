interface Props {
  workSeconds: number;
  breakSeconds: number;
  noWorkSeconds: number;
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function TodayTimeSummary({ workSeconds, breakSeconds, noWorkSeconds }: Props) {
  const total = workSeconds + breakSeconds + noWorkSeconds;

  const workPct = total > 0 ? (workSeconds / total) * 100 : 0;
  const breakPct = total > 0 ? (breakSeconds / total) * 100 : 0;
  const noWorkPct = total > 0 ? (noWorkSeconds / total) * 100 : 0;

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#90A1B9]">Today's Time</h4>

      {/* Progress bar */}
      {total > 0 && (
        <div className="mb-3 flex h-2.5 overflow-hidden rounded-full bg-[#E2E8F0]">
          {workPct > 0 && <div className="bg-blue-500" style={{ width: `${workPct}%` }} />}
          {breakPct > 0 && <div className="bg-amber-400" style={{ width: `${breakPct}%` }} />}
          {noWorkPct > 0 && <div className="bg-gray-400" style={{ width: `${noWorkPct}%` }} />}
        </div>
      )}

      {/* Stats */}
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

      {total === 0 && (
        <p className="mt-1 text-center text-xs text-[#90A1B9]">Start a timer to begin tracking</p>
      )}
    </div>
  );
}
