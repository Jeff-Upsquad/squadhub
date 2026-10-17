import { describe, expect, it } from 'vitest';
import type { Task } from '@squadhub/shared';
import { buildFocusTodayGroup, isTaskCompleted, isTaskFocused } from '../lib/taskGrouping';

function makeTask(partial: Record<string, unknown>): Task {
  return {
    id: 't-1',
    title: 'Test task',
    status: 'open' as unknown as Task['status'],
    priority: 'normal',
    is_completed: false,
    completed_at: null,
    work_date: null,
    due_date: null,
    start_date: null,
    focused_at: null,
    created_at: '2026-10-17T00:00:00.000Z',
    updated_at: '2026-10-17T00:00:00.000Z',
    list_id: 'l-1',
    user_id: 'u-1',
    ...partial,
  } as unknown as Task;
}

describe('taskOverviewFocus', () => {
  it('returns null when no open tasks are starred for focus', () => {
    const tasks = [
      makeTask({ id: 't-1', title: 'Task 1' }),
      makeTask({ id: 't-2', title: 'Task 2' }),
    ];
    const openTasks = tasks.filter((t) => !isTaskCompleted(t));
    expect(buildFocusTodayGroup(openTasks)).toBeNull();
  });

  it('builds a focus group with starred tasks in focus order', () => {
    const tasks = [
      makeTask({ id: 't-1', title: 'Normal task' }),
      makeTask({ id: 't-2', title: 'Second focused task', focused_at: '2026-10-17T05:00:00.000Z' }),
      makeTask({ id: 't-3', title: 'First focused task', focused_at: '2026-10-17T04:00:00.000Z' }),
    ];
    const openTasks = tasks.filter((t) => !isTaskCompleted(t));
    const focusGroup = buildFocusTodayGroup(openTasks);

    expect(focusGroup).not.toBeNull();
    expect(focusGroup?.key).toBe('focus_today');
    expect(focusGroup?.label).toBe('Focus Today');
    expect(focusGroup?.tasks.map((t) => t.id)).toEqual(['t-3', 't-2']);
  });

  it('completed focused tasks fall out of the focus group', () => {
    const tasks = [
      makeTask({ id: 't-1', title: 'Done focused task', focused_at: '2026-10-17T04:00:00.000Z', status: 'done' }),
      makeTask({ id: 't-2', title: 'Open focused task', focused_at: '2026-10-17T05:00:00.000Z', status: 'open' }),
    ];
    const openTasks = tasks.filter((t) => !isTaskCompleted(t));
    const focusGroup = buildFocusTodayGroup(openTasks);

    expect(focusGroup?.tasks.map((t) => t.id)).toEqual(['t-2']);
  });

  it('computes row dimming correctly: dimmed only in original section for open focused tasks when focus group exists', () => {
    const tFocused = makeTask({ id: 't-focus', title: 'Focused', focused_at: '2026-10-17T04:00:00.000Z', status: 'open' });
    const tNormal = makeTask({ id: 't-normal', title: 'Normal', status: 'open' });
    const tCompleted = makeTask({ id: 't-done', title: 'Done', focused_at: '2026-10-17T04:00:00.000Z', status: 'done' });

    const openTasks = [tFocused, tNormal, tCompleted].filter((t) => !isTaskCompleted(t));
    const focusGroup = buildFocusTodayGroup(openTasks);

    const isDimmed = (t: Task, allowDim = true) => Boolean(allowDim && focusGroup && isTaskFocused(t) && !isTaskCompleted(t));

    // When rendered inside the Focus Today section (allowDim = false), it is never dimmed:
    expect(isDimmed(tFocused, false)).toBe(false);

    // When rendered in its original group below (allowDim = true), open focused task is dimmed:
    expect(isDimmed(tFocused, true)).toBe(true);
    expect(isDimmed(tNormal, true)).toBe(false);
    expect(isDimmed(tCompleted, true)).toBe(false);
  });
});
