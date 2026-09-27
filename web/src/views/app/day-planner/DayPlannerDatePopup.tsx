'use client';
import { useEffect, useMemo, useState } from 'react';
import { usePMStore } from '../../../stores/pmStore';
import { useMyTasks } from '../../../hooks/useTasks';
import {
  addMonths,
  buildMonthCells,
  cellKey,
  flattenMyTasks,
  groupTasksByDay,
  weekdayLabels,
} from '../calendar/calendarUtils';

function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Mini-month date jumper for the Day Planner headers — the same calendar days
 * view as the Cal rail hover (month grid with per-day task dots, today
 * highlighted). Picking a day jumps the planner to it.
 */
export default function DayPlannerDatePopup({
  anchorKey,
  today,
  onSelect,
  onClose,
}: {
  /** Day the planner is currently showing (popup opens on its month). */
  anchorKey: string;
  today: string;
  onSelect: (dayKey: string) => void;
  onClose: () => void;
}) {
  const weekStartsOn = usePMStore((s) => s.calendarWeekStart) ?? 0;
  const { data: myTasks } = useMyTasks();
  const [monthKey, setMonthKey] = useState(() => anchorKey.slice(0, 7));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const monthAnchor = useMemo(() => fromKey(`${monthKey}-01`), [monthKey]);
  const cells = useMemo(() => buildMonthCells(monthAnchor, weekStartsOn), [monthAnchor, weekStartsOn]);
  const labels = useMemo(() => weekdayLabels(weekStartsOn), [weekStartsOn]);
  const byDay = useMemo(() => groupTasksByDay(flattenMyTasks(myTasks)), [myTasks]);

  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(monthAnchor),
    [monthAnchor],
  );

  const stepMonth = (dir: -1 | 1) => {
    const d = fromKey(`${monthKey}-01`);
    const next = addMonths(d, dir);
    setMonthKey(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        className="dp-date-popup"
        role="dialog"
        aria-label="Jump to date"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dp-date-popup-head">
          <button type="button" className="nav-btn" onClick={() => stepMonth(-1)} aria-label="Previous month">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button
            type="button"
            className="dp-date-popup-title"
            onClick={() => setMonthKey(today.slice(0, 7))}
            title="Back to this month"
          >
            {monthLabel}
          </button>
          <button type="button" className="nav-btn" onClick={() => stepMonth(1)} aria-label="Next month">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </div>
        <div className="cal-rail-grid-head">
          {labels.map((w, i) => (
            <div key={i} className="cal-rail-wd">{w[0]}</div>
          ))}
        </div>
        <div className="cal-rail-grid">
          {cells.map((day) => {
            const key = cellKey(day);
            const count = byDay.get(key)?.length ?? 0;
            const inMonth = day.getMonth() === monthAnchor.getMonth();
            return (
              <button
                key={key}
                type="button"
                className="cal-rail-cell"
                data-today={key === today || undefined}
                data-outside={!inMonth || undefined}
                data-selected={key === anchorKey || undefined}
                title={`${key} · ${count} task${count === 1 ? '' : 's'}`}
                onClick={() => {
                  onSelect(key);
                  onClose();
                }}
              >
                <span className="cal-rail-num">{day.getDate()}</span>
                {count > 0 && (
                  <span className="cal-rail-dots" aria-hidden="true">
                    {[0, 1, 2].slice(0, Math.min(3, count)).map((d) => (
                      <i key={d} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="dp-date-popup-today"
          onClick={() => {
            onSelect(today);
            onClose();
          }}
        >
          Jump to today →
        </button>
      </div>
    </>
  );
}
