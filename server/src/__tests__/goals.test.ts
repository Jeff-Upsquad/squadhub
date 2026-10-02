import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { effectiveGoalStatus, goalProgress, wouldCreateGoalCycle } from '@squadhub/shared';

// In-memory Supabase double: the HTTP tests drive the real router, so request
// validation, access resolution, source expansion and progress all run as-is.
const store = vi.hoisted(() => ({ tables: {} as Record<string, any[]> }));

vi.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = req.headers['x-test-user'];
    req.userType = req.headers['x-test-type'] || 'internal';
    next();
  },
}));
vi.mock('../utils/taskActivity', () => ({ logTaskActivity: vi.fn() }));
vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: ((r: any) => boolean)[] = [];
      let mode: 'read' | 'insert' | 'upsert' | 'update' | 'delete' = 'read';
      let payload: any;
      let options: any;
      let slice: [number, number] = [0, 9999];
      const keysFor = (t: string) => (t === 'goal_tasks' ? ['goal_id', 'task_id']
        : t === 'goal_sources' ? ['goal_id', 'resource_type', 'resource_id'] : ['id']);
      async function execute() {
        const rows = store.tables[table] || (store.tables[table] = []);
        let selected = rows.filter((r) => filters.every((f) => f(r)));
        if (mode === 'insert' || mode === 'upsert') {
          selected = [];
          for (const p of Array.isArray(payload) ? payload : [payload]) {
            const keys = keysFor(table);
            const old = mode === 'upsert' ? rows.find((r) => keys.every((k) => r[k] === p[k])) : null;
            if (old) {
              if (!options?.ignoreDuplicates) Object.assign(old, p);
              selected.push(old);
            } else {
              if (mode === 'insert' && table === 'goal_dependencies' && rows.some((r) => r.goal_id === p.goal_id && r.from_task_id === p.from_task_id && r.to_task_id === p.to_task_id)) {
                return { data: null, error: { code: '23505', message: 'duplicate' } };
              }
              const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...p };
              rows.push(row);
              selected.push(row);
            }
          }
        }
        if (mode === 'update') selected.forEach((r) => Object.assign(r, payload));
        if (mode === 'delete') {
          store.tables[table] = rows.filter((r) => !selected.includes(r));
          selected = [];
        }
        const data = mode === 'read' ? selected.slice(slice[0], slice[1] + 1) : selected;
        return { data: structuredClone(data), error: null };
      }
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => { filters.push((r) => r[k] === v); return q; },
        in: (k: string, vs: any[]) => { filters.push((r) => vs.includes(r[k])); return q; },
        is: (k: string, v: any) => { filters.push((r) => (r[k] ?? null) === v); return q; },
        order: () => q,
        range: (a: number, b: number) => { slice = [a, b]; return q; },
        insert: (p: any) => { mode = 'insert'; payload = p; return q; },
        upsert: (p: any, o: any) => { mode = 'upsert'; payload = p; options = o; return q; },
        update: (p: any) => { mode = 'update'; payload = p; return q; },
        delete: () => { mode = 'delete'; return q; },
        maybeSingle: async () => {
          const r = await execute();
          return r.error ? r : { data: (r.data as any[])[0] ?? null, error: null };
        },
        then: (yes: any, no: any) => execute().then(yes, no),
      };
      return q;
    },
  },
}));

import router from '../routes/pm/goals';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const W = id(1), ME = id(2), OTHER = id(3), SPACE = id(4), FOLDER = id(5), LIST = id(6), P = id(7), G = id(8);
const T1 = id(9), T2 = id(10), T3 = id(11), LIST2 = id(12), SUBFOLDER = id(13), SUBLIST = id(14), ADMIN = id(15), PRIVATE_LIST = id(16);

let server: Server;
let base: string;
async function call(path: string, method = 'GET', body?: unknown, user = ME, userType = 'internal') {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-test-user': user, 'x-test-type': userType },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, ...((await r.json()) as any) };
}
const goals = (user = ME) => call(`/goals?workspace_id=${W}`, 'GET', undefined, user);
const task = (taskId: string, listId: string, extra: Record<string, unknown> = {}) => ({
  id: taskId, list_id: listId, title: `Task ${taskId.slice(-2)}`, status: 'todo', priority: 'normal', display_number: 1,
  parent_task_id: null, assignee_ids: [], work_date: null, start_date: null, due_date: null,
  metadata: { format: 'keep-me' }, recurrence: null, ...extra,
});

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.get('/unrelated-pm-route', (_req, res) => res.json({ success: true }));
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

beforeEach(() => {
  const row = (r: Record<string, unknown>) => ({ deleted_at: null, is_locked: false, ...r });
  store.tables = {
    workspaces: [{ id: W, name: 'Squad' }],
    workspace_members: [
      { workspace_id: W, user_id: ME, role: 'member' },
      { workspace_id: W, user_id: OTHER, role: 'member' },
      { workspace_id: W, user_id: ADMIN, role: 'admin' },
    ],
    spaces: [row({ id: SPACE, workspace_id: W, name: 'Product', color: '#2f7cf6', created_by: ME })],
    folders: [
      row({ id: FOLDER, space_id: SPACE, name: 'Launch', parent_folder_id: null, created_by: ME }),
      row({ id: SUBFOLDER, space_id: SPACE, name: 'Launch / Web', parent_folder_id: FOLDER, created_by: ME }),
    ],
    lists: [
      row({ id: LIST, folder_id: FOLDER, space_id: SPACE, name: 'Engineering', created_by: ME }),
      row({ id: LIST2, folder_id: null, space_id: SPACE, name: 'Elsewhere', created_by: ME }),
      row({ id: SUBLIST, folder_id: SUBFOLDER, space_id: SPACE, name: 'Web build', created_by: ME }),
      row({ id: PRIVATE_LIST, folder_id: null, space_id: id(99), name: 'Not mine', created_by: OTHER }),
    ],
    tasks: [task(T1, LIST), task(T2, LIST2), task(T3, SUBLIST)],
    task_list_links: [],
    resource_memberships: [],
    space_statuses: [{ id: id(50), space_id: SPACE, name: 'Delivered', category: 'closed' }],
    goal_projects: [{ id: P, workspace_id: W, name: 'Launch', color: '#7c5cff', created_by: ME, created_at: '2026-10-01T00:00:00Z' }],
    goals: [{
      id: G, workspace_id: W, project_id: P, name: 'Ship the launch', description: '', status: 'in_progress', priority: 'high',
      assignee_ids: [], labels: [], work_start_date: null, work_end_date: null, start_date: null, due_date: null,
      created_by: ME, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    }],
    goal_tasks: [],
    goal_sources: [],
    goal_dependencies: [],
    task_day_plans: [],
  };
});

describe('progress and graph helpers', () => {
  it('derives achieved only when every task is done, and drops back when work reopens', () => {
    expect(goalProgress([]).progress).toBe(0);
    expect(effectiveGoalStatus('planned', 0, 0)).toBe('planned');
    expect(effectiveGoalStatus('in_progress', 3, 3)).toBe('achieved');
    expect(effectiveGoalStatus('on_hold', 3, 2)).toBe('on_hold');
    expect(goalProgress([{ completed: true }, { completed: false }, { completed: false }]).progress).toBe(33);
  });

  it('detects cycles through the existing edges', () => {
    const edges = [{ from_task_id: 'a', to_task_id: 'b' }, { from_task_id: 'b', to_task_id: 'c' }];
    expect(wouldCreateGoalCycle(edges, 'c', 'a')).toBe(true);
    expect(wouldCreateGoalCycle(edges, 'a', 'c')).toBe(false);
    expect(wouldCreateGoalCycle(edges, 'a', 'a')).toBe(true);
  });
});

describe('reading goals', () => {
  it('allows client workspace members and leaves unrelated PM routes to their own guards', async () => {
    for (const type of ['client', 'client_staff', 'partner_employee']) {
      const result = await call(`/goals?workspace_id=${W}`, 'GET', undefined, ME, type);
      expect(result.status).toBe(200);
      expect(result.data.goals).toHaveLength(1);
    }
    expect((await call('/unrelated-pm-route', 'GET', undefined, ME, 'unsupported')).status).toBe(200);
    expect((await call(`/goals?workspace_id=${W}`, 'GET', undefined, ME, 'unsupported')).status).toBe(403);
  });

  it('shows a goal to its creator, assignees and admins only', async () => {
    expect((await goals()).data.goals).toHaveLength(1);
    expect((await goals(OTHER)).data.goals).toHaveLength(0);
    expect((await goals(ADMIN)).data.goals).toHaveLength(1);
    store.tables.goals[0].assignee_ids = [OTHER];
    expect((await goals(OTHER)).data.goals).toHaveLength(1);
  });

  it('rejects people outside the workspace', async () => {
    expect((await goals(id(77))).status).toBe(403);
  });

  it('counts custom done/closed statuses toward progress and becomes achieved', async () => {
    store.tables.goal_tasks.push({ goal_id: G, task_id: T1, scheduled: false, is_direct: true });
    store.tables.goal_tasks.push({ goal_id: G, task_id: T2, scheduled: false, is_direct: true });
    store.tables.tasks[0].status = 'Delivered';
    let g = (await goals()).data.goals[0];
    expect([g.task_count, g.completed_count, g.progress, g.status]).toEqual([2, 1, 50, 'in_progress']);
    store.tables.tasks[1].status = 'done';
    g = (await goals()).data.goals[0];
    expect([g.progress, g.status, g.stored_status]).toEqual([100, 'achieved', 'in_progress']);
  });

  it('keeps tasks the viewer cannot open out of the payload but in the totals', async () => {
    store.tables.goals[0].assignee_ids = [OTHER];
    store.tables.goal_tasks.push({ goal_id: G, task_id: T1, scheduled: false, is_direct: true });
    store.tables.resource_memberships.push({ id: id(60), user_id: OTHER, resource_type: 'list', resource_id: LIST2, access_level: 'viewer' });
    store.tables.goal_tasks.push({ goal_id: G, task_id: T2, scheduled: false, is_direct: true });
    const g = (await goals(OTHER)).data.goals[0];
    expect(g.tasks.map((t: any) => t.id)).toEqual([T2]);
    expect(g.tasks[0].can_edit).toBe(false);
    expect([g.task_count, g.hidden_task_count]).toEqual([2, 1]);
  });
});

describe('creating and editing', () => {
  it('creates a goal in a project and links tasks in one go', async () => {
    const r = await call('/goals', 'POST', { project_id: P, name: '  Grow signups  ', task_ids: [T1, T2] });
    expect(r.status).toBe(200);
    expect(r.data.name).toBe('Grow signups');
    expect(r.data.tasks.map((t: any) => t.id).sort()).toEqual([T1, T2].sort());
    expect(r.data.assignee_ids).toEqual([]);
  });

  it('validates date ranges and assignees', async () => {
    expect((await call('/goals', 'POST', { project_id: P, name: 'x', start_date: '2026-10-09', due_date: '2026-10-01' })).status).toBe(400);
    expect((await call('/goals', 'POST', { project_id: P, name: 'x', work_start_date: '2026-02-30' })).status).toBe(400);
    expect((await call('/goals', 'POST', { project_id: P, name: 'x', work_start_date: '2026-13-01' })).status).toBe(400);
    expect((await call('/goals', 'POST', { project_id: P, name: 'x', due_date: '2026-00-00' })).status).toBe(400);
    expect((await call('/goals', 'POST', { project_id: P, name: 'x', assignee_ids: [id(88)] })).status).toBe(400);
    expect((await call(`/goals/${G}`, 'PATCH', { work_start_date: '2026-10-05', work_end_date: '2026-10-04' })).status).toBe(400);
  });

  it('only lets owners and admins delete projects and goals', async () => {
    store.tables.goals[0].assignee_ids = [OTHER];
    expect((await call(`/goals/${G}`, 'DELETE', undefined, OTHER)).status).toBe(403);
    expect((await call(`/goal-projects/${P}`, 'DELETE', undefined, OTHER)).status).toBe(403);
    expect((await call(`/goals/${G}`, 'DELETE', undefined, ADMIN)).status).toBe(200);
  });
});

describe('linking tasks', () => {
  it('links accessible tasks and places dated ones on the timeline', async () => {
    store.tables.tasks[0].due_date = '2026-10-10T00:00:00+00:00';
    const r = await call(`/goals/${G}/tasks`, 'POST', { task_ids: [T1, T2] });
    expect(r.data.linked).toHaveLength(2);
    const rows = store.tables.goal_tasks;
    expect(rows.find((x) => x.task_id === T1).scheduled).toBe(true);
    expect(rows.find((x) => x.task_id === T2).scheduled).toBe(false);
  });

  it('refuses tasks the actor or the goal creator cannot open, and routine templates', async () => {
    store.tables.tasks.push(task(id(30), PRIVATE_LIST));
    expect((await call(`/goals/${G}/tasks`, 'POST', { task_ids: [id(30)] })).status).toBe(403);
    store.tables.tasks[0].recurrence = { freq: 'daily' };
    const r = await call(`/goals/${G}/tasks`, 'POST', { task_ids: [T1] });
    expect(r.status).toBe(403);
    expect(r.error).toMatch(/Routine/);
  });
});

describe('auto-included containers', () => {
  it('includes nested folders, secondary list memberships and tasks created later', async () => {
    store.tables.goal_sources.push({ id: id(40), goal_id: G, resource_type: 'folder', resource_id: FOLDER });
    store.tables.task_list_links.push({ id: id(41), task_id: T2, list_id: LIST });
    let g = (await goals()).data.goals[0];
    expect(g.tasks.map((t: any) => t.id).sort()).toEqual([T1, T2, T3].sort());
    expect(g.sources[0]).toMatchObject({ name: 'Launch', path: 'Product' });
    store.tables.tasks.push(task(id(42), SUBLIST));
    g = (await goals()).data.goals[0];
    expect(g.task_count).toBe(4);
  });

  it('keeps a container task included after its manual link is removed', async () => {
    store.tables.goal_sources.push({ id: id(40), goal_id: G, resource_type: 'list', resource_id: LIST });
    store.tables.goal_tasks.push({ goal_id: G, task_id: T1, scheduled: true, is_direct: true });
    await call(`/goals/${G}/tasks/${T1}`, 'DELETE');
    expect(store.tables.goal_tasks[0]).toMatchObject({ is_direct: false, scheduled: true });
    const g = (await goals()).data.goals[0];
    expect(g.tasks[0]).toMatchObject({ id: T1, direct: false, scheduled: true });
  });
});

describe('scheduling on the timeline', () => {
  beforeEach(() => {
    store.tables.goal_tasks.push({ goal_id: G, task_id: T1, scheduled: false, is_direct: true });
  });

  it('writes work dates to the task, merging metadata, and places it', async () => {
    store.tables.task_day_plans.push({ id: id(70), task_id: T1, user_id: ME });
    const r = await call(`/goals/${G}/tasks/${T1}/schedule`, 'PATCH', { work_date: '2026-10-05', work_end_date: '2026-10-08' });
    expect(r.status).toBe(200);
    const t = store.tables.tasks[0];
    expect(t.work_date).toBe('2026-10-05');
    expect(t.metadata).toEqual({ format: 'keep-me', work_end_date: '2026-10-08' });
    expect(store.tables.goal_tasks[0].scheduled).toBe(true);
    expect(store.tables.task_day_plans).toHaveLength(0);
  });

  it('rejects backwards ranges, locked lists and view-only access', async () => {
    expect((await call(`/goals/${G}/tasks/${T1}/schedule`, 'PATCH', { work_date: '2026-10-09', work_end_date: '2026-10-02' })).status).toBe(400);
    expect((await call(`/goals/${G}/tasks/${T1}/schedule`, 'PATCH', { start_date: '2026-10-09', due_date: '2026-10-02' })).status).toBe(400);
    store.tables.lists[0].is_locked = true;
    expect((await call(`/goals/${G}/tasks/${T1}/schedule`, 'PATCH', { due_date: '2026-10-02' })).status).toBe(403);
    store.tables.lists[0].is_locked = false;
    store.tables.goals[0].assignee_ids = [OTHER];
    store.tables.resource_memberships.push({ id: id(61), user_id: OTHER, resource_type: 'list', resource_id: LIST, access_level: 'viewer' });
    expect((await call(`/goals/${G}/tasks/${T1}/schedule`, 'PATCH', { due_date: '2026-10-02' }, OTHER)).status).toBe(403);
    // Moving a task back to the tray needs no edit access.
    expect((await call(`/goals/${G}/tasks/${T1}/schedule`, 'PATCH', { scheduled: false }, OTHER)).status).toBe(200);
  });

  it('refuses tasks that are not part of the goal', async () => {
    expect((await call(`/goals/${G}/tasks/${T2}/schedule`, 'PATCH', { scheduled: true })).status).toBe(404);
  });
});

describe('dependencies', () => {
  beforeEach(() => {
    store.tables.goal_tasks.push({ goal_id: G, task_id: T1, scheduled: true, is_direct: true });
    store.tables.goal_tasks.push({ goal_id: G, task_id: T2, scheduled: true, is_direct: true });
  });

  it('connects tasks, rejects duplicates and loops', async () => {
    const ok = await call(`/goals/${G}/dependencies`, 'POST', { from_task_id: T1, to_task_id: T2, from_endpoint: 'end', to_endpoint: 'start' });
    expect(ok.status).toBe(200);
    expect((await call(`/goals/${G}/dependencies`, 'POST', { from_task_id: T1, to_task_id: T2 })).status).toBe(409);
    const loop = await call(`/goals/${G}/dependencies`, 'POST', { from_task_id: T2, to_task_id: T1 });
    expect(loop.status).toBe(400);
    expect(loop.error).toMatch(/circular/);
    expect((await goals()).data.goals[0].dependencies).toHaveLength(1);
  });

  it('only connects tasks in the goal', async () => {
    expect((await call(`/goals/${G}/dependencies`, 'POST', { from_task_id: T1, to_task_id: T3 })).status).toBe(400);
  });
});

describe('standalone tabs', () => {
  it('resolves the goal’s workspace for people who can see it', async () => {
    expect((await call(`/goals/${G}/context`)).data).toMatchObject({ id: W });
    expect((await call(`/goals/${G}/context`, 'GET', undefined, OTHER)).status).toBe(403);
  });
});
