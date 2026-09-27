import { useMemo, useState } from 'react';
import TodayList from './day-planner/TodayList';
import DayCalendar from './day-planner/DayCalendar';
import PlannerRangeCalendar, { PlannerModeSwitch, PLANNER_MODES, type PlannerMode } from './day-planner/PlannerRangeCalendar';
import { planDateKey } from '../../hooks/useDayPlanner';

// The chosen view (Day / 3 Day / Weekdays / Week / Month) is remembered per browser.
const MODE_KEY = 'dp-view-mode';

function loadMode(): PlannerMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (PLANNER_MODES.some((m) => m.key === v)) return v as PlannerMode;
  } catch { /* ignore */ }
  return 'day';
}

export default function DayPlannerView() {
  const today = useMemo(() => planDateKey(), []);
  const [viewDate, setViewDate] = useState<string>(today);
  const [mode, setModeState] = useState<PlannerMode>(loadMode);
  const setMode = (m: PlannerMode) => {
    setModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
  };
  // Clicking a day header (range views) or a month cell drills into that day.
  const openDay = (key: string) => { setViewDate(key); setMode('day'); };
  const toolbar = <PlannerModeSwitch mode={mode} onChange={setMode} />;

  return (
    <div className="sh-view day-planner-view">
      <TodayList />
      {mode === 'day' ? (
        <DayCalendar date={viewDate} today={today} onDateChange={setViewDate} keyboard toolbar={toolbar} />
      ) : (
        <PlannerRangeCalendar
          mode={mode}
          date={viewDate}
          today={today}
          onDateChange={setViewDate}
          onOpenDay={openDay}
          toolbar={toolbar}
        />
      )}
    </div>
  );
}
