import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { usePMStore, MAX_TIMER_SESSION_MS } from '../stores/pmStore';

const HOUR = 60 * 60 * 1000;
const SIX_HOURS_SEC = MAX_TIMER_SESSION_MS / 1000;
const store = () => usePMStore.getState();
const total = (shares: { taskId: string; seconds: number }[], taskId: string) =>
  shares.filter((s) => s.taskId === taskId).reduce((sum, s) => sum + s.seconds, 0);

describe('task timer 6-hour limit', () => {
  const start = new Date('2026-11-07T04:00:00Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    usePMStore.setState({ timers: [], pausedTimers: [], timerSegmentStart: null });
  });
  afterEach(() => vi.useRealTimers());

  it('leaves a timer running below the limit', () => {
    store().startParallelTimer('a', 'A', 'list', 0);
    vi.setSystemTime(start + 6 * HOUR - 1000);
    expect(store().expireLongRunningTimers()).toEqual({ expired: [], shares: [] });
    expect(store().timers).toHaveLength(1);
  });

  it('logs exactly 6 hours for a timer forgotten for days', () => {
    store().startParallelTimer('a', 'A', 'list', 0);
    vi.setSystemTime(start + 112 * HOUR);
    const { expired, shares } = store().expireLongRunningTimers();
    expect(expired.map((t) => t.taskId)).toEqual(['a']);
    expect(shares).toEqual([{ taskId: 'a', listId: 'list', startedAt: start, seconds: SIX_HOURS_SEC }]);
    expect(store().timers).toEqual([]);
    expect(store().timerSegmentStart).toBeNull();
  });

  it('caps a manual stop made after the limit', () => {
    store().startParallelTimer('a', 'A', 'list', 0);
    vi.setSystemTime(start + 20 * HOUR);
    const res = store().stopParallelTimer('a');
    expect(res!.stopped.taskId).toBe('a');
    expect(total(res!.shares, 'a')).toBe(SIX_HOURS_SEC);
  });

  it('expires parallel timers one at a time, keeping the split fair', () => {
    store().startParallelTimer('a', 'A', 'list', 0);
    vi.setSystemTime(start + 2 * HOUR);
    store().startParallelTimer('b', 'B', 'list', 0);
    vi.setSystemTime(start + 7 * HOUR);
    const { expired, shares } = store().expireLongRunningTimers();
    expect(expired.map((t) => t.taskId)).toEqual(['a']);
    // a: stopped at hour 6, sharing hours 2-6 with b.
    expect(total(shares, 'a')).toBe(2 * HOUR / 1000);
    expect(store().timers.map((t) => t.taskId)).toEqual(['b']);
    expect(store().timerSegmentStart).toBe(start + 6 * HOUR);
  });

  it('counts time already run before a pause toward the limit', () => {
    store().startParallelTimer('a', 'A', 'list', 0);
    usePMStore.setState({ timers: [{ ...store().timers[0], elapsedBefore: 5 * 3600 }] });
    vi.setSystemTime(start + 2 * HOUR);
    const { expired, shares } = store().expireLongRunningTimers();
    expect(expired).toHaveLength(1);
    expect(total(shares, 'a')).toBe(3600);
  });

  it('settles an expired timer before a new one starts', () => {
    store().startParallelTimer('a', 'A', 'list', 0);
    vi.setSystemTime(start + 30 * HOUR);
    const res = store().startParallelTimer('b', 'B', 'list', 0);
    expect(total(res!.shares, 'a')).toBe(SIX_HOURS_SEC);
    expect(store().timers.map((t) => t.taskId)).toEqual(['b']);
  });
});
