import { describe, expect, it } from 'vitest';
import type { Task, TaskType } from '@squadhub/shared';
import {
  GROUP_BY_OPTIONS,
  LIST_GROUP_BY_OPTIONS,
  EMPTY_FADING_MAP,
  groupByTaskType,
  groupTasks,
} from '../lib/taskGrouping';

describe('task grouping by task type', () => {
  const sampleTypes: TaskType[] = [
    {
      id: 'type-task',
      key: 'task',
      name: 'Tasks',
      description: null,
      icon: 'check-square',
      color: '#3b82f6',
      position: 10,
      is_default: true,
      is_system: true,
      is_enabled: true,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    },
    {
      id: 'type-wb',
      key: 'work_block',
      name: 'Work Block',
      description: null,
      icon: 'box',
      color: '#8b5cf6',
      position: 12,
      is_default: false,
      is_system: false,
      is_enabled: true,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    },
    {
      id: 'type-routine',
      key: 'routine',
      name: 'Routines',
      description: null,
      icon: 'repeat',
      color: '#10b981',
      position: 15,
      is_default: false,
      is_system: false,
      is_enabled: true,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    },
  ];

  it('includes task_type in GROUP_BY_OPTIONS and LIST_GROUP_BY_OPTIONS', () => {
    expect(GROUP_BY_OPTIONS.some((o) => o.value === 'task_type' && o.label === 'Task type')).toBe(true);
    expect(LIST_GROUP_BY_OPTIONS.some((o) => o.value === 'task_type' && o.label === 'Task type')).toBe(true);
  });

  it('groups tasks by task_type_id using provided taskTypes catalog sorted by position', () => {
    const tasks: Task[] = [
      { id: '1', title: 'Task 1', task_type_id: 'type-wb', list_id: 'l1' } as any,
      { id: '2', title: 'Task 2', task_type_id: 'type-task', list_id: 'l1' } as any,
      { id: '3', title: 'Task 3', task_type_id: 'type-routine', list_id: 'l1' } as any,
      { id: '4', title: 'Task 4', task_type_id: 'type-task', list_id: 'l1' } as any,
    ];

    const groups = groupByTaskType(tasks, sampleTypes);
    expect(groups.map((g) => g.label)).toEqual(['Tasks', 'Work Block', 'Routines']);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['2', '4']);
    expect(groups[0].color).toBe('#3b82f6');
    expect(groups[1].tasks.map((t) => t.id)).toEqual(['1']);
    expect(groups[1].color).toBe('#8b5cf6');
    expect(groups[2].tasks.map((t) => t.id)).toEqual(['3']);
    expect(groups[2].color).toBe('#10b981');
  });

  it('groups tasks with joined task_type object when no catalog provided', () => {
    const tasks: Task[] = [
      { id: '1', title: 'Task 1', list_id: 'l1', task_type: sampleTypes[1] } as any,
      { id: '2', title: 'Task 2', list_id: 'l1', task_type: sampleTypes[0] } as any,
    ];

    const groups = groupByTaskType(tasks);
    expect(groups.map((g) => g.label)).toEqual(['Tasks', 'Work Block']);
    expect(groups[0].tasks[0].id).toBe('2');
    expect(groups[1].tasks[0].id).toBe('1');
  });

  it('collects tasks without task type under No task type at the end', () => {
    const tasks: Task[] = [
      { id: '1', title: 'Task 1', task_type_id: null, list_id: 'l1' } as any,
      { id: '2', title: 'Task 2', task_type_id: 'type-task', list_id: 'l1' } as any,
      { id: '3', title: 'Task 3', task_type_id: undefined, list_id: 'l1' } as any,
    ];

    const groups = groupByTaskType(tasks, sampleTypes);
    expect(groups.map((g) => g.label)).toEqual(['Tasks', 'No task type']);
    expect(groups[1].key).toBe('__none__');
    expect(groups[1].tasks.map((t) => t.id)).toEqual(['1', '3']);
  });

  it('works through groupTasks dispatcher with by = "task_type"', () => {
    const tasks: Task[] = [
      { id: '1', title: 'Task 1', task_type_id: 'type-routine', list_id: 'l1' } as any,
      { id: '2', title: 'Task 2', task_type_id: 'type-task', list_id: 'l1' } as any,
    ];

    const groups = groupTasks(tasks, 'task_type', 'UTC', EMPTY_FADING_MAP, sampleTypes);
    expect(groups.map((g) => g.label)).toEqual(['Tasks', 'Routines']);
    expect(groups[0].tasks[0].id).toBe('2');
    expect(groups[1].tasks[0].id).toBe('1');
  });
});
