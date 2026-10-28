import { describe, expect, it } from 'vitest';
import type { Task } from '@squadhub/shared';
import { EMPTY_FADING_MAP, groupTasks } from '../lib/taskGrouping';

describe('task grouping by folder', () => {
  it('groups folder-less tasks by their list instead of one No folder bucket', () => {
    const tasks: Task[] = [
      { id: '1', title: 'Folder task', list_id: 'l1', folder: { id: 'f1', name: 'Dev' }, list: { id: 'l1', name: 'Dev list' } } as any,
      { id: '2', title: 'Direct A', list_id: 'l2', list: { id: 'l2', name: 'Direct A' } } as any,
      { id: '3', title: 'Direct A 2', list_id: 'l2', list: { id: 'l2', name: 'Direct A' } } as any,
      { id: '4', title: 'Direct B', list_id: 'l3', list: { id: 'l3', name: 'Direct B' } } as any,
    ];

    const groups = groupTasks(tasks, 'folder', 'UTC', EMPTY_FADING_MAP);
    // Folder groups first, then folder-less list groups (each alphabetical).
    expect(groups.map((g) => g.label)).toEqual(['Dev', 'Direct A', 'Direct B']);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['1']);
    expect(groups[1].tasks.map((t) => t.id)).toEqual(['2', '3']);
    expect(groups[2].tasks.map((t) => t.id)).toEqual(['4']);
  });

  it('keeps folder and list groups distinct even when names collide', () => {
    const tasks: Task[] = [
      { id: '1', title: 'In folder', list_id: 'l1', folder: { id: 'f1', name: 'Growth' }, list: { id: 'l1', name: 'Inside' } } as any,
      { id: '2', title: 'Direct list', list_id: 'l2', list: { id: 'l2', name: 'Growth' } } as any,
    ];

    const groups = groupTasks(tasks, 'folder', 'UTC', EMPTY_FADING_MAP);
    expect(groups.map((g) => g.key)).toEqual(['f1', 'l2']);
    expect(groups.map((g) => g.label)).toEqual(['Growth', 'Growth']);
  });

  it('collects tasks with no folder and no list under No list, sorted last', () => {
    const tasks: Task[] = [
      { id: '1', title: 'No refs', list_id: 'l1' } as any,
      { id: '2', title: 'Folder task', list_id: 'l2', folder: { id: 'f1', name: 'Dev' }, list: { id: 'l2', name: 'Dev list' } } as any,
      { id: '3', title: 'Null refs', list_id: 'l1', folder: null, list: null } as any,
    ];

    const groups = groupTasks(tasks, 'folder', 'UTC', EMPTY_FADING_MAP);
    expect(groups.map((g) => g.label)).toEqual(['Dev', 'No list']);
    expect(groups[1].tasks.map((t) => t.id)).toEqual(['1', '3']);
  });
});
