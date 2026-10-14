import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@squadhub/shared';
import { buildFocusTasks, buildInProgressTasks, type WorkedTaskContext } from '../lib/inProgressTasks';

const task = (overrides: Partial<Task> = {}) => ({
  id: 'worked', title: 'Group meet feature', status: 'in_progress',
  time_tracked: 1620, work_date: '2026-10-13T00:00:00Z',
  ...overrides,
} as Task);

afterEach(() => vi.useRealTimers());

const context = (today: string, workedAt = '2026-10-13T01:00:00Z', timeZone = 'Asia/Kolkata'): WorkedTaskContext => ({
  today, timeZone, workedAtByTask: { worked: workedAt },
});

describe('persistent In progress', () => {
  it('keeps an unstarred unfinished task across midnight and later days', () => {
    vi.useFakeTimers();
    const worked = task({ focused_at: null });
    for (const date of ['2026-10-13T18:29:59Z', '2026-10-13T18:30:00Z', '2026-10-20T00:00:00Z']) {
      vi.setSystemTime(new Date(date));
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(date));
      expect(buildInProgressTasks([worked], [worked], [], context(today))).toEqual([worked]);
    }
  });

  it('keeps work logged today even when its work date is in the future', () => {
    const worked = task({ work_date: '2026-10-19T00:00:00Z', time_tracked: 2 });
    expect(buildInProgressTasks([worked], [worked], [], context('2026-10-14', '2026-10-14T01:00:00Z')))
      .toEqual([worked]);
  });

  it('hides older work rescheduled into the future, then returns it to Focus on that date', () => {
    vi.useFakeTimers();
    const worked = task({ work_date: '2026-10-19T00:00:00Z', focused_at: null });
    vi.setSystemTime(new Date('2026-10-14T01:00:00Z'));
    expect(buildInProgressTasks([worked], [worked], [], context('2026-10-14'))).toEqual([]);
    expect(buildFocusTasks([worked], context('2026-10-14'))).toEqual([]);

    vi.setSystemTime(new Date('2026-10-19T01:00:00Z'));
    expect(buildInProgressTasks([worked], [worked], [], context('2026-10-19'))).toEqual([]);
    expect(buildFocusTasks([worked, worked], context('2026-10-19'))).toEqual([worked]);

    vi.setSystemTime(new Date('2026-10-20T01:00:00Z'));
    expect(buildFocusTasks([worked], context('2026-10-20'))).toEqual([worked]);
  });

  it('moves the rescheduled task back to In progress when work resumes', () => {
    const worked = task({ work_date: '2026-10-19T00:00:00Z', focused_at: null });
    const resumed = context('2026-10-19', '2026-10-19T01:00:00Z');
    expect(buildInProgressTasks([worked], [worked], [], resumed)).toEqual([worked]);
    expect(buildFocusTasks([worked], resumed)).toEqual([]);
  });

  it('allows removing a returned task from Focus for the day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T01:00:00Z'));
    const worked = task({ work_date: '2026-10-19T00:00:00Z', focused_at: null });
    expect(buildFocusTasks([worked], context('2026-10-19'), [worked.id])).toEqual([]);
    expect(buildFocusTasks([worked], context('2026-10-19'), [])).toEqual([worked]);
  });

  it('always includes a running timer on a deferred task', () => {
    const worked = task({ work_date: '2026-10-19T00:00:00Z' });
    expect(buildInProgressTasks([worked], [worked], [worked.id], context('2026-10-14'))).toEqual([worked]);
  });

  it('uses the user timezone at midnight for both logged work and the work date', () => {
    const worked = task({ work_date: '2026-10-18T18:30:00Z', focused_at: null });
    const india = context('2026-10-14', '2026-10-13T18:30:00Z');
    expect(buildInProgressTasks([worked], [worked], [], india)).toEqual([worked]);
    const utc = context('2026-10-14', '2026-10-13T18:30:00Z', 'UTC');
    expect(buildInProgressTasks([worked], [worked], [], utc)).toEqual([]);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T18:30:00Z'));
    expect(buildFocusTasks([worked], context('2026-10-19'))).toEqual([worked]);
    vi.setSystemTime(new Date('2026-10-18T18:29:59Z'));
    expect(buildFocusTasks([worked], context('2026-10-18'))).toEqual([]);
  });

  it('hides future work again after today rolls over without losing the saved history', () => {
    const worked = task({ work_date: '2026-10-19T00:00:00Z' });
    expect(buildInProgressTasks([worked], [worked], [], context('2026-10-14', '2026-10-14T01:00:00Z')))
      .toEqual([worked]);
    expect(buildInProgressTasks([worked], [worked], [], context('2026-10-15', '2026-10-14T01:00:00Z')))
      .toEqual([]);
  });

  it('keeps unrescheduled work with no work date', () => {
    const worked = task({ work_date: null });
    expect(buildInProgressTasks([worked], [worked], [], context('2026-10-14'))).toEqual([worked]);
  });

  it.each(['done', 'closed', 'cancelled'])('removes %s tasks even with a running timer', (status) => {
    const completed = task({ status: status as unknown as Task['status'] });
    expect(buildInProgressTasks([completed], [completed], [completed.id], context('2026-10-14'))).toEqual([]);
    expect(buildFocusTasks([completed], context('2026-10-14'))).toEqual([]);
  });

  it('includes a new running task before time is saved without duplicating worked tasks', () => {
    const worked = task();
    const running = task({ id: 'running', time_tracked: 0 });
    const untouched = task({ id: 'untouched', time_tracked: 0 });
    expect(buildInProgressTasks([worked], [worked, running, untouched], ['running', 'running', 'worked'], context('2026-10-14')))
      .toEqual([running, worked]);
  });
});
