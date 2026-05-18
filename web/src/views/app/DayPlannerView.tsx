import { useMemo, useState } from 'react';
import TodayList from './day-planner/TodayList';
import DayCalendar from './day-planner/DayCalendar';
import { planDateKey } from '../../hooks/useDayPlanner';

export default function DayPlannerView() {
  const today = useMemo(() => planDateKey(), []);
  const [viewDate, setViewDate] = useState<string>(today);
  return (
    <div className="sh-view day-planner-view">
      <TodayList />
      <DayCalendar date={viewDate} today={today} onDateChange={setViewDate} />
    </div>
  );
}
