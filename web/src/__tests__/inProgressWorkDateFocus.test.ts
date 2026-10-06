import { describe, expect, it } from 'vitest';
import type { Task } from '@squadhub/shared';
import { isFutureDay, isToday, isTaskFocused } from '../lib/taskGrouping';

describe('In progress future work date and Focus reappearance', () => {
  const tz = 'UTC';
  const today = '2026-10-06T12:00:00Z';
  const tomorrow = '2026-10-07T00:00:00Z';
  const overdue = '2026-10-04T00:00:00Z';

  // Helper matching TodayList's filtering for in-progress tasks
  function filterInProgress(
    tasks: Task[],
    isActivelyTimed: (id: string) => boolean,
    secondsTodayByTask: Map<string, number>,
    userTz: string,
  ): Task[] {
    return tasks.filter((t) => {
      const statusStr = typeof t.status === 'string' ? t.status : (t.status as unknown as { name?: string })?.name;
      if (statusStr === 'done' || statusStr === 'closed') return false;
      if (isFutureDay(t.work_date, userTz) || isFutureDay((t as unknown as { start_date?: string | null }).start_date, userTz)) {
        return false;
      }
      if (isActivelyTimed(t.id) || (secondsTodayByTask.get(t.id) || 0) > 0) return true;
      const isScheduledToday = isToday(t.work_date, userTz) || isToday((t as unknown as { start_date?: string | null }).start_date, userTz);
      if (isScheduledToday) return false;
      return true;
    });
  }

  it('hides a task from In progress when work_date is moved to a future date', () => {
    const task: Task = {
      id: 'task-1',
      title: 'Group meet feature',
      work_date: tomorrow,
      time_tracked: 1620, // 27m in past
      status: 'in_progress',
      focused_at: '2026-10-01T00:00:00Z',
    } as unknown as Task;

    const inProgress = filterInProgress([task], () => false, new Map(), tz);
    expect(inProgress).toHaveLength(0);
  });

  it('excludes task from In progress and places it in Focus list on that particular date when not yet worked today', () => {
    // When tomorrow arrives, work_date is now today
    const taskOnDate: Task = {
      id: 'task-1',
      title: 'Group meet feature',
      work_date: new Date().toISOString(), // Today
      time_tracked: 1620, // 27m in past
      status: 'todo',
      focused_at: '2026-10-01T00:00:00Z',
    } as unknown as Task;

    const secondsToday = new Map<string, number>();
    const isActivelyTimed = () => false;

    // 1. Should not appear in in-progress section
    const inProgress = filterInProgress([taskOnDate], isActivelyTimed, secondsToday, tz);
    expect(inProgress).toHaveLength(0);

    // 2. Since not in inProgressIds, and isTaskFocused is true, it appears in focus section
    const inProgressIds = new Set(inProgress.map((t) => t.id));
    expect(inProgressIds.has(taskOnDate.id)).toBe(false);

    const isEligibleForFocus =
      isTaskFocused(taskOnDate) &&
      !isFutureDay(taskOnDate.work_date, tz) &&
      !inProgressIds.has(taskOnDate.id);

    expect(isEligibleForFocus).toBe(true);
  });

  it('moves task back to In progress section as soon as it is actively timed or worked today', () => {
    const taskOnDate: Task = {
      id: 'task-1',
      title: 'Group meet feature',
      work_date: new Date().toISOString(), // Today
      time_tracked: 1620,
      status: 'in_progress',
      focused_at: '2026-10-01T00:00:00Z',
    } as unknown as Task;

    // While actively timed:
    const inProgressTimed = filterInProgress([taskOnDate], (id) => id === 'task-1', new Map(), tz);
    expect(inProgressTimed).toHaveLength(1);
    expect(inProgressTimed[0].id).toBe('task-1');

    // Or once time has been tracked today:
    const secondsToday = new Map<string, number>([['task-1', 120]]);
    const inProgressLogged = filterInProgress([taskOnDate], () => false, secondsToday, tz);
    expect(inProgressLogged).toHaveLength(1);
    expect(inProgressLogged[0].id).toBe('task-1');
  });

  it('keeps overdue tasks with past time tracked in In progress', () => {
    const overdueTask: Task = {
      id: 'task-2',
      title: 'cashfree payment gateway integration',
      work_date: overdue,
      time_tracked: 120,
      status: 'in_progress',
    } as unknown as Task;

    const inProgress = filterInProgress([overdueTask], () => false, new Map(), tz);
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0].id).toBe('task-2');
  });
});
