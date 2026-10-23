import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

const state = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, access: 'member' as string | null, locked: false, emits: [] as any[] }));
const user = '00000000-0000-0000-0000-000000000001';
const task = '00000000-0000-0000-0000-000000000002';
const notification = '00000000-0000-0000-0000-000000000003';
vi.mock('../middleware/auth', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.userId = '00000000-0000-0000-0000-000000000001'; next(); } }));
vi.mock('../middleware/userType', () => ({ requireUserType: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../middleware/workspace', () => ({
  getUserWorkspaceIds: async () => ['ws'], reachableWorkspaceIds: async () => ['ws'], workspaceIdOf: async () => 'ws',
}));
vi.mock('../middleware/permissions', () => ({
  checkResourceAccess: async () => state.access, meetsAccessLevel: (level: string) => level === 'member',
  isWorkspaceAdmin: async () => false, isAdminOfResource: async () => false, isResourceLocked: async () => state.locked,
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../utils/statusGroups', () => ({ normalizeTaskStatusForList: async () => 'closed', defaultTaskStatusForList: async () => 'open', getListStageInfo: async () => ({}) }));
vi.mock('../utils/taskActivity', () => ({ logTaskActivity: async () => {} }));
vi.mock('../routes/pm/workBlocks', () => ({ recordWorkBlockCompletionIfActive: async () => {} }));
vi.mock('../routes/pm/groupRuns', () => ({ recordGroupRunCompletionIfActive: async () => {} }));
vi.mock('../supabase', () => ({ supabaseAdmin: { from: (table: string) => {
  const filters: ((row: any) => boolean)[] = [];
  let changes: any = null;
  const execute = () => {
    const rows = (state.tables[table] || []).filter(r => filters.every(f => f(r)));
    if (changes) rows.forEach(r => Object.assign(r, changes));
    return { data: rows, count: rows.length, error: null };
  };
  const q: any = {
    select: () => q,
    eq: (key: string, val: any) => { filters.push(r => key.startsWith('metadata->>') ? r.metadata?.[key.slice(11)] === val : (key === 'workspace_id' ? (r[key] ?? 'ws') : r[key]) === val); return q; },
    in: (key: string, vals: any[]) => { filters.push(r => vals.includes(key === 'workspace_id' ? (r[key] ?? 'ws') : r[key])); return q; },
    update: (patch: any) => { changes = patch; return q; },
    maybeSingle: async () => { const result = execute(); return { ...result, data: result.data[0] || null }; },
    single: async () => { const result = execute(); return { ...result, data: result.data[0] || null }; },
    then: (resolve: any, reject: any) => Promise.resolve(execute()).then(resolve, reject),
  };
  return q;
} } }));
import router from '../routes/pm/tasks';

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json());
  app.set('io', { to: (room: string) => ({ emit: (event: string, payload: any) => state.emits.push({ room, event, payload }) }) });
  app.use('/pm', router);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => {
  state.access = 'member'; state.locked = false; state.emits = [];
  const due = '2026-10-18T10:00:00.000Z';
  state.tables = {
    notifications: [{ id: notification, user_id: user, type: 'task_reminder', reference_id: task, metadata: { due_at: due }, is_read: false }],
    tasks: [{ id: task, title: 'Call', list_id: 'list', due_date: due, status: 'open', task_types: { key: 'reminders' } }],
    lists: [{ id: 'list', space_id: 'space' }], space_statuses: [], task_checklists: [], task_checklist_items: [],
    task_types: [{ id: '00000000-0000-0000-0000-000000000004', key: 'reminders' }],
  };
});
const act = (action: string, minutes = 10) => fetch(`${base}/pm/tasks/${task}/reminder-action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notification_id: notification, action, minutes }) });

describe('reminder actions', () => {
  it('rejects another user’s notification even when the task is accessible', async () => {
    state.tables.notifications[0].user_id = 'someone-else'; expect((await act('snooze')).status).toBe(404);
  });
  it('checks current access and list locks', async () => {
    state.access = null; expect((await act('complete')).status).toBe(403);
    state.access = 'member'; state.locked = true; expect((await act('snooze')).status).toBe(403);
  });
  it('rejects a reminder from an earlier schedule or a completed task', async () => {
    state.tables.tasks[0].due_date = '2026-10-20T10:00:00Z'; expect((await act('snooze')).status).toBe(409);
    state.tables.tasks[0].status = 'closed'; expect((await act('complete')).status).toBe(409);
  });
  it('snoozes from now, synchronizes read state, and rejects a second stale action', async () => {
    const before = Date.now(); expect((await act('snooze', 30)).status).toBe(200);
    expect(Date.parse(state.tables.tasks[0].due_date)).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(state.tables.notifications[0].is_read).toBe(true);
    expect(state.emits[0]?.event).toBe('notifications_read');
    expect((await act('snooze', 30)).status).toBe(409);
  });
  it('enforces subtask and checklist completion requirements', async () => {
    state.tables.tasks.push({ id: 'child', parent_task_id: task, status: 'open' });
    expect((await act('complete')).status).toBe(409);
    state.tables.tasks.pop(); state.tables.task_checklists = [{ id: 'checklist', task_id: task }];
    state.tables.task_checklist_items = [{ checklist_id: 'checklist', is_done: false }];
    expect((await act('complete')).status).toBe(409);
  });
  it('completes an eligible reminder and clears its notification', async () => {
    expect((await act('complete')).status).toBe(200); expect(state.tables.tasks[0].status).toBe('closed');
    expect(state.tables.notifications[0].is_read).toBe(true);
  });
  it('rejects unsupported snooze intervals', async () => { expect((await act('snooze', -5)).status).toBe(400); });
  it('prompts for a missing schedule before saving a reminder task', async () => {
    const res = await fetch(`${base}/pm/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ list_id: task, title: 'Call Remind Me' }) });
    expect(res.status).toBe(422); expect(((await res.json()) as { code: string }).code).toBe('REMINDER_SCHEDULE_REQUIRED');
  });
  it('previews native reminder titles without writing a task', async () => {
    const res = await fetch(`${base}/pm/reminders/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Call Remind Me tomorrow at 5pm', timezone_offset: 330 }) });
    expect(res.status).toBe(200); expect(((await res.json()) as { data: unknown }).data).toMatchObject({ title: 'Call', intent: true });
    expect(state.tables.tasks).toHaveLength(1);
  });
});
