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
import { ALICE, BOB, ACME, BOLT, id } from './helpers/tenantFixture';

vi.mock('../supabase', async () => {
  const { createFakeSupabase } = await import('./helpers/fakeSupabase');
  const fx = await import('./helpers/tenantFixture');
  return createFakeSupabase(fx.db, { 'alice-token': fx.ALICE, 'bob-token': fx.BOB });
});

let server: http.Server;
let base = '';

beforeAll(async () => {
  const { default: tasksRouter } = await import('../routes/pm/tasks');
  const { default: messagesRouter } = await import('../routes/messages');
  const { default: channelsRouter } = await import('../routes/channels');
  const { default: notificationsRouter } = await import('../routes/notifications');
  const app = express();
  app.use(express.json());
  app.use('/pm', tasksRouter);
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

async function get(path: string, opts: { token?: string; workspace?: string } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${opts.token ?? 'alice-token'}` };
  if (opts.workspace) headers['X-Workspace-Id'] = opts.workspace;
  const res = await fetch(base + path, { headers });
  const body: any = await res.json().catch(() => null);
  return { status: res.status, body };
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
});
