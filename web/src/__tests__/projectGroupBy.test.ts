import { describe, expect, it } from 'vitest';
import type { Task } from '@squadhub/shared';
import {
  GROUP_BY_OPTIONS,
  LIST_GROUP_BY_OPTIONS,
  EMPTY_FADING_MAP,
  groupTasks,
} from '../lib/taskGrouping';

describe('task grouping by project', () => {
  it('includes project in GROUP_BY_OPTIONS and LIST_GROUP_BY_OPTIONS', () => {
    expect(GROUP_BY_OPTIONS.some((o) => o.value === 'project' && o.label === 'Project')).toBe(true);
    expect(LIST_GROUP_BY_OPTIONS.some((o) => o.value === 'project' && o.label === 'Project')).toBe(true);
  });

  it('groups tasks by their hydrated project ref, unassigned under No project', () => {
    const tasks: Task[] = [
      { id: '1', title: 'Task 1', list_id: 'l1', project: { id: 'p1', name: 'Website' } } as any,
      { id: '2', title: 'Task 2', list_id: 'l1', project: null } as any,
      { id: '3', title: 'Task 3', list_id: 'l1', project: { id: 'p2', name: 'Mobile app' } } as any,
      { id: '4', title: 'Task 4', list_id: 'l1', project: { id: 'p1', name: 'Website' } } as any,
      { id: '5', title: 'Task 5', list_id: 'l1' } as any,
    ];

    const groups = groupTasks(tasks, 'project', 'UTC', EMPTY_FADING_MAP);
    // Named-ref groups sort alphabetically; the empty bucket always sorts last.
    expect(groups.map((g) => g.label)).toEqual(['Mobile app', 'Website', 'No project']);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['3']);
    expect(groups[1].tasks.map((t) => t.id)).toEqual(['1', '4']);
    // A null ref and a missing project field both land in the same bucket.
    expect(groups[2].tasks.map((t) => t.id)).toEqual(['2', '5']);
  });
});
