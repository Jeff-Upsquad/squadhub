'use client';
import { useMemo } from 'react';
import { useMyTasks } from '../../../hooks/useTasks';
import { flattenMyTasks } from './calendarUtils';
import CalendarTaskPalette from './CalendarTaskPalette';

// Outer palette for Calendar — rendered in MainLayout's shared module sidebar
// so its width/height match Home/Resources (240px, full-height, resizable).
// Keeps the same data as CalendarView's internal palette but self-contained
// so the view can hide its internal left pane without duplicating state.
export default function CalendarOuterPalette() {
  const { data, isLoading } = useMyTasks();
  const allTasks = useMemo(() => flattenMyTasks(data), [data]);
  // Simplified scheduled check (work_date) — the full day-plans range check lives
  // in CalendarView for the grid, but for the sidebar filter this is sufficient
  // to keep counts consistent and avoid needing anchor/dayKeys here.
  const scheduledIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of allTasks) if (t.work_date) ids.add(t.id);
    return ids;
  }, [allTasks]);

  return <CalendarTaskPalette tasks={allTasks} isLoading={isLoading} scheduledIds={scheduledIds} />;
}
