import { describe, expect, it } from 'vitest';
import type { Task } from '@squadhub/shared';
import { runBulkTasks, toggleGroupSelection, type BulkTaskFailure } from '../lib/bulkTasks';
import { useBulkTaskStore } from '../stores/bulkTaskStore';

describe('group selection', () => {
  it('adds the group without losing other selections or duplicating tasks', () => {
    expect(toggleGroupSelection(['other', 'one'], ['one', 'two', 'two'])).toEqual(['other', 'one', 'two']);
  });
  it('deselects only a fully selected group', () => {
    expect(toggleGroupSelection(['other', 'one', 'two'], ['one', 'two'])).toEqual(['other']);
    expect(toggleGroupSelection(['other'], [])).toEqual(['other']);
  });
});

describe('bulk task writes', () => {
  it('continues after failures, preserves server errors, and reports real-time progress', async () => {
    const tasks = ['one', 'two', 'three'].map((id) => ({ id, title: id }) as Task);
    const finished: string[] = [];
    const progress: { completed: number; total: number; failure?: BulkTaskFailure }[] = [];
    let active = 0;

    const failed = await runBulkTasks(
      tasks,
      async (task) => {
        expect(++active).toBe(1);
        await Promise.resolve();
        active--;
        if (task.id === 'two') throw { response: { data: { error: 'Finish subtasks first' } } };
        finished.push(task.id);
      },
      {
        onProgress: (completed, total, failure) => {
          progress.push({ completed, total, failure });
        },
      }
    );

    expect(finished).toEqual(['one', 'three']);
    expect(failed).toEqual([{ id: 'two', title: 'two', message: 'Finish subtasks first' }]);
    expect(progress).toHaveLength(3);
    expect(progress[0]).toEqual({ completed: 1, total: 3, failure: undefined });
    expect(progress[1]).toEqual({
      completed: 2,
      total: 3,
      failure: { id: 'two', title: 'two', message: 'Finish subtasks first' },
    });
    expect(progress[2]).toEqual({ completed: 3, total: 3, failure: undefined });
  });

  it('stops processing when abort signal is triggered', async () => {
    const tasks = ['one', 'two', 'three', 'four'].map((id) => ({ id, title: id }) as Task);
    const processed: string[] = [];
    const controller = new AbortController();

    await runBulkTasks(
      tasks,
      async (task) => {
        processed.push(task.id);
        if (task.id === 'two') {
          controller.abort();
        }
      },
      { signal: controller.signal }
    );

    expect(processed).toEqual(['one', 'two']);
  });
});

describe('useBulkTaskStore', () => {
  it('supports multiple concurrent jobs with independent progress tracking and error retention', async () => {
    const store = useBulkTaskStore.getState();
    const tasksA = [{ id: 'a1', title: 'Task A1' }, { id: 'a2', title: 'Task A2' }] as Task[];
    const tasksB = [{ id: 'b1', title: 'Task B1' }, { id: 'b2', title: 'Task B2' }] as Task[];

    const jobAId = store.startJob({
      title: 'Job A: Priority Urgent',
      tasks: tasksA,
      action: async (t) => {
        if (t.id === 'a2') throw new Error('Network error');
      },
    });

    const jobBId = store.startJob({
      title: 'Job B: Mark Complete',
      tasks: tasksB,
      action: async () => {},
    });

    // Both jobs should exist in the store
    expect(useBulkTaskStore.getState().jobs.map((j) => j.id)).toContain(jobAId);
    expect(useBulkTaskStore.getState().jobs.map((j) => j.id)).toContain(jobBId);

    // Wait for jobs to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    const finalA = useBulkTaskStore.getState().jobs.find((j) => j.id === jobAId);
    const finalB = useBulkTaskStore.getState().jobs.find((j) => j.id === jobBId);

    expect(finalA?.status).toBe('completed');
    expect(finalA?.completed).toBe(2);
    expect(finalA?.failures).toHaveLength(1);
    expect(finalA?.failures[0].id).toBe('a2');
    expect(finalA?.expandedErrors).toBe(true);

    expect(finalB?.status).toBe('completed');
    expect(finalB?.completed).toBe(2);
    expect(finalB?.failures).toHaveLength(0);

    // Toggle error details
    store.toggleErrors(jobAId);
    expect(useBulkTaskStore.getState().jobs.find((j) => j.id === jobAId)?.expandedErrors).toBe(false);

    // Retry job A should dismiss the old one and spawn a retry job with the failed task
    store.retryJob(jobAId);
    expect(useBulkTaskStore.getState().jobs.find((j) => j.id === jobAId)).toBeUndefined();
    const retryJob = useBulkTaskStore.getState().jobs.find((j) => j.title.startsWith('Retry: Job A'));
    expect(retryJob).toBeDefined();
    expect(retryJob?.total).toBe(1);
    expect(retryJob?.tasks[0].id).toBe('a2');
  });
});
