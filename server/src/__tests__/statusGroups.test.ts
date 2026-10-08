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
        update: (patch: any) => {
          for (const r of store.tables[table] || []) {
            if (filters.every((f) => f(r))) {
              Object.assign(r, patch);
            }
          }
          return query;
        },
        insert: (data: any) => {
          const rows = Array.isArray(data) ? data : [data];
          if (!store.tables[table]) store.tables[table] = [];
          store.tables[table].push(...rows);
          return query;
        },
        then: (resolve: any, reject: any) => execute().then(resolve, reject),
      };
      return query;
    },
  },
}));

vi.mock('../middleware/auth', () => ({ requireAuth: (_req: any, _res: any, next: any) => next() }));
vi.mock('../middleware/admin', () => ({ requireAdmin: (_req: any, _res: any, next: any) => next() }));
import adminRouter from '../routes/status-groups-admin';

import { composeGroupStatuses, getGroupStatuses, getGroupSections, resolveEffectiveGroup } from '../utils/statusGroups';

const defaultGroup = { id: 'default', key: 'task_workflow', is_default: true, is_enabled: true, custom_sections: [{ key: 'review', label: 'Review', emoji: '🔎' }] };
const linkedGroup = { id: 'linked', key: 'local_workflow', base_group_id: 'default', is_enabled: true, custom_sections: [{ key: 'handoff', label: 'Handoff', emoji: '📦' }] };
const row = (id: string, group_id: string, name: string, extra: any = {}) => ({ id, group_id, key: id, name, category: 'todo', color: '#123456', position: 0, is_default: false, ...extra });

beforeEach(() => {
  store.tables = {
    status_groups: [
      { ...defaultGroup, disabled_status_keys: [], status_replacements: {} },
      { ...linkedGroup, disabled_status_keys: [], status_replacements: {} },
      { id: 'independent', key: 'custom', is_enabled: true },
    ],
    status_group_statuses: [row('open', 'default', 'Open', { is_default: true }), row('approval', 'linked', 'Approval'), row('custom', 'independent', 'Custom')],
    status_group_assignments: [], folders: [], lists: [],
  };
});

describe('live status group inheritance', () => {
  it('inherits system defaults and preserves local additions and source ids', async () => {
    const statuses = await getGroupStatuses('linked');
    expect(statuses.map(s => s.key)).toEqual(['open', 'approval']);
    expect(statuses[0]).toMatchObject({ group_id: 'default', is_system: true, is_inherited: true, is_default: true });
    expect(statuses[1]).toMatchObject({ group_id: 'linked', is_system: false, is_inherited: false, is_default: false });
    expect(statuses.map(s => s.position)).toEqual([0, 1]);
  });

  it('reflects source edits, additions and deletions without copying rows', async () => {
    store.tables.status_group_statuses[0].name = 'Ready';
    store.tables.status_group_statuses[0].color = '#abcdef';
    store.tables.status_group_statuses.push(row('review', 'default', 'Review', { section: 'review', section_label: 'Review' }));
    expect((await getGroupStatuses('linked'))[0]).toMatchObject({ name: 'Ready', color: '#abcdef' });
    expect((await getGroupStatuses('linked')).map(s => s.key)).toEqual(['open', 'review', 'approval']);
    store.tables.status_group_statuses = store.tables.status_group_statuses.filter(s => s.id !== 'open');
    expect((await getGroupStatuses('linked')).map(s => s.key)).toEqual(['review', 'approval']);
    expect(store.tables.status_group_statuses.filter(s => s.group_id === 'linked')).toHaveLength(1);
  });

  it('marks every newly added default status as system', async () => {
    store.tables.status_group_statuses.push(row('new_status', 'default', 'New status'));
    expect((await getGroupStatuses('default')).every(s => s.is_system)).toBe(true);
  });

  it('keeps independent workflows independent', async () => {
    expect((await getGroupStatuses('independent')).map(s => s.key)).toEqual(['custom']);
  });

  it('combines persistent extra sections from source and child', async () => {
    expect((await getGroupSections(linkedGroup)).map(s => s.key)).toEqual(['review', 'handoff']);
  });

  it('keeps the primary initial status even if a local row was previously default', () => {
    const result = composeGroupStatuses(linkedGroup, [row('local', 'linked', 'Local', { is_default: true })], [row('open', 'default', 'Open', { is_default: true })]);
    expect(result.filter(s => s.is_default).map(s => s.key)).toEqual(['open']);
  });

  it('resolves linked assignments at list, folder, area and template levels', async () => {
    store.tables.lists = [{ id: 'list', folder_id: 'folder', space_id: 'area' }];
    store.tables.folders = [{ id: 'folder', space_id: 'area', client_space_template_id: 'template' }];
    for (const [entity_type, entity_id] of [['list', 'list'], ['folder', 'folder'], ['space', 'area'], ['template', 'template']]) {
      store.tables.status_group_assignments = [{ group_id: 'linked', entity_type, entity_id, status_groups: linkedGroup }];
      const result = await resolveEffectiveGroup({ listId: 'list' });
      expect(result?.assignment.group_id).toBe('linked');
      expect(result?.statuses.map(s => s.key)).toEqual(['open', 'approval']);
    }
  });

  it('falls back to the system default when no assignment exists', async () => {
    expect((await resolveEffectiveGroup({}))?.statuses.map(s => s.key)).toEqual(['open']);
  });

  it('rejects circular inheritance', async () => {
    store.tables.status_groups = [{ id: 'a', base_group_id: 'b' }, { id: 'b', base_group_id: 'a' }];
    await expect(getGroupStatuses('a')).rejects.toThrow('Circular');
  });

  it('toggles statuses on or off in a linked group without affecting the base group', async () => {
    const linked = store.tables.status_groups.find((g) => g.id === 'linked')!;
    linked.disabled_status_keys = ['open'];

    const effectiveStatuses = await getGroupStatuses('linked');
    expect(effectiveStatuses.map((s) => s.key)).toEqual(['approval']);

    const adminStatuses = await getGroupStatuses('linked', new Set(), { includeDisabled: true });
    expect(adminStatuses.map((s) => s.key)).toEqual(['open', 'approval']);
    expect(adminStatuses[0].is_disabled).toBe(true);

    const baseStatuses = await getGroupStatuses('default');
    expect(baseStatuses.map((s) => s.key)).toEqual(['open']);
    expect(baseStatuses[0].is_disabled).toBe(false);
  });

  it('replaces an inherited status in place with custom status without affecting the base group', async () => {
    const linked = store.tables.status_groups.find((g) => g.id === 'linked')!;
    linked.status_replacements = {
      open: {
        name: 'Backlog',
        key: 'backlog',
        color: '#999999',
        category: 'todo',
        description: 'Custom backlog replacement',
      },
    };

    const statuses = await getGroupStatuses('linked');
    expect(statuses.map((s) => s.key)).toEqual(['backlog', 'approval']);
    expect(statuses[0]).toMatchObject({
      name: 'Backlog',
      key: 'backlog',
      is_replacement: true,
      replaces_key: 'open',
      replaces_name: 'Open',
    });

    const baseStatuses = await getGroupStatuses('default');
    expect(baseStatuses.map((s) => s.key)).toEqual(['open']);
    expect(baseStatuses[0].name).toBe('Open');
  });

  it('reverts replacement back to original inherited status', async () => {
    const linked = store.tables.status_groups.find((g) => g.id === 'linked')!;
    linked.status_replacements = {
      open: { name: 'Backlog', key: 'backlog' },
    };
    expect((await getGroupStatuses('linked'))[0].name).toBe('Backlog');

    delete linked.status_replacements.open;
    expect((await getGroupStatuses('linked'))[0].name).toBe('Open');
  });
});

async function callRoute(path: string, method: string, params: any, body: any = {}) {
  const layer = (adminRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  const res: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json: vi.fn() };
  await layer.route.stack[0].handle({ params, body, query: {} }, res);
  return res;
}

describe('admin inheritance safeguards', () => {
  it('rejects edits to inherited rows through the child route', async () => {
    const res = await callRoute('/:id/statuses/:statusId', 'put', { id: 'linked', statusId: 'open' }, { name: 'Override' });
    expect(res.statusCode).toBe(404);
    expect(store.tables.status_group_statuses[0].name).toBe('Open');
  });

  it('rejects deletion of inherited rows through the child route', async () => {
    const res = await callRoute('/:id/statuses/:statusId', 'delete', { id: 'linked', statusId: 'open' });
    expect(res.statusCode).toBe(404);
  });

  it('rejects reordering inherited rows through the child route', async () => {
    const sourceId = '00000000-0000-4000-8000-000000000001';
    store.tables.status_group_statuses[0].id = sourceId;
    const res = await callRoute('/:id/statuses/reorder', 'put', { id: 'linked' }, { items: [{ id: sourceId, position: 1 }] });
    expect(res.statusCode).toBe(400);
  });

  it('rejects duplicate inherited keys when adding a local status', async () => {
    const res = await callRoute('/:id/statuses', 'post', { id: 'linked' }, { name: 'Open' });
    expect(res.statusCode).toBe(409);
  });

  it('keeps the canonical default enabled', async () => {
    const res = await callRoute('/:id/enabled', 'put', { id: 'default' }, { is_enabled: false });
    expect(res.statusCode).toBe(400);
  });

  it('prevents assigning a different system default', async () => {
    const res = await callRoute('/:id/default', 'put', { id: 'linked' });
    expect(res.statusCode).toBe(400);
  });

  it('toggles status via PUT /:id/toggle-status and /:id/statuses/:statusKey/toggle', async () => {
    const res = await callRoute('/:id/toggle-status', 'put', { id: 'linked' }, { key: 'open', enabled: false });
    expect(res.statusCode).toBe(200);
    const linked = store.tables.status_groups.find((g) => g.id === 'linked');
    expect(linked.disabled_status_keys).toEqual(['open']);

    const res2 = await callRoute('/:id/statuses/:statusKey/toggle', 'put', { id: 'linked', statusKey: 'open' }, { enabled: true });
    expect(res2.statusCode).toBe(200);
    expect(linked.disabled_status_keys).toEqual([]);
  });

  it('replaces status via PUT /:id/statuses/:statusKey/replace and reverts via DELETE', async () => {
    const res = await callRoute('/:id/statuses/:statusKey/replace', 'put', { id: 'linked', statusKey: 'open' }, {
      name: 'Triage Pending',
      color: '#ff5500',
      category: 'todo',
    });
    expect(res.statusCode).toBe(200);
    const linked = store.tables.status_groups.find((g) => g.id === 'linked');
    expect(linked.status_replacements.open).toMatchObject({
      name: 'Triage Pending',
      key: 'triage_pending',
      color: '#ff5500',
    });

    const resDel = await callRoute('/:id/statuses/:statusKey/replace', 'delete', { id: 'linked', statusKey: 'open' });
    expect(resDel.statusCode).toBe(200);
    expect(linked.status_replacements.open).toBeUndefined();
  });
});
