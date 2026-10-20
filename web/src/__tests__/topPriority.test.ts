import { describe, expect, it } from 'vitest';
import type { Task } from '@squadhub/shared';
import { resolveTopPriorityBucket, topPriorityVisibility } from '../lib/topPriority';

const TZ = 'Asia/Kolkata';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Task',
    status: 'todo',
    priority: 'top',
    work_date: null,
    due_date: null,
    start_date: null,
    focused_at: null,
    ...overrides,
  } as Task;
}

describe('Top Priority time gate', () => {
  it('shows a task with no work date straight away', () => {
    const res = topPriorityVisibility({
      task: task(),
      bucket: undefined,
      bucketIsTemplate: false,
      now: new Date('2026-10-20T10:00:00+05:30'),
      timeZone: TZ,
    });
    expect(res.visible).toBe(true);
    expect(res.visibleFrom).toBeNull();
  });

  it('holds back a task whose work date is in the future', () => {
    const res = topPriorityVisibility({
      task: task({ work_date: '2026-10-22T00:00:00.000Z' }),
      bucket: undefined,
      bucketIsTemplate: false,
      now: new Date('2026-10-20T10:00:00+05:30'),
      timeZone: TZ,
    });
    expect(res.visible).toBe(false);
    // It wakes up at the start of its work day (2026-10-22, IST midnight).
    expect(new Date(res.visibleFrom!).toISOString()).toBe('2026-10-21T18:30:00.000Z');
  });

  it('releases a task once its work date arrives', () => {
    const res = topPriorityVisibility({
      task: task({ work_date: '2026-10-22T00:00:00.000Z' }),
      bucket: undefined,
      bucketIsTemplate: false,
      now: new Date('2026-10-22T09:00:00+05:30'),
      timeZone: TZ,
    });
    expect(res.visible).toBe(true);
  });

  it('keeps a task visible when its work date is overdue', () => {
    const res = topPriorityVisibility({
      task: task({ work_date: '2026-10-18T00:00:00.000Z' }),
      bucket: undefined,
      bucketIsTemplate: false,
      now: new Date('2026-10-20T10:00:00+05:30'),
      timeZone: TZ,
    });
    expect(res.visible).toBe(true);
  });

  it('holds back an Evening task until 3 PM', () => {
    const res = topPriorityVisibility({
      task: task(),
      bucket: 'evening',
      bucketIsTemplate: false,
      now: new Date('2026-10-20T10:00:00+05:30'),
      timeZone: TZ,
    });
    expect(res.visible).toBe(false);
    expect(new Date(res.visibleFrom!).toISOString()).toBe('2026-10-20T09:30:00.000Z');
  });

  it('shows an Evening task from 3 PM onwards', () => {
    const res = topPriorityVisibility({
      task: task(),
      bucket: 'evening',
      bucketIsTemplate: false,
      now: new Date('2026-10-20T15:00:00+05:30'),
      timeZone: TZ,
    });
    expect(res.visible).toBe(true);
  });

  it('holds back a Night task until 7 PM', () => {
    const res = topPriorityVisibility({
      task: task(),
      bucket: 'night',
      bucketIsTemplate: false,
      now: new Date('2026-10-20T18:00:00+05:30'),
      timeZone: TZ,
    });
    expect(res.visible).toBe(false);
    expect(new Date(res.visibleFrom!).toISOString()).toBe('2026-10-20T13:30:00.000Z');
  });

  it('does not time-gate the main Focus bucket', () => {
    const res = topPriorityVisibility({
      task: task(),
      bucket: 'focus',
      bucketIsTemplate: false,
      now: new Date('2026-10-20T10:00:00+05:30'),
      timeZone: TZ,
    });
    expect(res.visible).toBe(true);
  });

  it('hides completed tasks', () => {
    const res = topPriorityVisibility({
      task: task({ status: 'done' as never }),
      bucket: undefined,
      bucketIsTemplate: false,
      now: new Date('2026-10-20T10:00:00+05:30'),
      timeZone: TZ,
    });
    expect(res.visible).toBe(false);
  });

  it('lets the later of the two gates decide when both apply', () => {
    // Work date tomorrow AND a Night placement: the Night hour on the work
    // day is the later of the two, so the task waits for 7 PM that day.
    const res = topPriorityVisibility({
      task: task({ work_date: '2026-10-22T00:00:00.000Z' }),
      bucket: 'night',
      bucketIsTemplate: true,
      now: new Date('2026-10-20T10:00:00+05:30'),
      timeZone: TZ,
    });
    expect(res.visible).toBe(false);
    expect(new Date(res.visibleFrom!).toISOString()).toBe('2026-10-22T13:30:00.000Z');
  });

  it('lets the work date win over a per-instance bucket that expires at midnight', () => {
    // A one-off Evening placement is wiped at local midnight, so it cannot
    // defer a task whose work day hasn't started yet.
    const res = topPriorityVisibility({
      task: task({ work_date: '2026-10-22T00:00:00.000Z' }),
      bucket: 'evening',
      bucketIsTemplate: false,
      now: new Date('2026-10-20T10:00:00+05:30'),
      timeZone: TZ,
    });
    expect(res.visible).toBe(false);
    expect(new Date(res.visibleFrom!).toISOString()).toBe('2026-10-21T18:30:00.000Z');
  });
});

describe('Top Priority bucket resolution', () => {
  it('prefers an explicit per-instance placement', () => {
    const res = resolveTopPriorityBucket(task(), { t1: 'evening' }, { t1: 'night' }, false);
    expect(res).toEqual({ bucket: 'evening', isTemplate: false });
  });

  it('falls back to a recurring template placement', () => {
    const res = resolveTopPriorityBucket(
      task({ recurring_parent_id: 'p1' }),
      {},
      { p1: 'night' },
      false,
    );
    expect(res).toEqual({ bucket: 'night', isTemplate: true });
  });

  it('ignores template placements for in-progress tasks', () => {
    const res = resolveTopPriorityBucket(
      task({ recurring_parent_id: 'p1' }),
      {},
      { p1: 'night' },
      true,
    );
    expect(res).toEqual({ bucket: undefined, isTemplate: false });
  });

  it('reports no bucket when nothing is placed', () => {
    const res = resolveTopPriorityBucket(task(), {}, {}, false);
    expect(res).toEqual({ bucket: undefined, isTemplate: false });
  });
});
