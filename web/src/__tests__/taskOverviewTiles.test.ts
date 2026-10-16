import { describe, expect, it } from 'vitest';
import type { Task } from '@squadhub/shared';
import {
  matchesOverviewTile,
  overviewDay,
  taskOverviewSummary,
  OVERVIEW_TILES,
  type OverviewTile,
} from '../lib/taskOverviewTiles';

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
    created_at: '2026-10-17T00:00:00.000Z',
    updated_at: '2026-10-17T00:00:00.000Z',
    list_id: 'l-1',
    user_id: 'u-1',
    ...partial,
  } as unknown as Task;
}

describe('taskOverviewTiles', () => {
  const tz = 'Asia/Kolkata';
  const now = new Date('2026-10-17T10:00:00.000Z'); // 2026-10-17 in Asia/Kolkata

  it('exposes the 6 design shortcut tiles', () => {
    expect(OVERVIEW_TILES.map((t) => t.key)).toEqual([
      'all',
      'urgent',
      'today',
      'due',
      'tomorrow',
      'attention',
    ]);
  });

  describe('overviewDay', () => {
    it('returns null for empty or invalid dates', () => {
      expect(overviewDay(null, tz)).toBeNull();
      expect(overviewDay(undefined, tz)).toBeNull();
      expect(overviewDay('invalid-date', tz)).toBeNull();
    });

    it('returns calendar-only dates as-is', () => {
      expect(overviewDay('2026-10-17', tz)).toBe('2026-10-17');
    });

    it('converts ISO dates using the provided timezone', () => {
      // 2026-10-17T02:00:00Z in America/New_York is 2026-10-16
      expect(overviewDay('2026-10-17T02:00:00.000Z', 'America/New_York')).toBe('2026-10-16');
      // In Asia/Kolkata (+5:30) it is 2026-10-17
      expect(overviewDay('2026-10-17T02:00:00.000Z', 'Asia/Kolkata')).toBe('2026-10-17');
    });
  });

  describe('matchesOverviewTile', () => {
    it('matches all tasks under "all", including completed', () => {
      const open = makeTask({});
      const done = makeTask({ is_completed: true, status: 'closed' });
      expect(matchesOverviewTile(open, 'all', tz, now)).toBe(true);
      expect(matchesOverviewTile(done, 'all', tz, now)).toBe(true);
    });

    it('never matches completed tasks for filtered shortcut tiles', () => {
      const doneUrgent = makeTask({ status: 'closed', priority: 'urgent' });
      const doneToday = makeTask({ status: 'closed', work_date: '2026-10-17' });
      const doneAttention = makeTask({ status: 'closed', priority: 'normal' });

      const filteredKeys: OverviewTile[] = ['urgent', 'today', 'due', 'tomorrow', 'attention'];
      for (const key of filteredKeys) {
        expect(matchesOverviewTile(doneUrgent, key, tz, now)).toBe(false);
        expect(matchesOverviewTile(doneToday, key, tz, now)).toBe(false);
        expect(matchesOverviewTile(doneAttention, key, tz, now)).toBe(false);
      }
    });

    it('matches urgent and emergency tasks under "urgent"', () => {
      expect(matchesOverviewTile(makeTask({ priority: 'urgent' }), 'urgent', tz, now)).toBe(true);
      expect(matchesOverviewTile(makeTask({ priority: 'emergency' }), 'urgent', tz, now)).toBe(true);
      expect(matchesOverviewTile(makeTask({ priority: 'high' }), 'urgent', tz, now)).toBe(false);
      expect(matchesOverviewTile(makeTask({ priority: 'normal' }), 'urgent', tz, now)).toBe(false);
    });

    it('matches today or overdue work_date under "today"', () => {
      const today = overviewDay(now.toISOString(), tz)!; // 2026-10-17
      expect(matchesOverviewTile(makeTask({ work_date: today }), 'today', tz, now)).toBe(true);
      expect(matchesOverviewTile(makeTask({ work_date: '2026-10-15' }), 'today', tz, now)).toBe(true);
      expect(matchesOverviewTile(makeTask({ work_date: '2026-10-18' }), 'today', tz, now)).toBe(false);
      expect(matchesOverviewTile(makeTask({ work_date: null }), 'today', tz, now)).toBe(false);
    });

    it('matches today or overdue due_date under "due"', () => {
      const today = overviewDay(now.toISOString(), tz)!; // 2026-10-17
      expect(matchesOverviewTile(makeTask({ due_date: today }), 'due', tz, now)).toBe(true);
      expect(matchesOverviewTile(makeTask({ due_date: '2026-10-14' }), 'due', tz, now)).toBe(true);
      expect(matchesOverviewTile(makeTask({ due_date: '2026-10-19' }), 'due', tz, now)).toBe(false);
      expect(matchesOverviewTile(makeTask({ due_date: null }), 'due', tz, now)).toBe(false);
    });

    it('matches tomorrow work_date, due_date, or start_date under "tomorrow"', () => {
      expect(matchesOverviewTile(makeTask({ work_date: '2026-10-18' }), 'tomorrow', tz, now)).toBe(true);
      expect(matchesOverviewTile(makeTask({ due_date: '2026-10-18' }), 'tomorrow', tz, now)).toBe(true);
      expect(matchesOverviewTile(makeTask({ start_date: '2026-10-18' }), 'tomorrow', tz, now)).toBe(true);
      expect(matchesOverviewTile(makeTask({ work_date: '2026-10-17' }), 'tomorrow', tz, now)).toBe(false);
    });

    it('matches help or unblocked statuses under "attention"', () => {
      expect(matchesOverviewTile(makeTask({ status: 'help' }), 'attention', tz, now)).toBe(true);
      expect(matchesOverviewTile(makeTask({ status: 'unblocked' }), 'attention', tz, now)).toBe(true);
      expect(matchesOverviewTile(makeTask({ status: 'open' }), 'attention', tz, now)).toBe(false);
      expect(matchesOverviewTile(makeTask({ status: 'front_burner' }), 'attention', tz, now)).toBe(false);
    });
  });

  describe('taskOverviewSummary', () => {
    it('summarizes task count and scope correctly', () => {
      const tasks = [
        makeTask({ id: '1', title: 'Task 1' }),
        makeTask({ id: '2', title: 'Task 2', status: 'closed' }),
      ];
      expect(taskOverviewSummary(tasks, tz, 'Design space', now)).toBe(
        'You have 1 open task across Design space.',
      );
    });

    it('mentions urgent count and overdue lead task', () => {
      const tasks = [
        makeTask({ id: '1', title: 'Urgent Bug', priority: 'urgent', due_date: '2026-10-16' }),
        makeTask({ id: '2', title: 'Feature B', priority: 'normal', due_date: '2026-10-17' }),
      ];
      const summary = taskOverviewSummary(tasks, tz, undefined, now);
      expect(summary).toBe(
        'You have 2 open tasks, 1 marked urgent. Urgent Bug is overdue.',
      );
    });

    it('mentions task due today when no overdue task exists', () => {
      const tasks = [
        makeTask({ id: '1', title: 'Ship PR', due_date: '2026-10-17' }),
      ];
      const summary = taskOverviewSummary(tasks, tz, undefined, now);
      expect(summary).toBe(
        'You have 1 open task. Ship PR is due today.',
      );
    });
  });
});
