import { useState, useEffect, useMemo } from 'react';
import type { TimesheetProgressLine, TimesheetCompletedTask } from '@squadhub/shared';
import {
  useTimesheetToday,
  useMissingTimesheets,
  useSubmitTimesheet,
} from '../../../hooks/useTimesheet';

function formatHM(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// Trim trailing zeros from auto-computed numbers (e.g. 1.50 → 1.5, 3.00 → 3).
function fmtNum(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0';
}

function prettyDate(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  return d.toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function lineKey(p: { client_id: string; kind: string }) {
  return `${p.client_id}:${p.kind}`;
}

function ProgressRow({
  label,
  achieved,
  target,
  unit,
}: {
  label: string;
  achieved: number;
  target: number;
  unit: string;
}) {
  const pct = target > 0 ? Math.min((achieved / target) * 100, 100) : 0;
  const met = target > 0 && achieved >= target;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-foreground-dim">{label}</span>
        <span className={met ? 'font-medium text-emerald-600' : 'text-foreground-muted'}>
          {fmtNum(achieved)}
          {target > 0 ? ` / ${fmtNum(target)}` : ''} {unit}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-divider">
        <div
          className={`h-full rounded-full ${met ? 'bg-emerald-500' : 'bg-blue-500'}`}
          style={{ width: `${target > 0 ? pct : 0}%` }}
        />
      </div>
    </div>
  );
}

export default function DailyTimesheetTab() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const { data: res, isLoading } = useTimesheetToday(selectedDate ?? undefined);
  const { data: missingRes } = useMissingTimesheets();
  const submit = useSubmitTimesheet();

  const data = res?.data;
  const missing: string[] = missingRes?.data || [];

  const [edited, setEdited] = useState<Record<string, number>>({});
  const [summary, setSummary] = useState('');

  // Re-seed local form state whenever the active date (or submitted snapshot) changes.
  useEffect(() => {
    if (!data) return;
    const init: Record<string, number> = {};
    for (const p of (data.progress || []) as TimesheetProgressLine[]) {
      init[lineKey(p)] = p.achieved_day;
    }
    setEdited(init);
    setSummary(data.timesheet?.summary || '');
  }, [data?.date, data?.already_submitted]);

  const completedByClient = useMemo(() => {
    const groups = new Map<string, { name: string; tasks: TimesheetCompletedTask[] }>();
    for (const t of (data?.completed_tasks || []) as TimesheetCompletedTask[]) {
      const key = t.client_id || '__none__';
      if (!groups.has(key)) groups.set(key, { name: t.client_name || 'No client', tasks: [] });
      groups.get(key)!.tasks.push(t);
    }
    return Array.from(groups.values());
  }, [data?.completed_tasks]);

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-foreground-dim">Loading timesheet…</div>;
  }

  const isToday = !selectedDate;
  const isLate = data.is_backfill || (!isToday && !data.already_submitted);
  const office = data.office_timing;
  const tracked = data.tracked_work_seconds || 0;
  const trackedPct = office && office.office_hours_total_seconds > 0
    ? Math.min((tracked / office.office_hours_total_seconds) * 100, 100)
    : 0;

  const handleSubmit = () => {
    const progress: TimesheetProgressLine[] = (data.progress || []).map((p: TimesheetProgressLine) => ({
      ...p,
      achieved_day: edited[lineKey(p)] ?? p.achieved_day,
    }));
    submit.mutate(
      {
        date: data.date,
        summary,
        progress,
        completed_task_ids: (data.completed_tasks || []).map((t: TimesheetCompletedTask) => t.id),
      },
      { onSuccess: () => setSelectedDate(selectedDate) },
    );
  };

  return (
    <div className="space-y-5 p-5">
      {/* Date + status */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-foreground">{prettyDate(data.date)}</div>
          <div className="text-xs text-foreground-dim">
            {isToday ? "Today's report" : 'Backfilling a missed day'}
          </div>
        </div>
        {data.already_submitted ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
            {data.timesheet?.status === 'late' ? 'Submitted (Late)' : 'Submitted'}
          </span>
        ) : isLate ? (
          <span className="rounded-full bg-yellow-50 px-2.5 py-0.5 text-[10px] font-medium text-yellow-600 dark:bg-yellow-500/15 dark:text-yellow-300">
            Late submission
          </span>
        ) : (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">
            Pending
          </span>
        )}
      </div>

      {/* Missing-day backfill chips */}
      {(missing.length > 0 || !isToday) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-foreground-dim">Submit for:</span>
          <button
            onClick={() => setSelectedDate(null)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              isToday ? 'bg-sh-ink text-surface' : 'bg-surface-alt text-foreground-muted hover:bg-divider'
            }`}
          >
            Today
          </button>
          {missing.slice(0, 7).map((d) => (
            <button
              key={d}
              onClick={() => setSelectedDate(d)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                selectedDate === d
                  ? 'bg-yellow-500 text-white'
                  : 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100 dark:bg-yellow-500/15 dark:text-yellow-300'
              }`}
            >
              {prettyDate(d)}
            </button>
          ))}
        </div>
      )}

      {data.is_holiday ? (
        <div className="rounded-xl border border-divider bg-surface-alt p-6 text-center">
          <p className="text-sm text-foreground-muted">This day is a holiday — no timesheet required.</p>
        </div>
      ) : (
        <>
          {/* Virtual office timing */}
          {office && (
            <div className="rounded-xl border border-divider bg-surface px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 text-foreground-muted" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm font-medium text-foreground">{office.label}</span>
                </div>
                <span className="text-xs text-foreground-muted">
                  <span className="text-foreground">{formatHM(tracked)}</span> / {formatHM(office.office_hours_total_seconds)}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-divider">
                <div className="h-full rounded-full bg-blue-500" style={{ width: `${trackedPct}%` }} />
              </div>
              <div className="mt-1 text-[11px] text-foreground-dim">Tracked office hours</div>
            </div>
          )}

          {/* Per-client progress */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-dim">
              Targets &amp; progress
            </h4>
            {data.progress.length === 0 ? (
              <div className="rounded-xl border border-dashed border-divider p-4 text-center text-xs text-foreground-dim">
                No targets set yet. An admin can assign your per-client targets in Daily Check-Ins → Daily Timesheet.
              </div>
            ) : (
              <div className="space-y-3">
                {(data.progress as TimesheetProgressLine[]).map((p) => {
                  const k = lineKey(p);
                  const unit = p.kind === 'hours' ? 'h' : (p.label || 'items');
                  const dayVal = edited[k] ?? p.achieved_day;
                  return (
                    <div key={k} className="rounded-xl border border-divider bg-surface p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-medium text-foreground">{p.client_name}</div>
                        <span className="rounded-full bg-surface-alt px-2 py-0.5 text-[10px] font-medium uppercase text-foreground-muted">
                          {p.kind === 'hours' ? 'Hours' : p.label || 'Items'}
                        </span>
                      </div>
                      {/* Editable "today" achieved */}
                      <div className="mb-3 flex items-center gap-2">
                        <label className="text-[11px] text-foreground-dim">Done today</label>
                        <input
                          type="number"
                          min={0}
                          step={p.kind === 'hours' ? 0.25 : 1}
                          value={dayVal}
                          disabled={data.already_submitted}
                          onChange={(e) =>
                            setEdited((prev) => ({ ...prev, [k]: parseFloat(e.target.value) || 0 }))
                          }
                          className="w-20 rounded border border-divider bg-surface px-2 py-1 text-sm text-foreground disabled:opacity-60"
                        />
                        <span className="text-[11px] text-foreground-dim">
                          {unit} {p.target_day > 0 ? `(target ${fmtNum(p.target_day)})` : ''}
                        </span>
                      </div>
                      <div className="space-y-2">
                        <ProgressRow label="Today" achieved={dayVal} target={p.target_day} unit={unit} />
                        <ProgressRow label="This week" achieved={p.achieved_week} target={p.target_week} unit={unit} />
                        <ProgressRow label="This month" achieved={p.achieved_month} target={p.target_month} unit={unit} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Completed tasks */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-dim">
              Completed tasks ({data.completed_tasks.length})
            </h4>
            {completedByClient.length === 0 ? (
              <div className="rounded-xl border border-dashed border-divider p-4 text-center text-xs text-foreground-dim">
                No completed tasks recorded for this day.
              </div>
            ) : (
              <div className="space-y-3">
                {completedByClient.map((g) => (
                  <div key={g.name} className="rounded-xl border border-divider bg-surface p-3">
                    <div className="mb-1.5 text-xs font-medium text-foreground">{g.name}</div>
                    <ul className="space-y-1">
                      {g.tasks.map((t) => (
                        <li key={t.id} className="flex items-center justify-between text-xs text-foreground-muted">
                          <span className="flex items-center gap-1.5">
                            <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            {t.title}
                          </span>
                          {t.time_tracked_seconds > 0 && (
                            <span className="text-foreground-dim">{formatHM(t.time_tracked_seconds)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Daily report */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-dim">Daily report</h4>
            <textarea
              value={summary}
              disabled={data.already_submitted}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              placeholder="What did you get done today? Anything blocking you?"
              className="w-full rounded-xl border border-divider bg-surface p-3 text-sm text-foreground placeholder:text-foreground-dim disabled:opacity-60"
            />
          </div>

          {/* Submit */}
          {data.already_submitted ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
              Timesheet submitted
              {data.timesheet?.submitted_at
                ? ` at ${new Date(data.timesheet.submitted_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                : ''}
              .
            </div>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submit.isPending}
              className="w-full rounded-lg bg-sh-ink py-2.5 text-sm font-medium text-surface transition hover:opacity-90 disabled:opacity-50"
            >
              {submit.isPending ? 'Submitting…' : isLate ? 'Submit late timesheet' : 'Submit timesheet'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
