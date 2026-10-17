import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
    },
  });
});

import { usePMStore } from '../stores/pmStore';

describe('manual timer split with running timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePMStore.setState({ timers: [], pausedTimers: [], timerSegmentStart: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('splits overlap 50/50 when a manual entry is logged during an active running timer', () => {
    const t2pm = new Date('2026-10-17T14:00:00Z').getTime();
    const t230pm = new Date('2026-10-17T14:30:00Z').getTime();
    const t3pm = new Date('2026-10-17T15:00:00Z').getTime();

    // 1. Task A starts at 2:00 PM
    vi.setSystemTime(t2pm);
    usePMStore.getState().startParallelTimer('task-a', 'Task A', 'list-1', 0);
    expect(usePMStore.getState().timers.length).toBe(1);
    expect(usePMStore.getState().timerSegmentStart).toBe(t2pm);

    // 2. Fast forward to 3:00 PM
    vi.setSystemTime(t3pm);

    // 3. User manually logs 30 minutes for Task B covering 2:00 PM - 2:30 PM (1800s)
    const split = usePMStore.getState().splitRunningTimersForManualEntry('task-b', t2pm, 1800);

    // Expect overlap to be identified as 30 minutes (1800s)
    expect(split.overlapSec).toBe(1800);

    // Expect Task B's effective duration to be 15 minutes (900s)
    expect(split.effectiveManualDuration).toBe(900);

    // Expect Task A's share for the 2:00 - 2:30 overlap to be flushed with 15 minutes (900s)
    expect(split.shares).toEqual([
      { taskId: 'task-a', listId: 'list-1', startedAt: t2pm, seconds: 900 },
    ]);

    // Expect running timer segment start to advance to 2:30 PM (t230pm)
    expect(usePMStore.getState().timerSegmentStart).toBe(t230pm);

    // 4. Task A stops at 3:00 PM
    const stopRes = usePMStore.getState().stopParallelTimer('task-a');
    expect(stopRes).not.toBeNull();

    // Task A's second segment (2:30 PM to 3:00 PM = 30 minutes = 1800s)
    expect(stopRes!.shares).toEqual([
      { taskId: 'task-a', listId: 'list-1', startedAt: t230pm, seconds: 1800 },
    ]);

    // Total time for Task A = 900s (15m from overlap) + 1800s (30m from solo run) = 2700s (45m)
    const taskATotal = split.shares[0].seconds + stopRes!.shares[0].seconds;
    expect(taskATotal).toBe(2700); // Exactly 45 minutes!

    // Total time for Task B = 900s (15 minutes)
    expect(split.effectiveManualDuration).toBe(900); // Exactly 15 minutes!
  });

  it('splits correctly when manual entry is in the middle of a running timer', () => {
    const t2pm = new Date('2026-10-17T14:00:00Z').getTime();
    const t215pm = new Date('2026-10-17T14:15:00Z').getTime();
    const t245pm = new Date('2026-10-17T14:45:00Z').getTime();
    const t3pm = new Date('2026-10-17T15:00:00Z').getTime();

    // Task A starts at 2:00 PM
    vi.setSystemTime(t2pm);
    usePMStore.getState().startParallelTimer('task-a', 'Task A', 'list-1', 0);

    // At 3:00 PM, manual entry for Task B from 2:15 PM to 2:45 PM (30 min = 1800s)
    vi.setSystemTime(t3pm);
    const split = usePMStore.getState().splitRunningTimersForManualEntry('task-b', t215pm, 1800);

    // Overlap is 30 mins (1800s)
    expect(split.overlapSec).toBe(1800);
    // Task B gets 50% = 15 mins (900s)
    expect(split.effectiveManualDuration).toBe(900);

    // Task A gets:
    // 1) 2:00 PM to 2:15 PM (15m = 900s) at 100%
    // 2) 2:15 PM to 2:45 PM (15m = 900s) at 50%
    expect(split.shares).toEqual([
      { taskId: 'task-a', listId: 'list-1', startedAt: t2pm, seconds: 900 },
      { taskId: 'task-a', listId: 'list-1', startedAt: t215pm, seconds: 900 },
    ]);

    // Segment start moves to 2:45 PM
    expect(usePMStore.getState().timerSegmentStart).toBe(t245pm);

    // Stop Task A at 3:00 PM -> gets 2:45 to 3:00 = 15m (900s)
    const stopRes = usePMStore.getState().stopParallelTimer('task-a');
    expect(stopRes!.shares).toEqual([
      { taskId: 'task-a', listId: 'list-1', startedAt: t245pm, seconds: 900 },
    ]);

    // Total Task A: 15m + 15m + 15m = 45m (2700s)
    const totalA = split.shares.reduce((sum, s) => sum + s.seconds, 0) + stopRes!.shares[0].seconds;
    expect(totalA).toBe(2700);
  });

  it('credits 100% of non-overlapping time when manual entry starts before the timer', () => {
    const t2pm = new Date('2026-10-17T14:00:00Z').getTime();
    const t145pm = new Date('2026-10-17T13:45:00Z').getTime();
    const t215pm = new Date('2026-10-17T14:15:00Z').getTime();

    // Task A starts at 2:00 PM
    vi.setSystemTime(t2pm);
    usePMStore.getState().startParallelTimer('task-a', 'Task A', 'list-1', 0);

    // At 2:15 PM, user manually logs 30 min for Task B from 1:45 PM to 2:15 PM
    vi.setSystemTime(t215pm);
    const split = usePMStore.getState().splitRunningTimersForManualEntry('task-b', t145pm, 1800);

    // Overlap: 2:00 PM to 2:15 PM = 15m (900s)
    expect(split.overlapSec).toBe(900);

    // Task B gets:
    // Non-overlap (1:45 - 2:00): 15m = 900s (100%)
    // Overlap (2:00 - 2:15): 7.5m = 450s (50%)
    // Total Task B = 1350s (22.5 mins)
    expect(split.effectiveManualDuration).toBe(1350);

    // Task A gets 450s for the overlap
    expect(split.shares).toEqual([
      { taskId: 'task-a', listId: 'list-1', startedAt: t2pm, seconds: 450 },
    ]);
  });

  it('splits 3 ways when 2 parallel timers are already running', () => {
    const t2pm = new Date('2026-10-17T14:00:00Z').getTime();
    const t230pm = new Date('2026-10-17T14:30:00Z').getTime();

    vi.setSystemTime(t2pm);
    usePMStore.getState().startParallelTimer('task-a', 'Task A', 'list-1', 0);
    usePMStore.getState().startParallelTimer('task-b', 'Task B', 'list-1', 0);

    vi.setSystemTime(t230pm);
    // Manual entry for Task C from 2:00 PM to 2:30 PM (30 min = 1800s)
    const split = usePMStore.getState().splitRunningTimersForManualEntry('task-c', t2pm, 1800);

    expect(split.overlapSec).toBe(1800);
    // 3 concurrent tasks -> 1800 / 3 = 600s (10m) each
    expect(split.effectiveManualDuration).toBe(600);
    expect(split.shares).toEqual([
      { taskId: 'task-a', listId: 'list-1', startedAt: t2pm, seconds: 600 },
      { taskId: 'task-b', listId: 'list-1', startedAt: t2pm, seconds: 600 },
    ]);
  });

  it('returns full duration unchanged when there are no running timers', () => {
    const t2pm = new Date('2026-10-17T14:00:00Z').getTime();
    const split = usePMStore.getState().splitRunningTimersForManualEntry('task-a', t2pm, 1800);
    expect(split.effectiveManualDuration).toBe(1800);
    expect(split.shares).toEqual([]);
    expect(split.overlapSec).toBe(0);
  });

  it('returns full duration unchanged when manual entry is outside running timer window', () => {
    const t12pm = new Date('2026-10-17T12:00:00Z').getTime();
    const t2pm = new Date('2026-10-17T14:00:00Z').getTime();
    const t3pm = new Date('2026-10-17T15:00:00Z').getTime();

    // Timer starts at 2:00 PM
    vi.setSystemTime(t2pm);
    usePMStore.getState().startParallelTimer('task-a', 'Task A', 'list-1', 0);

    // At 3:00 PM, manual entry for 12:00 PM to 12:30 PM (before timer started)
    vi.setSystemTime(t3pm);
    const split = usePMStore.getState().splitRunningTimersForManualEntry('task-b', t12pm, 1800);

    expect(split.overlapSec).toBe(0);
    expect(split.effectiveManualDuration).toBe(1800);
    expect(split.shares).toEqual([]);
    // Segment start remains 2:00 PM
    expect(usePMStore.getState().timerSegmentStart).toBe(t2pm);
  });
});
