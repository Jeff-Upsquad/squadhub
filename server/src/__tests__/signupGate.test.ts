/**
 * Self-serve signup is gated by PUBLIC_SIGNUP_ENABLED (default off): only
 * emails with a pending workspace invitation may register; everyone else is
 * told to come in through SquadHire.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import type { AddressInfo } from 'net';

vi.mock('../supabase', async () => {
  const { createFakeSupabase } = await import('./helpers/fakeSupabase');
  const db = {
    invitations: [
      { id: 'inv-1', email: 'invited@example.test', status: 'pending', expires_at: '2999-01-01T00:00:00Z' },
      { id: 'inv-2', email: 'expired@example.test', status: 'pending', expires_at: '2000-01-01T00:00:00Z' },
    ],
  };
  const fake = createFakeSupabase(db, {});
  // Reaching createUser means the gate let the request through.
  (fake.supabaseAdmin.auth as any).admin = {
    createUser: async () => ({ data: { user: null }, error: { message: 'stub: gate passed' } }),
  };
  return fake;
});

let server: http.Server;
let base = '';
let config: { publicSignupEnabled: boolean };

beforeAll(async () => {
  ({ config } = (await import('../config')) as any);
  const { default: authRouter } = await import('../routes/auth');
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
});

const register = async (email: string) => {
  const res = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', display_name: 'New Person' }),
  });
  return { status: res.status, body: (await res.json()) as any };
};

describe('signup gate', () => {
  it('is closed by default', async () => {
    expect(config.publicSignupEnabled).toBe(false);
    const res = await fetch(`${base}/auth/signup-config`);
    expect(((await res.json()) as any).data).toEqual({ public_signup_enabled: false });
  });

  it('refuses uninvited and expired-invite emails with a SquadHire pointer', async () => {
    for (const email of ['stranger@example.test', 'expired@example.test']) {
      const r = await register(email);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('SIGNUP_DISABLED');
      expect(r.body.error).toMatch(/SquadHire/);
    }
  });

  it('still lets a workspace invitee create their account', async () => {
    const r = await register('INVITED@example.test');
    expect(r.status).not.toBe(403);
    expect(r.body.error).toBe('stub: gate passed');
  });

  it('opens for everyone when PUBLIC_SIGNUP_ENABLED is on', async () => {
    config.publicSignupEnabled = true;
    try {
      const r = await register('stranger@example.test');
      expect(r.status).not.toBe(403);
      const res = await fetch(`${base}/auth/signup-config`);
      expect(((await res.json()) as any).data.public_signup_enabled).toBe(true);
    } finally {
      config.publicSignupEnabled = false;
    }
  });
});
