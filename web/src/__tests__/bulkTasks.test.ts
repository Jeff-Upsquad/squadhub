import { describe, expect, it } from 'vitest';
import type { Task } from '@squadhub/shared';
import { runBulkTasks, toggleGroupSelection } from '../lib/bulkTasks';

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
  it('continues after failures, preserves server errors, and avoids overlapping writes', async () => {
    const tasks = ['one', 'two', 'three'].map((id) => ({ id, title: id }) as Task);
    const finished: string[] = [];
    let active = 0;
    const failed = await runBulkTasks(tasks, async (task) => {
      expect(++active).toBe(1);
      await Promise.resolve();
      active--;
      if (task.id === 'two') throw { response: { data: { error: 'Finish subtasks first' } } };
      finished.push(task.id);
    });
    expect(finished).toEqual(['one', 'three']);
    expect(failed).toEqual([{id:'two',title:'two',message:'Finish subtasks first'}]);
  });
});
