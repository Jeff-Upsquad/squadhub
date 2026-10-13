import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@squadhub/shared';
import { buildInProgressTasks } from '../lib/inProgressTasks';

const task = (overrides: Partial<Task> = {}) => ({
  id: 'worked', title: 'Group meet feature', status: 'in_progress',
  time_tracked: 1620, work_date: '2026-10-13T00:00:00Z',
  ...overrides,
} as Task);

afterEach(() => vi.useRealTimers());

describe('persistent In progress', () => {
  it('keeps an unstarred unfinished task across midnight and later days', () => {
    vi.useFakeTimers();
    const worked = task({ focused_at: null });
    for (const date of ['2026-10-13T18:29:59Z', '2026-10-13T18:30:00Z', '2026-10-20T00:00:00Z']) {
      vi.setSystemTime(new Date(date));
      expect(buildInProgressTasks([worked], [worked], [])).toEqual([worked]);
    }
  });

  it('keeps worked tasks even when their work date is moved into the future', () => {
    const worked = task({ work_date: '2099-10-14T00:00:00Z' });
    expect(buildInProgressTasks([worked], [worked], [])).toEqual([worked]);
  });

  it.each(['done', 'closed', 'cancelled'])('removes %s tasks even with a running timer', (status) => {
    const completed = task({ status: status as unknown as Task['status'] });
    expect(buildInProgressTasks([completed], [completed], [completed.id])).toEqual([]);
  });

  it('includes a new running task before time is saved without duplicating worked tasks', () => {
    const worked = task();
    const running = task({ id: 'running', time_tracked: 0 });
    const untouched = task({ id: 'untouched', time_tracked: 0 });
    expect(buildInProgressTasks([worked], [worked, running, untouched], ['running', 'running', 'worked']))
      .toEqual([running, worked]);
  });
});
