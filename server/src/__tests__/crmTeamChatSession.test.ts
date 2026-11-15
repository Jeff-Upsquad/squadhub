import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/auth', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers.authorization !== 'Bearer hub-session') {
      res.status(401).json({ success: false, error: 'Invalid Hub session' });
      return;
    }
    next();
  },
}));
vi.mock('../middleware/miniApp', () => ({
  requireAnyMiniAppOrAdmin: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import router from '../routes/crm-teamchat';

let hub: Server, crm: Server, base: string;
let upstreamStatus = 200, upstreamCalls = 0;
const listen = (app: express.Express) => new Promise<Server>((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});
const origin = (server: Server) => `http://127.0.0.1:${(server.address() as { port: number }).port}`;
beforeAll(async () => {
  const upstream = express();
  upstream.use((_req, res) => {
    upstreamCalls++;
    res.status(upstreamStatus).json(upstreamStatus === 200 ? { success: true, data: { unread: 3 } } : { error: 'Invalid CRM token' });
  });
  crm = await listen(upstream);
  vi.stubEnv('CRM_API_URL', origin(crm)); vi.stubEnv('SHCRM_API_URL', origin(crm));
  const app = express(); app.use(router); hub = await listen(app); base = origin(hub);
});
beforeEach(() => { upstreamStatus = 200; upstreamCalls = 0; });
afterAll(async () => {
  vi.unstubAllEnvs();
  await Promise.all([hub, crm].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});
describe('CRM authentication failures do not expire Hub sessions', () => {
  it.each(['crm', 'shcrm'])('reports %s token rejection as an integration error', async source => {
    upstreamStatus = 401;
    const response = await fetch(`${base}/${source}/unread`, { headers: { authorization: 'Bearer hub-session' } });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ success: false, code: 'CRM_AUTH_REJECTED' });
    expect(upstreamCalls).toBe(1);
  });
  it('retains Hub authentication failures before contacting the CRM', async () => {
    const response = await fetch(`${base}/crm/unread`);
    expect(response.status).toBe(401); expect(upstreamCalls).toBe(0);
  });
  it('preserves successful chat responses', async () => {
    const response = await fetch(`${base}/crm/unread`, { headers: { authorization: 'Bearer hub-session' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { unread: 3 } });
  });
});
