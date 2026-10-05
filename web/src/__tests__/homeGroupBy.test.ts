import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mockStorage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => mockStorage.get(key) ?? null,
      setItem: (key: string, value: string) => mockStorage.set(key, value),
      removeItem: (key: string) => mockStorage.delete(key),
      clear: () => mockStorage.clear(),
      key: (i: number) => [...mockStorage.keys()][i] ?? null,
      length: 0,
    },
    writable: true,
    configurable: true,
  });
});
import type { Task } from '@squadhub/shared';
import { usePMStore } from '../stores/pmStore';
import { groupTasks, EMPTY_FADING_MAP } from '../lib/taskGrouping';

describe('Home focus list group-by synchronization', () => {
  beforeEach(() => {
    usePMStore.getState().reset();
  });

  it('updates todayListGroupBy and synchronizes dashboard scopes and secondary cards', () => {
    const store = usePMStore.getState();
    // Default is none
    expect(store.todayListGroupBy).toBe('none');

    // Simulate setting group by in Focus list to 'priority'
    store.setTodayListGroupBy('priority');

    const updated = usePMStore.getState();
    expect(updated.todayListGroupBy).toBe('priority');
    expect(updated.groupByScope['dashboard:today']).toBe('priority');
    expect(updated.groupByScope['dashboard:overdue']).toBe('priority');
    expect(updated.groupByScope['dashboard:tomorrow']).toBe('priority');
    expect(updated.groupByScope['dashboard:all']).toBe('priority');
    expect(updated.groupByScope['home:new-tasks']).toBe('priority');

    // Now set to 'status'
    updated.setTodayListGroupBy('status');
    const updatedStatus = usePMStore.getState();
    expect(updatedStatus.todayListGroupBy).toBe('status');
    expect(updatedStatus.groupByScope['dashboard:today']).toBe('status');
    expect(updatedStatus.groupByScope['dashboard:overdue']).toBe('status');
    expect(updatedStatus.groupByScope['dashboard:tomorrow']).toBe('status');
    expect(updatedStatus.groupByScope['dashboard:all']).toBe('status');
    expect(updatedStatus.groupByScope['home:new-tasks']).toBe('status');
  });

  it('correctly groups In progress, Evening, Night, and Focus tasks with the shared group-by', () => {
    const inProgressTasks: Task[] = [
      { id: 't1', title: 'Task 1', priority: 'high', status: 'In Progress' } as unknown as Task,
      { id: 't2', title: 'Task 2', priority: 'low', status: 'Todo' } as unknown as Task,
    ];

    const eveningTasks: Task[] = [
      { id: 't3', title: 'Evening Task', priority: 'medium', status: 'Review' } as unknown as Task,
    ];

    const nightTasks: Task[] = [
      { id: 't4', title: 'Night Task', priority: 'urgent', status: 'Todo' } as unknown as Task,
    ];

    const tz = 'UTC';

    // When groupBy is 'priority'
    const inProgressGrouped = groupTasks(inProgressTasks, 'priority', tz, EMPTY_FADING_MAP);
    expect(inProgressGrouped.length).toBe(2);
    expect(inProgressGrouped.map((g) => g.key)).toEqual(['high', 'low']);

    const eveningGrouped = groupTasks(eveningTasks, 'priority', tz, EMPTY_FADING_MAP);
    expect(eveningGrouped.length).toBe(1);
    expect(eveningGrouped[0].key).toBe('medium');

    const nightGrouped = groupTasks(nightTasks, 'priority', tz, EMPTY_FADING_MAP);
    expect(nightGrouped.length).toBe(1);
    expect(nightGrouped[0].key).toBe('urgent');

    // When groupBy is 'status'
    const inProgressStatusGrouped = groupTasks(inProgressTasks, 'status', tz, EMPTY_FADING_MAP);
    expect(inProgressStatusGrouped.length).toBe(2);
    expect(inProgressStatusGrouped.map((g) => g.label)).toEqual(['In Progress', 'Todo']);
  });
});
