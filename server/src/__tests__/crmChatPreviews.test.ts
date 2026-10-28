import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), member: true, channels: [] as Record<string, unknown>[], memberships: [] as { resource_id: string }[], closed: [] as { channel_id: string; closed_at: string }[] }));
vi.mock('../supabase', () => ({ supabaseAdmin: { from: db.from, rpc: db.rpc } }));
vi.mock('../middleware/auth', () => ({ requireAuth: (req: { userId?: string }, _res: unknown, next: () => void) => { req.userId = 'user'; next(); } }));
vi.mock('../middleware/permissions', () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  isWorkspaceAdmin: vi.fn(), checkResourceAccess: vi.fn(), meetsAccessLevel: vi.fn(), getUserPermissions: vi.fn(),
}));
import router from '../routes/channels';
let server: Server;
let base: string;
beforeAll(async () => {
  const app = express(); app.use(router);
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  vi.clearAllMocks(); db.member = true;
  db.channels = ['visible', 'closed', 'private'].map((id) => ({ id, name: id, linked_resource_type: 'crm_contact', linked_resource_id: 'contact' }));
  db.memberships = [{ resource_id: 'visible' }, { resource_id: 'closed' }];
  db.closed = [{ channel_id: 'closed', closed_at: '2026-01-01T00:00:00Z' }];
  db.rpc.mockResolvedValue({ data: [{ channel_id: 'visible', content: 'Latest', created_at: '2026-01-01T00:00:00Z' }], error: null });
  db.from.mockImplementation((table: string) => {
    const result = () => ({ data: table === 'channels' ? db.channels : table === 'resource_memberships' ? db.memberships : table === 'crm_chat_user_state' ? db.closed : [] });
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'in', 'order']) query[method] = () => query;
    query.maybeSingle = async () => ({ data: table === 'workspace_members' ? (db.member ? { user_id: 'user' } : null) : db.channels[0] });
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return query;
  });
});
describe('CRM chat previews', () => {
  it('requests only open member channels and retains the preview', async () => {
    const response = await fetch(base + '/crm?workspace_id=workspace');
    expect(response.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith('crm_chat_latest_messages', { p_channel_ids: ['visible'] });
    const body = await response.json() as { data: { channel_id: string; last_message_preview: string }[] };
    expect(body.data).toHaveLength(1); expect(body.data[0].last_message_preview).toBe('Latest');
    expect(db.from).not.toHaveBeenCalledWith('messages');
  });
  it('does not query previews when every channel is hidden', async () => {
    db.memberships = [];
    expect(await (await fetch(base + '/crm?workspace_id=workspace')).json()).toEqual({ success: true, data: [] });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('keeps channels with no messages and null previews', async () => {
    db.rpc.mockResolvedValue({ data: [], error: null });
    const body = await (await fetch(base + '/crm?workspace_id=workspace')).json() as { data: { last_message_preview: null; last_message_at: null }[] };
    expect(body.data[0]).toMatchObject({ last_message_preview: null, last_message_at: null });
  });
  it('fails visibly if the preview RPC is unavailable', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: 'Unavailable' } });
    expect((await fetch(base + '/crm?workspace_id=workspace')).status).toBe(500);
  });
  it('denies another workspace before querying previews', async () => {
    db.member = false;
    expect((await fetch(base + '/crm?workspace_id=other')).status).toBe(403);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('uses bounded previews for sibling chats, including closed member chats as before', async () => {
    const response = await fetch(base + '/crm/group?workspace_id=workspace&channel_id=visible');
    expect(response.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith('crm_chat_latest_messages', { p_channel_ids: ['visible', 'closed'] });
    expect(db.from).not.toHaveBeenCalledWith('messages');
  });
});
