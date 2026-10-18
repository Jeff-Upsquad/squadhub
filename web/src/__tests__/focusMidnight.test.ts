import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectiveFocusBucket, todayKey, usePMStore } from '../stores/pmStore';

beforeEach(() => {
  usePMStore.persist.setOptions({
    storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
});

afterEach(() => {
  usePMStore.getState().reset();
  vi.useRealTimers();
});

describe('Focus placement across midnight', () => {
  it('keeps a worked task in Focus across successive day changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 18, 23, 59));
    usePMStore.getState().reset();
    usePMStore.getState().setFocusBucket('worked-task', 'focus');

    for (const day of [19, 20]) {
      vi.setSystemTime(new Date(2026, 9, day, 0, 1));
      usePMStore.getState().rolloverFocusBuckets();
      const state = usePMStore.getState();
      expect(effectiveFocusBucket({ id: 'worked-task' }, state.focusBuckets, state.recurringFocusBuckets, true))
        .toBe('focus');
      expect(state.focusBucketsRolloverDate).toBe(todayKey());
    }

    usePMStore.getState().setFocusBucket('worked-task', null);
    const state = usePMStore.getState();
    expect(effectiveFocusBucket({ id: 'worked-task' }, state.focusBuckets, state.recurringFocusBuckets, true))
      .toBeUndefined();
  });

  it('still resets Evening/Night placements and keeps recurring preferences', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 18, 23, 59));
    usePMStore.getState().reset();
    usePMStore.getState().setFocusBucket('evening-task', 'evening');
    usePMStore.getState().setFocusBucket('night-task', 'night', 'routine');

    vi.setSystemTime(new Date(2026, 9, 19, 0, 1));
    usePMStore.getState().rolloverFocusBuckets();
    expect(usePMStore.getState().focusBuckets).toEqual({});
    expect(usePMStore.getState().recurringFocusBuckets).toEqual({ routine: 'night' });
  });
});
