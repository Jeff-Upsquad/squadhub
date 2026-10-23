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
  it('remembers removals after midnight and allows explicit Focus placement again', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 18, 23, 59));
    usePMStore.getState().reset();
    usePMStore.getState().dismissInProgressTask('removed');
    for (const day of [19, 20]) {
      vi.setSystemTime(new Date(2026, 9, day, 0, 1));
      usePMStore.getState().rolloverDismissedInProgress();
      expect(usePMStore.getState().removedFromFocusIds).toEqual(['removed']);
      expect(usePMStore.getState().dismissedInProgressIds).toEqual([]);
    }
    usePMStore.getState().setFocusBucket('removed', 'focus');
    expect(usePMStore.getState().removedFromFocusIds).toEqual([]);
  });

  it('preserves removals saved by the previous version when the day changes', () => {
    usePMStore.getState()._hydrateFromServer({
      removedFromFocusIds: [], dismissedInProgressIds: ['legacy'], dismissedInProgressDate: '2020-01-01',
    });
    usePMStore.getState().rolloverDismissedInProgress();
    expect(usePMStore.getState().removedFromFocusIds).toEqual(['legacy']);
  });

  it('restores removal history from saved preferences', () => {
    usePMStore.getState()._hydrateFromServer({ removedFromFocusIds: ['saved'] });
    expect(usePMStore.getState().removedFromFocusIds).toEqual(['saved']);
  });

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

  it('returns Evening/Night tasks to Focus at midnight and keeps recurring preferences', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 18, 23, 59));
    usePMStore.getState().reset();
    usePMStore.getState().setFocusBucket('evening-task', 'evening');
    usePMStore.getState().setFocusBucket('night-task', 'night', 'routine');

    // Same-day checks must leave the chosen sections alone.
    usePMStore.getState().rolloverFocusBuckets();
    expect(usePMStore.getState().focusBuckets).toEqual({
      'evening-task': 'evening', 'night-task': 'night',
    });

    for (const day of [19, 20]) {
      vi.setSystemTime(new Date(2026, 9, day, 0, 1));
      usePMStore.getState().rolloverFocusBuckets();
      const state = usePMStore.getState();
      expect(state.focusBuckets).toEqual({ 'evening-task': 'focus', 'night-task': 'focus' });
      // Worked tasks must resolve to Focus instead of falling back to In progress.
      for (const id of ['evening-task', 'night-task']) {
        expect(effectiveFocusBucket({ id }, state.focusBuckets, state.recurringFocusBuckets, true)).toBe('focus');
      }
      expect(effectiveFocusBucket(
        { id: 'night-task', recurring_parent_id: 'routine' }, state.focusBuckets, state.recurringFocusBuckets,
      )).toBe('focus');
    }
    expect(usePMStore.getState().recurringFocusBuckets).toEqual({ routine: 'night' });
  });
});
