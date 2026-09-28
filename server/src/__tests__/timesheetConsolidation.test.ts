import { describe, it, expect } from 'vitest';
import { consolidateContiguousEntries } from '../utils/taskTime';

describe('consolidateContiguousEntries', () => {
  it('returns empty array when given empty array', () => {
    expect(consolidateContiguousEntries([])).toEqual([]);
  });

  it('returns single entry unchanged', () => {
    const single = [
      {
        id: '1',
        task_id: 'task-1',
        started_at: '2026-09-28T08:00:00.000Z',
        stopped_at: '2026-09-28T08:02:00.000Z',
        duration_seconds: 120,
        source: 'timer',
      },
    ];
    expect(consolidateContiguousEntries(single)).toEqual(single);
  });

  it('merges contiguous 2-minute checkpoint fragments for the same task and user', () => {
    const fragments = [
      {
        id: 'frag-3',
        task_id: 'task-1',
        user_id: 'user-1',
        started_at: '2026-09-28T08:04:00.000Z',
        stopped_at: '2026-09-28T08:06:00.000Z',
        duration_seconds: 120,
        source: 'timer',
      },
      {
        id: 'frag-2',
        task_id: 'task-1',
        user_id: 'user-1',
        started_at: '2026-09-28T08:02:00.000Z',
        stopped_at: '2026-09-28T08:04:00.000Z',
        duration_seconds: 120,
        source: 'timer',
      },
      {
        id: 'frag-1',
        task_id: 'task-1',
        user_id: 'user-1',
        started_at: '2026-09-28T08:00:00.000Z',
        stopped_at: '2026-09-28T08:02:00.000Z',
        duration_seconds: 120,
        source: 'timer',
      },
    ];

    const result = consolidateContiguousEntries(fragments);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      task_id: 'task-1',
      user_id: 'user-1',
      started_at: '2026-09-28T08:00:00.000Z',
      stopped_at: '2026-09-28T08:06:00.000Z',
      duration_seconds: 360,
      source: 'timer',
    });
  });

  it('does NOT merge entries for different tasks', () => {
    const entries = [
      {
        id: '2',
        task_id: 'task-b',
        user_id: 'user-1',
        started_at: '2026-09-28T08:02:00.000Z',
        stopped_at: '2026-09-28T08:04:00.000Z',
        duration_seconds: 120,
        source: 'timer',
      },
      {
        id: '1',
        task_id: 'task-a',
        user_id: 'user-1',
        started_at: '2026-09-28T08:00:00.000Z',
        stopped_at: '2026-09-28T08:02:00.000Z',
        duration_seconds: 120,
        source: 'timer',
      },
    ];

    const result = consolidateContiguousEntries(entries);
    expect(result).toHaveLength(2);
  });

  it('does NOT merge entries with significant gap (e.g. 10 minutes apart)', () => {
    const entries = [
      {
        id: '2',
        task_id: 'task-1',
        user_id: 'user-1',
        started_at: '2026-09-28T08:15:00.000Z',
        stopped_at: '2026-09-28T08:25:00.000Z',
        duration_seconds: 600,
        source: 'timer',
      },
      {
        id: '1',
        task_id: 'task-1',
        user_id: 'user-1',
        started_at: '2026-09-28T08:00:00.000Z',
        stopped_at: '2026-09-28T08:05:00.000Z',
        duration_seconds: 300,
        source: 'timer',
      },
    ];

    const result = consolidateContiguousEntries(entries);
    expect(result).toHaveLength(2);
  });

  it('combines work-block children correctly', () => {
    const entries = [
      {
        id: 'wb-2',
        task_id: 'wb-task',
        user_id: 'user-1',
        started_at: '2026-09-28T08:02:00.000Z',
        stopped_at: '2026-09-28T08:04:00.000Z',
        duration_seconds: 120,
        source: 'work_block',
        work_block_run_id: 'run-1',
        children: [
          { task_id: 'sub-1', title: 'Sub 1', seconds: 60, completed: true },
          { task_id: 'sub-2', title: 'Sub 2', seconds: 60, completed: false },
        ],
      },
      {
        id: 'wb-1',
        task_id: 'wb-task',
        user_id: 'user-1',
        started_at: '2026-09-28T08:00:00.000Z',
        stopped_at: '2026-09-28T08:02:00.000Z',
        duration_seconds: 120,
        source: 'work_block',
        work_block_run_id: 'run-1',
        children: [
          { task_id: 'sub-1', title: 'Sub 1', seconds: 120, completed: false },
        ],
      },
    ];

    const result = consolidateContiguousEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0].duration_seconds).toBe(240);
    expect(result[0].children).toEqual([
      { task_id: 'sub-1', title: 'Sub 1', seconds: 180, completed: true },
      { task_id: 'sub-2', title: 'Sub 2', seconds: 60, completed: false },
    ]);
  });

  it('de-duplicates and collapses overlapping entries created by retry / unload races', () => {
    const entries = [
      {
        id: 'dup-1',
        task_id: 'task-1',
        user_id: 'user-1',
        started_at: '2026-09-28T08:00:00.000Z',
        stopped_at: '2026-09-28T08:02:00.000Z',
        duration_seconds: 120,
        source: 'timer',
      },
      {
        id: 'dup-2',
        task_id: 'task-1',
        user_id: 'user-1',
        started_at: '2026-09-28T08:00:00.000Z',
        stopped_at: '2026-09-28T08:02:00.000Z',
        duration_seconds: 120,
        source: 'timer',
      },
      {
        id: 'next-1',
        task_id: 'task-1',
        user_id: 'user-1',
        started_at: '2026-09-28T08:02:00.000Z',
        stopped_at: '2026-09-28T08:04:00.000Z',
        duration_seconds: 120,
        source: 'timer',
      },
    ];

    const result = consolidateContiguousEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0].duration_seconds).toBe(240);
    expect(result[0].started_at).toBe('2026-09-28T08:00:00.000Z');
    expect(result[0].stopped_at).toBe('2026-09-28T08:04:00.000Z');
  });
});

