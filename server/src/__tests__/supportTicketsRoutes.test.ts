import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

// Regression guard for the Support desk HTTP flows after create / reply /
// close moved into shared *Core helpers (reused by the Squad Hub SaaS bridge).
// With the bridge unconfigured these must behave exactly as before: same rows
// written, same notifications, same error surface, and no outbound SaaS call.

type Op = { table: string; op: string; payload?: any; filters: [string, unknown][] };

const db = vi.hoisted(() => ({
  ops: [] as Op[],
  ticket: null as any,
  failMessageInsert: false,
  failChannelInsert: false,
  existingChannel: true as boolean,
}));

vi.mock('../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = req.headers['x-test-user'] || 'user-1';
    req.userType = 'internal';
    next();
  },
}));
vi.mock('../middleware/miniApp', () => ({
  requireMiniAppOrAdmin: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../utils/roles', () => ({ getUserIdsByRoleId: async () => [] }));

const access = vi.hoisted(() => ({ ensureChannelMember: vi.fn(async () => undefined) }));
vi.mock('../utils/supportAccess', () => ({
  isSupportAgent: async (id: string) => id === 'agent-1',
  ensureChannelMember: access.ensureChannelMember,
  isSupportChannel: async () => false,
  userOwnsSupportTicketRoot: async () => false,
}));

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const rec: Op = { table, op: 'select', filters: [] };
      db.ops.push(rec);
      const result = (): { data: any; error: any } => {
        if (rec.op === 'insert') {
          if (table === 'messages') {
            if (db.failMessageInsert) return { data: null, error: { message: 'messages insert exploded' } };
            return { data: { id: 'msg-1', ...rec.payload }, error: null };
          }
          if (table === 'channels') {
            if (db.failChannelInsert) return { data: null, error: { message: 'secret channel detail' } };
            return { data: { id: 'ch-new' }, error: null };
          }
          if (table === 'support_tickets') return { data: { id: 'tk-1', ticket_number: 7, ...rec.payload }, error: null };
          return { data: null, error: null };
        }
        if (rec.op === 'update') return { data: { ...(db.ticket || {}), ...rec.payload }, error: null };
        if (table === 'channels') return { data: db.existingChannel ? { id: 'ch-1' } : null, error: null };
        if (table === 'support_ticket_routing') return { data: { assignee_id: 'agent-1' }, error: null };
        if (table === 'support_tickets') return { data: db.ticket, error: null };
        return { data: null, error: null };
      };
      const q: any = {
        select: () => q,
        insert: (payload: any) => { rec.op = 'insert'; rec.payload = payload; return q; },
        update: (payload: any) => { rec.op = 'update'; rec.payload = payload; return q; },
        eq: (k: string, v: unknown) => { rec.filters.push([k, v]); return q; },
        is: () => q,
        in: () => q,
        not: () => q,
        order: () => q,
        limit: () => q,
        single: async () => result(),
        maybeSingle: async () => result(),
        then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
      };
      return q;
    },
  },
}));

import router from '../routes/support';

let server: Server;
let base = '';
const realFetch = globalThis.fetch;
const outbound: string[] = [];

async function call(method: string, path: string, body?: unknown, user = 'user-1') {
  const r = await realFetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-test-user': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as any };
}

const ops = (table: string, op: string) => db.ops.filter((o) => o.table === table && o.op === op);

beforeAll(async () => {
  delete process.env.SAAS_BRIDGE_SECRET;
  delete process.env.SAAS_API_URL;
  const app = express();
  app.use(express.json());
  app.use('/support', router);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(base)) outbound.push(url);
    return realFetch(input, init);
  }) as typeof fetch;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  db.ops = [];
  db.failMessageInsert = false;
  db.failChannelInsert = false;
  db.existingChannel = true;
  db.ticket = {
    id: 'tk-1', ticket_number: 7, channel_id: 'ch-1', root_message_id: 'root-1',
    created_by: 'user-1', assigned_to: 'agent-1', status: 'open',
  };
  outbound.length = 0;
  access.ensureChannelMember.mockClear();
});

describe('POST /support/tickets', () => {
  const payload = { workspace_id: '11111111-1111-4111-8111-111111111111', category: 'technical', subject: 'Login broken', description: 'Cannot sign in' };

  it('opens the thread, auto-assigns and notifies exactly as before', async () => {
    const r = await call('POST', '/support/tickets', payload);
    expect(r.status).toBe(201);
    expect(access.ensureChannelMember).toHaveBeenCalledWith('ch-1', 'user-1');

    const [root] = ops('messages', 'insert');
    expect(root.payload).toEqual({ channel_id: 'ch-1', sender_id: 'user-1', content: 'Cannot sign in', type: 'text', mentions: [] });

    const [ticket] = ops('support_tickets', 'insert');
    expect(ticket.payload).toMatchObject({
      workspace_id: '11111111-1111-4111-8111-111111111111', channel_id: 'ch-1', root_message_id: 'msg-1', category: 'technical',
      subject: 'Login broken', priority: 'normal', created_by: 'user-1', assigned_to: 'agent-1',
    });
    expect(ticket.payload).not.toHaveProperty('external_requester_id');

    const [notif] = ops('notifications', 'insert');
    expect(notif.payload).toEqual([
      expect.objectContaining({ user_id: 'agent-1', type: 'support_ticket_assigned', title: 'New Technical ticket assigned to you', body: 'SUP-7: Login broken', actor_id: 'user-1' }),
    ]);
    expect(outbound).toEqual([]);
  });

  it('still returns the DB error message when the opening message fails', async () => {
    db.failMessageInsert = true;
    const r = await call('POST', '/support/tickets', payload);
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ success: false, error: 'messages insert exploded' });
    expect(ops('support_tickets', 'insert')).toHaveLength(0);
  });

  it('keeps other failures generic (no internal detail leaked)', async () => {
    db.existingChannel = false;
    db.failChannelInsert = true;
    const r = await call('POST', '/support/tickets', payload);
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ success: false, error: 'Internal server error' });
  });
});

describe('POST /support/tickets/:id/messages', () => {
  it('replies in the thread, syncs the index + activity and notifies the other side', async () => {
    const r = await call('POST', '/support/tickets/tk-1/messages', { content: 'On it' }, 'agent-1');
    expect(r.status).toBe(201);
    const [msg] = ops('messages', 'insert');
    expect(msg.payload).toEqual({
      channel_id: 'ch-1', sender_id: 'agent-1', content: 'On it', type: 'text', file_url: null, mentions: [], parent_message_id: 'root-1',
    });
    expect(ops('message_threads', 'insert')[0].payload).toEqual({ parent_message_id: 'root-1', reply_message_id: 'msg-1' });
    expect(ops('support_tickets', 'update')[0].filters).toEqual([['id', 'tk-1']]);
    const [notif] = ops('notifications', 'insert');
    expect(notif.payload).toEqual([
      expect.objectContaining({ user_id: 'user-1', type: 'support_ticket_reply', title: 'New reply on SUP-7', body: 'On it' }),
    ]);
    expect(outbound).toEqual([]);
  });

  it('keeps the 409 for a ticket without a conversation root', async () => {
    db.ticket.root_message_id = null;
    const r = await call('POST', '/support/tickets/tk-1/messages', { content: 'x' });
    expect(r.status).toBe(409);
    expect(ops('messages', 'insert')).toHaveLength(0);
  });

  it('denies users who are not creator, assignee or agent', async () => {
    const r = await call('POST', '/support/tickets/tk-1/messages', { content: 'x' }, 'stranger');
    expect(r.status).toBe(403);
  });
});

describe('POST /support/tickets/:id/close + /reopen', () => {
  it('closes with the actor recorded, then reopens clearing it', async () => {
    const c = await call('POST', '/support/tickets/tk-1/close');
    expect(c.status).toBe(200);
    expect(ops('support_tickets', 'update')[0].payload).toMatchObject({ status: 'closed', closed_by: 'user-1' });
    db.ops = [];
    const o = await call('POST', '/support/tickets/tk-1/reopen');
    expect(o.status).toBe(200);
    expect(ops('support_tickets', 'update')[0].payload).toMatchObject({ status: 'open', closed_by: null, closed_at: null });
    expect(outbound).toEqual([]);
  });
});
