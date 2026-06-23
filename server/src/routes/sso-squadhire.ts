import { Router, Request, Response, NextFunction } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';
import { config } from '../config';
import type { UserType } from '@squadhub/shared';

/**
 * "Sign in with SquadHub" — SquadHub acts as the identity provider for
 * SquadHire's (Profiles') /staff portal.
 *
 * Flow (OIDC-lite, one-time code with server-to-server exchange):
 *   1. SquadHire redirects the browser to SquadHub's frontend authorize page.
 *   2. That page (with the user's live Supabase session) POSTs here to
 *      /sso/squadhire/authorize. We confirm the user is eligible and mint a
 *      short-lived, single-use code, then hand back a redirect URL.
 *   3. The browser lands back on SquadHire with ?code=...&state=...
 *   4. SquadHire's backend calls POST /sso/squadhire/token (shared secret,
 *      server-to-server) to exchange the code for the user's identity. The
 *      password never leaves SquadHub.
 *
 * /directory is a separate, secret-gated read used by SquadHire's admin to
 * search-and-pick which SquadHub users to grant staff access to.
 */

const router = Router();

// Only these SquadHub user types may be provisioned as / sign in as SquadHire
// staff: SquadHub's own team (internal) and partner-side people.
const SSO_ELIGIBLE_TYPES: readonly UserType[] = ['internal', 'partner', 'partner_employee'] as const;

const CODE_TTL_MS = 120_000; // 2 minutes

// --- shared-secret gate for the server-to-server endpoints (token, directory).
// Mirrors verifySquadhireCallbackSecret in squadhire-callbacks.ts: SquadHire
// signs with the same secret it uses for its other callbacks to us.
const HEADER_NAME = 'x-squadhub-signature';

function verifySquadhireSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = config.squadhireCallbackSecret;
  if (!expected) {
    res.status(503).json({ success: false, error: 'SquadHire callback secret not configured' });
    return;
  }
  const provided = req.header(HEADER_NAME) ?? req.header('X-SquadHub-Signature');
  if (typeof provided !== 'string' || provided.length === 0) {
    res.status(401).json({ success: false, error: 'Missing signature' });
    return;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ success: false, error: 'Invalid signature' });
    return;
  }
  next();
}

function isAllowedRedirect(redirectUri: string): boolean {
  // Exact-match against the configured allowlist — never substring/prefix match,
  // which would be an open-redirect hole.
  return config.squadhireSsoRedirectUris.includes(redirectUri);
}

// ------------------------------------------------------------
// POST /sso/squadhire/authorize  (browser, requires SquadHub login)
// Mints a one-time code for an eligible, active SquadHub user.
// ------------------------------------------------------------

const authorizeSchema = z
  .object({
    redirect_uri: z.string().url(),
    state: z.string().min(1).max(512),
  })
  .strict();

router.post('/authorize', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = authorizeSchema.parse(req.body);

    if (!isAllowedRedirect(body.redirect_uri)) {
      res.status(400).json({ success: false, error: 'redirect_uri not allowed' });
      return;
    }

    // requireAuth already loaded the user; re-read the canonical row so the
    // eligibility decision is based on current type + status, not cached claims.
    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id, email, display_name, user_type, status')
      .eq('id', req.userId as string)
      .single();
    if (userErr || !user) {
      res.status(401).json({ success: false, error: 'User not found' });
      return;
    }

    if (user.status !== 'active') {
      res.status(403).json({ success: false, error: 'Account is not active' });
      return;
    }
    if (!SSO_ELIGIBLE_TYPES.includes(user.user_type as UserType)) {
      res.status(403).json({ success: false, error: 'This account type cannot access SquadHire staff' });
      return;
    }
    if (!user.email) {
      res.status(400).json({ success: false, error: 'Account has no email on file' });
      return;
    }

    const code = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

    const { error: insErr } = await supabaseAdmin.from('squadhire_sso_codes').insert({
      code,
      user_id: user.id,
      email: user.email,
      display_name: user.display_name ?? null,
      user_type: user.user_type,
      redirect_uri: body.redirect_uri,
      expires_at: expiresAt,
    });
    if (insErr) {
      res.status(500).json({ success: false, error: insErr.message });
      return;
    }

    const sep = body.redirect_uri.includes('?') ? '&' : '?';
    const redirect = `${body.redirect_uri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(body.state)}`;
    res.json({ success: true, redirect });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('[sso-squadhire authorize] error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ------------------------------------------------------------
// POST /sso/squadhire/token  (server-to-server, shared secret)
// Exchanges a one-time code for the user's identity. Single use.
// ------------------------------------------------------------

const tokenSchema = z.object({ code: z.string().min(1) }).strict();

router.post('/token', verifySquadhireSecret, async (req: Request, res: Response) => {
  try {
    const body = tokenSchema.parse(req.body);

    // Atomically consume: only succeeds if the code exists, is unconsumed and
    // unexpired. RETURNING gives us the identity in the same round-trip.
    const { data: row, error } = await supabaseAdmin
      .from('squadhire_sso_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('code', body.code)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('user_id, email, display_name, user_type')
      .maybeSingle();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!row) {
      res.status(400).json({ success: false, error: 'Invalid, expired, or already-used code' });
      return;
    }

    res.json({
      success: true,
      user: {
        id: row.user_id,
        email: row.email,
        name: row.display_name,
        user_type: row.user_type,
      },
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('[sso-squadhire token] error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ------------------------------------------------------------
// GET /sso/squadhire/directory  (server-to-server, shared secret)
// Search-and-pick list of eligible users for SquadHire's admin to grant
// staff access to. Returns no credentials — identity + org context only.
// ------------------------------------------------------------

router.get('/directory', verifySquadhireSecret, async (req: Request, res: Response) => {
  try {
    const search = ((req.query.search as string) || '').trim();
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));

    let query = supabaseAdmin
      .from('users')
      .select('id, email, display_name, user_type')
      .in('user_type', SSO_ELIGIBLE_TYPES as unknown as string[])
      .eq('status', 'active')
      .order('display_name', { ascending: true })
      .limit(limit);

    if (search) {
      query = query.or(`display_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data: users, error } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Best-effort org context for partner-side people (first assigned client).
    const partnerIds = (users || [])
      .filter((u: any) => u.user_type === 'partner' || u.user_type === 'partner_employee')
      .map((u: any) => u.id);

    const orgByUser: Record<string, string> = {};
    if (partnerIds.length > 0) {
      const { data: assignments } = await supabaseAdmin
        .from('partner_client_assignments')
        .select('user_id, clients(business_name)')
        .in('user_id', partnerIds);
      (assignments || []).forEach((a: any) => {
        if (!orgByUser[a.user_id] && a.clients?.business_name) {
          orgByUser[a.user_id] = a.clients.business_name;
        }
      });
    }

    const result = (users || []).map((u: any) => ({
      id: u.id,
      email: u.email,
      name: u.display_name || u.email,
      user_type: u.user_type,
      partner_org: orgByUser[u.id] || null,
    }));

    res.json({ success: true, users: result });
  } catch (err: any) {
    console.error('[sso-squadhire directory] error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
