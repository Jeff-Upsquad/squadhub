/**
 * Cross-workspace isolation: two accounts (workspaces) with seeded data, real
 * Express routers, an in-memory Supabase. Alice belongs to Acme only; Bob to
 * Bolt only. Every read of the other tenant's data must be refused, and the
 * aggregated surfaces (My Tasks, notifications) must only return rows from the
 * caller's own workspaces.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';
import { ACME, BOLT, SHARED, TALENT, id } from './helpers/tenantFixture';

vi.mock('../supabase', async () => {
  const { createFakeSupabase } = await import('./helpers/fakeSupabase');
  const fx = await import('./helpers/tenantFixture');
  return createFakeSupabase(fx.db, {
    'alice-token': fx.ALICE,
    'bob-token': fx.BOB,
    'tina-token': fx.TINA,
    'ron-token': fx.RON,
  });
});

let server: http.Server;
let base = '';

beforeAll(async () => {
  const { default: tasksRouter } = await import('../routes/pm/tasks');
  const { default: messagesRouter } = await import('../routes/messages');
  const { default: channelsRouter } = await import('../routes/channels');
  const { default: notificationsRouter } = await import('../routes/notifications');
  const { default: spacesRouter } = await import('../routes/pm/spaces');
  const { default: foldersRouter } = await import('../routes/pm/folders');
  const { default: listsRouter } = await import('../routes/pm/lists');
  const { default: viewsRouter } = await import('../routes/pm/views');
  const { default: searchRouter } = await import('../routes/pm/search');
  const { default: goalsRouter } = await import('../routes/pm/goals');
  const { default: checklistsRouter } = await import('../routes/pm/checklists');
  const { default: attachmentsRouter } = await import('../routes/pm/task-attachments');
  const { default: huddlesRouter } = await import('../routes/huddles');
  const { default: notesRouter } = await import('../routes/notes');
  const { default: timerRouter } = await import('../routes/timer');
  const app = express();
  app.use(express.json());
  // Same mount order as src/index.ts.
  app.use('/pm', spacesRouter);
  app.use('/pm', foldersRouter);
  app.use('/pm', listsRouter);
  app.use('/pm', viewsRouter);
  app.use('/pm', tasksRouter);
  app.use('/pm', searchRouter);
  app.use('/pm', goalsRouter);
  app.use('/pm', checklistsRouter);
  app.use('/pm', attachmentsRouter);
  app.use('/huddles', huddlesRouter);
  app.use('/notes', notesRouter);
  app.use('/timer', timerRouter);
  app.use('/messages', messagesRouter);
  app.use('/channels', channelsRouter);
  app.use('/notifications', notificationsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
});

async function call(
  method: string,
  path: string,
  opts: { token?: string; workspace?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = { Authorization: `Bearer ${opts.token ?? 'alice-token'}` };
  if (opts.workspace) headers['X-Workspace-Id'] = opts.workspace;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const body: any = await res.json().catch(() => null);
  return { status: res.status, body };
}
const get = (path: string, opts: { token?: string; workspace?: string } = {}) => call('GET', path, opts);

/** Refused (403, or 404 when the scoped lookup doesn't admit the row exists) and nothing leaked. */
function expectRefused(r: { status: number; body: any }, ...secrets: string[]) {
  expect([403, 404]).toContain(r.status);
  const text = JSON.stringify(r.body);
  for (const s of secrets) expect(text).not.toContain(s);
}

describe('tenant isolation', () => {
  it('refuses an X-Workspace-Id the user is not a member of', async () => {
    const r = await get('/notifications', { workspace: BOLT });
    expect(r.status).toBe(403);
  });

  it('refuses a workspace_id query that disagrees with X-Workspace-Id', async () => {
    const r = await get(`/channels?workspace_id=${BOLT}`, { workspace: ACME });
    expect(r.status).toBe(400);
  });

  describe('tasks', () => {
    it("refuses reading another workspace's task by id", async () => {
      const r = await get(`/pm/tasks/${id(31)}`, { workspace: ACME });
      // 404: the tenant-scoped lookup doesn't even admit the task exists.
      expect([403, 404]).toContain(r.status);
      expect(JSON.stringify(r.body)).not.toContain('Bolt secret task');
    });

    it("refuses listing another workspace's list", async () => {
      const r = await get(`/pm/tasks?list_id=${id(21)}`, { workspace: ACME });
      expect(r.status).toBe(403);
    });

    it('My Tasks aggregates only the caller\'s workspaces', async () => {
      const r = await get('/pm/tasks/my?include_done=true');
      expect(r.status).toBe(200);
      const all = JSON.stringify(r.body);
      expect(all).toContain('Acme task');
      expect(all).not.toContain('Bolt secret task');
    });
  });

  describe('channels and messages', () => {
    it("refuses listing another workspace's channels", async () => {
      const r = await get(`/channels?workspace_id=${BOLT}`);
      expect(r.status).toBe(403);
    });

    it("refuses reading another workspace's channel messages", async () => {
      const r = await get(`/messages?channel_id=${id(41)}`, { workspace: ACME });
      expect(r.status).toBe(403);
    });

    it("refuses reading a single message from another workspace's channel", async () => {
      const r = await get(`/messages/${id(61)}`, { workspace: ACME });
      expect(r.status).toBe(403);
    });

    it("refuses reading a DM message the caller isn't part of", async () => {
      const r = await get(`/messages/${id(62)}`, { workspace: ACME });
      expect(r.status).toBe(403);
    });

    it('allows the owner to read their own public channel', async () => {
      const r = await get(`/messages?channel_id=${id(40)}`, { workspace: ACME });
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.body)).toContain('hello acme');
    });
  });

  describe('notifications', () => {
    it('returns only notifications from workspaces the user belongs to', async () => {
      const r = await get('/notifications');
      expect(r.status).toBe(200);
      const titles = (r.body.data as any[]).map((n) => n.title);
      expect(titles).toContain('acme note');
      expect(titles).not.toContain('bolt note');
    });

    it('Bob cannot see Alice notifications at all', async () => {
      const r = await get('/notifications', { token: 'bob-token' });
      expect(r.status).toBe(200);
      expect(r.body.data).toEqual([]);
    });
  });
  describe('search', () => {
    it('never returns another workspace\'s tasks, even with a stale grant', async () => {
      const r = await get(`/pm/search?workspace_id=${SHARED}&q=task`, { token: 'tina-token' });
      expect(r.status).toBe(200);
      const text = JSON.stringify(r.body);
      expect(text).toContain('Shared task');
      expect(text).not.toContain('Bolt secret task');
      expect(text).not.toContain('Acme task');
    });

    it('refuses searching a workspace the caller is not in', async () => {
      const r = await get(`/pm/search?workspace_id=${BOLT}&q=task`);
      expectRefused(r, 'Bolt secret task');
    });
  });

  describe('spaces, folders, lists and views', () => {
    it("refuses listing another workspace's spaces", async () => {
      expectRefused(await get(`/pm/spaces?workspace_id=${BOLT}`), 'Bolt space');
    });

    it("refuses reading another workspace's space, folder and list by id", async () => {
      expectRefused(await get(`/pm/spaces/${id(11)}`, { workspace: ACME }), 'Bolt space');
      expectRefused(await get(`/pm/folders?space_id=${id(11)}`, { workspace: ACME }), 'Bolt folder');
      expectRefused(await get(`/pm/folders/${id(15)}`, { workspace: ACME }), 'Bolt folder');
      expectRefused(await get(`/pm/lists/${id(21)}`, { workspace: ACME }), 'Bolt list');
      expectRefused(await get(`/pm/lists?space_id=${id(11)}`, { workspace: ACME }), 'Bolt list');
    });

    it("refuses reading or editing another workspace's list views", async () => {
      expectRefused(await get(`/pm/lists/${id(21)}/views`, { workspace: ACME }), 'Bolt view');
      expectRefused(await call('PUT', `/pm/views/${id(120)}`, { workspace: ACME, body: { name: 'pwned' } }), 'Bolt view');
    });
  });

  describe('goals', () => {
    it("refuses another workspace's goals", async () => {
      expectRefused(await get(`/pm/goals?workspace_id=${BOLT}`), 'Bolt goal');
      expectRefused(await get(`/pm/goals/${id(80)}/context`, { workspace: ACME }), 'Bolt goal', 'Bolt');
    });
  });

  describe('checklists and attachments', () => {
    it("refuses another workspace's task checklists", async () => {
      expectRefused(await get(`/pm/tasks/${id(31)}/checklists`, { workspace: ACME }), 'bolt checklist', 'bolt item');
    });

    it("refuses another workspace's task attachments", async () => {
      expectRefused(await get(`/pm/tasks/${id(31)}/attachments`, { workspace: ACME }), 'secret.pdf');
      expectRefused(await get(`/pm/task-attachments/${id(130)}/download`, { workspace: ACME }), 'secret.pdf');
    });
  });

  describe('huddles and notes', () => {
    it("refuses another workspace's huddle", async () => {
      expectRefused(await get(`/huddles/${id(90)}`, { workspace: ACME }), 'huddle-bolt', 'boltcode01');
      expectRefused(await get(`/huddles/active?channel_id=${id(41)}`, { workspace: ACME }), 'huddle-bolt');
    });

    it("refuses another workspace's note", async () => {
      expectRefused(await get(`/notes/${id(100)}`, { workspace: ACME }), 'bolt note page');
    });
  });

  describe('shared workspaces', () => {
    it('lets a talent member see the shared workspace spaces and channels', async () => {
      const spaces = await get(`/pm/spaces?workspace_id=${SHARED}`, { token: 'tina-token' });
      expect(spaces.status).toBe(200);
      expect(JSON.stringify(spaces.body)).toContain('Shared design space');
      const channels = await get(`/channels?workspace_id=${SHARED}`, { token: 'tina-token' });
      expect(channels.status).toBe(200);
      const names = (channels.body.data as any[]).map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(['design-room', 'shared-lobby']));
      expect((channels.body.data as any[]).every((c) => c.workspace_id === SHARED)).toBe(true);
    });

    it("keeps the talent out of the host business's private workspace", async () => {
      expectRefused(await get(`/pm/spaces?workspace_id=${ACME}`, { token: 'tina-token' }), 'Acme space');
      expectRefused(await get(`/pm/spaces/${id(10)}`, { token: 'tina-token', workspace: SHARED }), 'Acme space');
      expectRefused(await get(`/channels?workspace_id=${ACME}`, { token: 'tina-token' }), 'general');
      expectRefused(await get(`/messages?channel_id=${id(40)}`, { token: 'tina-token', workspace: SHARED }), 'hello acme');
    });

    it('admits owners of a linked participant account', async () => {
      const r = await get(`/channels?workspace_id=${SHARED}`, { token: 'bob-token' });
      expect(r.status).toBe(200);
      expect((r.body.data as any[]).map((c) => c.name)).toContain('shared-lobby');
    });

    it('a member removed from the shared workspace loses access despite stale grants', async () => {
      expectRefused(await get(`/pm/spaces?workspace_id=${SHARED}`, { token: 'ron-token' }), 'Shared design space');
      expectRefused(await get(`/pm/spaces/${id(12)}`, { token: 'ron-token' }), 'Shared design space');
      expectRefused(await get(`/channels?workspace_id=${SHARED}`, { token: 'ron-token' }), 'design-room');
      expectRefused(await get(`/messages?channel_id=${id(42)}`, { token: 'ron-token' }));
      expectRefused(await get(`/pm/tasks?list_id=${id(22)}`, { token: 'ron-token' }), 'Shared task');
    });

    it("a removed member can't touch their old timer sessions there", async () => {
      expectRefused(await get(`/timer/active?workspace_id=${SHARED}`, { token: 'ron-token' }));
      expectRefused(await call('DELETE', `/timer/sessions/${id(110)}`, { token: 'ron-token' }));
    });
  });

  describe('channel links', () => {
    it("can't link another workspace's channel to your own container", async () => {
      // Bob manages the Bolt space; linking Acme's #general to it would grant
      // every Bolt-space member access to Acme's channel.
      const r = await call('POST', '/channels/link', {
        token: 'bob-token',
        body: { resource_type: 'space', resource_id: id(11), channel_id: id(40) },
      });
      expect([403, 404]).toContain(r.status);
      const { db } = await import('./helpers/tenantFixture');
      expect(db.channels.find((c) => c.id === id(40))?.linked_resource_id).toBeUndefined();
      expect(db.resource_memberships.some((m) => m.resource_id === id(40))).toBe(false);
    });
  });

  describe('admin lock bypass', () => {
    it("an owner of one workspace can't bypass a lock in another", async () => {
      // Tina owns her talent account (active workspace) but is a plain member
      // of the shared workspace that holds the locked list.
      const r = await call('POST', '/pm/tasks', {
        token: 'tina-token',
        workspace: TALENT,
        body: { list_id: id(23), title: 'sneaky task' },
      });
      expect(r.status).toBe(403);
      expect(r.body.error).toMatch(/locked/i);
    });
  });
});
