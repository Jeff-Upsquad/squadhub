import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
}));

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: ((row: any) => boolean)[] = [];
      let limitCount = Infinity;
      const execute = async () => ({
        data: (store.tables[table] || [])
          .filter((r) => filters.every((f) => f(r)))
          .slice(0, limitCount),
        error: null,
      });
      const query: any = {
        select: () => query,
        eq: (key: string, value: any) => {
          filters.push((r) => r[key] === value);
          return query;
        },
        in: (key: string, values: any[]) => {
          filters.push((r) => values.includes(r[key]));
          return query;
        },
        order: () => query,
        limit: (l: number) => {
          limitCount = l;
          return query;
        },
        maybeSingle: async () => {
          const res = await execute();
          return { data: res.data[0] || null, error: null };
        },
        single: async () => {
          const res = await execute();
          return { data: res.data[0] || null, error: null };
        },
        then: (resolve: any, reject: any) => execute().then(resolve, reject),
      };
      return query;
    },
  },
}));

import { resolveEffectiveTaskTypeGroup } from '../utils/taskTypeGroups';

describe('resolveEffectiveTaskTypeGroup resolution precedence', () => {
  const defaultGroup = {
    id: 'grp-default',
    key: 'default_task_types',
    name: 'Default Task Types',
    is_default: true,
    is_enabled: true,
  };
  const spaceGroup = {
    id: 'grp-space',
    key: 'space_types',
    name: 'Space Types',
    is_default: false,
    is_enabled: true,
  };
  const listGroup = {
    id: 'grp-list',
    key: 'list_types',
    name: 'List Types',
    is_default: false,
    is_enabled: true,
  };

  beforeEach(() => {
    store.tables = {
      task_type_groups: [defaultGroup, spaceGroup, listGroup],
      task_type_group_items: [
        { group_id: 'grp-default', task_type_id: 't-1', position: 0, task_types: { id: 't-1', name: 'Task', key: 'task' } },
        { group_id: 'grp-space', task_type_id: 't-2', position: 0, task_types: { id: 't-2', name: 'Design', key: 'design' } },
        { group_id: 'grp-list', task_type_id: 't-3', position: 0, task_types: { id: 't-3', name: 'Code', key: 'coding' } },
      ],
      task_type_group_assignments: [],
      spaces: [{ id: 'space-1', name: 'Area 1' }],
      folders: [{ id: 'folder-1', space_id: 'space-1' }],
      lists: [{ id: 'list-1', space_id: 'space-1', folder_id: 'folder-1' }],
    };
  });

  it('falls back to default group when no specific assignment exists', async () => {
    const resolved = await resolveEffectiveTaskTypeGroup({ spaceId: 'space-1' });
    expect(resolved).not.toBeNull();
    expect(resolved?.assignment?.group_id).toBe('grp-default');
    expect(resolved?.task_types.map((t) => t.key)).toEqual(['task']);
  });

  it('resolves space-level assignment when present', async () => {
    store.tables.task_type_group_assignments = [
      { id: 'a-1', group_id: 'grp-space', entity_type: 'space', entity_id: 'space-1', task_type_groups: spaceGroup },
    ];

    const resolved = await resolveEffectiveTaskTypeGroup({ spaceId: 'space-1' });
    expect(resolved).not.toBeNull();
    expect(resolved?.assignment?.group_id).toBe('grp-space');
    expect(resolved?.task_types.map((t) => t.key)).toEqual(['design']);
  });

  it('resolves nearest list assignment over space assignment', async () => {
    store.tables.task_type_group_assignments = [
      { id: 'a-1', group_id: 'grp-space', entity_type: 'space', entity_id: 'space-1', task_type_groups: spaceGroup },
      { id: 'a-2', group_id: 'grp-list', entity_type: 'list', entity_id: 'list-1', task_type_groups: listGroup },
    ];

    const resolved = await resolveEffectiveTaskTypeGroup({ listId: 'list-1', spaceId: 'space-1' });
    expect(resolved).not.toBeNull();
    expect(resolved?.assignment?.group_id).toBe('grp-list');
    expect(resolved?.task_types.map((t) => t.key)).toEqual(['coding']);
  });
});
