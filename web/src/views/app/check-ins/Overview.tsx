import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import DmSidePanel, { type DmTarget } from './DmSidePanel';

type TodayCheckin = {
  user_id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  role: string | null;
  status: 'on_time' | 'late' | 'pending' | 'no_checkin';
  submitted_at: string | null;
  deadline_time: string;
};

type TrendDay = {
  date: string;
  isWorkingDay: boolean;
  onTime: number;
  late: number;
  missed: number;
};

type LeaderboardRow = {
  user_id: string;
  display_name: string;
  email: string;
  role: string | null;
  working_days: number;
  on_time: number;
  late: number;
  missed: number;
  attendance_rate: number;
};

type OverviewData = {
  today: {
    date: string;
    isWorkingDay: boolean;
    holidayName: string | null;
    totalEligible: number;
    onTime: number;
    late: number;
    pending: number;
    missed: number;
    attendanceRate: number;
    checkins: TodayCheckin[];
  };
  trend: TrendDay[];
  leaderboard: LeaderboardRow[];
  windowDays: number;
};

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  on_time: { label: 'On Time', className: 'bg-emerald-50 text-emerald-600' },
  late: { label: 'Late', className: 'bg-yellow-50 text-yellow-600' },
  pending: { label: 'Pending', className: 'bg-blue-50 text-blue-600' },
  no_checkin: { label: 'Missed', className: 'bg-red-50 text-red-600' },
};

// Group order for today's table (matches the stat tiles).
const STATUS_ORDER: TodayCheckin['status'][] = ['on_time', 'late', 'pending', 'no_checkin'];

type SortKey = 'attendance' | 'late' | 'missed';
const PAGE_SIZE = 25;

export default function Overview() {
  const [days, setDays] = useState(30);
  const [sortKey, setSortKey] = useState<SortKey>('attendance');
  const [page, setPage] = useState(1);
  const [dmUser, setDmUser] = useState<DmTarget | null>(null);
  const meId = useAuthStore((s) => s.user?.id);

  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-checkin-overview', days],
    queryFn: () => api.get(`/admin/checkin/overview?days=${days}`).then((r) => r.data),
    refetchOnWindowFocus: true,
  });

  const data: OverviewData | null = res?.data || null;

  const sortedLeaderboard = useMemo(() => {
    if (!data) return [];
    const arr = [...data.leaderboard];
    if (sortKey === 'attendance') {
      arr.sort((a, b) => b.attendance_rate - a.attendance_rate || a.missed - b.missed);
    } else if (sortKey === 'late') {
      arr.sort((a, b) => b.late - a.late || a.display_name.localeCompare(b.display_name));
    } else {
      arr.sort((a, b) => b.missed - a.missed || a.display_name.localeCompare(b.display_name));
    }
    return arr;
  }, [data, sortKey]);

  const pagedLeaderboard = sortedLeaderboard.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(sortedLeaderboard.length / PAGE_SIZE));

  // Today's check-ins grouped by attendance status (fixed order).
  const groupedToday = useMemo(() => {
    if (!data) return [] as { status: TodayCheckin['status']; rows: TodayCheckin[] }[];
    const map = new Map<string, TodayCheckin[]>();
    for (const c of data.today.checkins) {
      const key = c.status || 'no_checkin';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return STATUS_ORDER.filter((s) => map.has(s)).map((status) => ({
      status,
      rows: map.get(status)!.sort((a, b) => a.display_name.localeCompare(b.display_name)),
    }));
  }, [data]);

  if (isLoading || !data) {
    return <div className="rounded-xl border border-divider bg-surface p-12 text-center text-sm text-foreground-dim">Loading overview…</div>;
  }

  const { today } = data;
  const todayDateLabel = new Date(today.date + 'T00:00:00Z').toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-6">
      {/* Today's status */}
      <section className="rounded-xl border border-divider bg-surface p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Today · {todayDateLabel}</h2>
            <p className="mt-0.5 text-xs text-foreground-dim">
              {today.holidayName
                ? `Holiday: ${today.holidayName}`
                : today.isWorkingDay
                ? `${today.totalEligible} eligible users`
                : 'Non-working day — no check-ins expected'}
            </p>
          </div>
          {today.isWorkingDay && (
            <div className="text-right">
              <div className="text-[10px] font-medium uppercase tracking-wider text-foreground-dim">Attendance</div>
              <div className="text-2xl font-bold text-foreground">
                {Math.round(today.attendanceRate * 100)}%
              </div>
            </div>
          )}
        </div>

        {today.isWorkingDay ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="On Time" value={today.onTime} accent="emerald" />
              <StatTile label="Late" value={today.late} accent="yellow" />
              <StatTile label="Pending" value={today.pending} accent="blue" />
              <StatTile label="Missed" value={today.missed} accent="red" />
            </div>

            <div className="mt-5 overflow-hidden rounded-lg border border-divider">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-divider bg-surface-alt text-left">
                    <th className="px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-foreground-dim">User</th>
                    <th className="px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-foreground-dim">Role</th>
                    <th className="px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-foreground-dim">Submitted</th>
                    <th className="px-4 py-2 text-[10px] font-medium uppercase tracking-wider text-foreground-dim">Deadline</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedToday.map((group) => {
                    const badge = STATUS_BADGES[group.status] ?? STATUS_BADGES.no_checkin;
                    return (
                      <Fragment key={group.status}>
                        <tr className="border-b border-divider bg-surface-alt/60">
                          <td colSpan={4} className="px-4 py-1.5">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>
                              {badge.label}
                            </span>
                            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted">
                              {group.rows.length}
                            </span>
                          </td>
                        </tr>
                        {group.rows.map((c) => (
                          <tr key={c.user_id} className="group border-b border-divider last:border-0">
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm text-foreground">{c.display_name}</div>
                                  <div className="text-[11px] text-foreground-dim">{c.email}</div>
                                </div>
                                {c.user_id !== meId && (
                                  <MessageButton
                                    name={c.display_name}
                                    onClick={() => setDmUser({ id: c.user_id, display_name: c.display_name, avatar_url: c.avatar_url })}
                                  />
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-foreground-muted">{c.role || '—'}</td>
                            <td className="px-4 py-2.5 text-xs text-foreground-muted">
                              {c.submitted_at
                                ? new Date(c.submitted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })
                                : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-foreground-muted">{c.deadline_time}</td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                  {today.checkins.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-foreground-dim">
                        No eligible users found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="rounded-lg bg-surface-alt px-4 py-6 text-center text-sm text-foreground-muted">
            {today.holidayName
              ? `${today.holidayName} — check-ins are not tracked today.`
              : 'Today is a non-working day — check-ins are not tracked.'}
          </div>
        )}
      </section>

      {/* Trend */}
      <section className="rounded-xl border border-divider bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Trend</h2>
            <p className="mt-0.5 text-xs text-foreground-dim">Last {data.windowDays} days · working days only</p>
          </div>
          <div className="flex gap-1 rounded-lg bg-canvas p-1">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => { setDays(d); setPage(1); }}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  days === d ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        <TrendChart trend={data.trend} />
        <div className="mt-3 flex items-center justify-center gap-4 text-[10px] text-foreground-dim">
          <LegendDot color="bg-emerald-400" label="On Time" />
          <LegendDot color="bg-yellow-400" label="Late" />
          <LegendDot color="bg-red-400" label="Missed" />
        </div>
      </section>

      {/* Leaderboard */}
      <section className="rounded-xl border border-divider bg-surface">
        <div className="flex items-center justify-between border-b border-divider px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Per-user attendance</h2>
            <p className="mt-0.5 text-xs text-foreground-dim">Last {data.windowDays} working days</p>
          </div>
          <div className="flex gap-1 rounded-lg bg-canvas p-1">
            <SortPill active={sortKey === 'attendance'} onClick={() => { setSortKey('attendance'); setPage(1); }}>Attendance</SortPill>
            <SortPill active={sortKey === 'late'} onClick={() => { setSortKey('late'); setPage(1); }}>Late</SortPill>
            <SortPill active={sortKey === 'missed'} onClick={() => { setSortKey('missed'); setPage(1); }}>Missed</SortPill>
          </div>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-divider text-left">
              <th className="px-5 py-3 text-xs font-medium text-foreground-muted">User</th>
              <th className="px-5 py-3 text-xs font-medium text-foreground-muted">Role</th>
              <th className="px-5 py-3 text-xs font-medium text-foreground-muted">Working Days</th>
              <th className="px-5 py-3 text-xs font-medium text-foreground-muted">On Time</th>
              <th className="px-5 py-3 text-xs font-medium text-foreground-muted">Late</th>
              <th className="px-5 py-3 text-xs font-medium text-foreground-muted">Missed</th>
              <th className="px-5 py-3 text-xs font-medium text-foreground-muted">Attendance</th>
            </tr>
          </thead>
          <tbody>
            {pagedLeaderboard.map((row) => (
              <tr key={row.user_id} className="group border-b border-divider last:border-0">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0">
                      <div className="text-sm text-foreground">{row.display_name}</div>
                      <div className="text-[11px] text-foreground-dim">{row.email}</div>
                    </div>
                    {row.user_id !== meId && (
                      <MessageButton
                        name={row.display_name}
                        onClick={() => setDmUser({ id: row.user_id, display_name: row.display_name })}
                      />
                    )}
                  </div>
                </td>
                <td className="px-5 py-3 text-xs text-foreground-muted">{row.role || '—'}</td>
                <td className="px-5 py-3 text-sm text-foreground-muted">{row.working_days}</td>
                <td className="px-5 py-3 text-sm text-emerald-600">{row.on_time}</td>
                <td className="px-5 py-3 text-sm text-yellow-600">{row.late}</td>
                <td className="px-5 py-3 text-sm text-red-500">{row.missed}</td>
                <td className="px-5 py-3">
                  <AttendanceBar rate={row.attendance_rate} />
                </td>
              </tr>
            ))}
            {pagedLeaderboard.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-sm text-foreground-dim">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-divider px-5 py-3">
            <p className="text-xs text-foreground-dim">{sortedLeaderboard.length} users</p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded border border-divider px-2 py-1 text-xs disabled:opacity-30"
              >
                Prev
              </button>
              <span className="px-2 py-1 text-xs text-foreground-muted">{page} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded border border-divider px-2 py-1 text-xs disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      {dmUser && <DmSidePanel key={dmUser.id} user={dmUser} onClose={() => setDmUser(null)} />}
    </div>
  );
}

function MessageButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Message ${name}`}
      aria-label={`Message ${name}`}
      className="shrink-0 rounded-md p-1 text-foreground-muted opacity-0 transition hover:bg-surface-alt hover:text-foreground focus:opacity-100 group-hover:opacity-100"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.8-5.9a8.5 8.5 0 0 1-.8-3.6A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
      </svg>
    </button>
  );
}

function StatTile({ label, value, accent }: { label: string; value: number; accent: 'emerald' | 'yellow' | 'blue' | 'red' }) {
  const color: Record<typeof accent, string> = {
    emerald: 'text-emerald-600',
    yellow: 'text-yellow-600',
    blue: 'text-blue-600',
    red: 'text-red-500',
  };
  return (
    <div className="rounded-lg border border-divider bg-surface-alt px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-foreground-dim">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold ${color[accent]}`}>{value}</div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-sm ${color}`} />
      <span>{label}</span>
    </div>
  );
}

function SortPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-xs font-medium transition ${
        active ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-muted'
      }`}
    >
      {children}
    </button>
  );
}

function AttendanceBar({ rate }: { rate: number }) {
  const pct = Math.round(rate * 100);
  const color = pct >= 90 ? 'bg-emerald-400' : pct >= 70 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-canvas">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-foreground">{pct}%</span>
    </div>
  );
}

function TrendChart({ trend }: { trend: TrendDay[] }) {
  const workingTrend = trend.filter((d) => d.isWorkingDay);
  if (workingTrend.length === 0) {
    return <div className="py-8 text-center text-xs text-foreground-dim">No working days in this window.</div>;
  }

  const max = Math.max(1, ...workingTrend.map((d) => d.onTime + d.late + d.missed));
  const chartHeight = 160;
  const barGap = 2;
  const barWidth = Math.max(8, Math.min(28, Math.floor((600 - barGap * workingTrend.length) / workingTrend.length)));
  const totalWidth = workingTrend.length * (barWidth + barGap);

  return (
    <div className="overflow-x-auto">
      <svg width={totalWidth} height={chartHeight + 20} viewBox={`0 0 ${totalWidth} ${chartHeight + 20}`}>
        {workingTrend.map((d, i) => {
          const total = d.onTime + d.late + d.missed;
          const x = i * (barWidth + barGap);
          const onTimeH = (d.onTime / max) * chartHeight;
          const lateH = (d.late / max) * chartHeight;
          const missedH = (d.missed / max) * chartHeight;
          const baseY = chartHeight;

          // Stack: on_time at bottom, late middle, missed top
          const onTimeY = baseY - onTimeH;
          const lateY = onTimeY - lateH;
          const missedY = lateY - missedH;

          const dateLabel = new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-IN', {
            timeZone: 'UTC',
            day: 'numeric',
            month: 'short',
          });

          return (
            <g key={d.date}>
              <title>{`${dateLabel}: ${d.onTime} on time, ${d.late} late, ${d.missed} missed`}</title>
              {d.onTime > 0 && (
                <rect x={x} y={onTimeY} width={barWidth} height={onTimeH} fill="rgb(52 211 153)" rx={2} />
              )}
              {d.late > 0 && (
                <rect x={x} y={lateY} width={barWidth} height={lateH} fill="rgb(250 204 21)" rx={2} />
              )}
              {d.missed > 0 && (
                <rect x={x} y={missedY} width={barWidth} height={missedH} fill="rgb(248 113 113)" rx={2} />
              )}
              {total === 0 && (
                <rect x={x} y={baseY - 2} width={barWidth} height={2} fill="rgb(226 232 240)" rx={1} />
              )}
              {(i === 0 || i === workingTrend.length - 1 || i % Math.max(1, Math.floor(workingTrend.length / 8)) === 0) && (
                <text
                  x={x + barWidth / 2}
                  y={chartHeight + 14}
                  fontSize={9}
                  fill="rgb(144 161 185)"
                  textAnchor="middle"
                >
                  {dateLabel}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
