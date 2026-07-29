import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { config } from '../config';
import { requireAuth } from '../middleware/auth';

// Device push tokens for the native partner app (in.squadhub.partner). Distinct
// from the Squad Chat tokens (/chat/push) — these drive pushes mirrored from the
// `notifications` table (task updates + chat). See server/src/push/partnerPush.ts.
// Also hosts the browser Web Push routes (/push/web-*) for the installable PWA;
// see server/src/push/webPush.ts.
const router = Router();
router.use(requireAuth);

const registerSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['ios', 'android']).optional().default('android'),
});

const unregisterSchema = z.object({
  token: z.string().min(1),
});

// Browser PushSubscription: the endpoint + the two encryption keys the
// `web-push` library needs (sub.toJSON().keys.{p256dh,auth}).
const webRegisterSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

const webUnregisterSchema = z.object({
  endpoint: z.string().min(1),
});

// POST /push/register — upsert this device's token.
router.post('/register', async (req: Request, res: Response) => {
  try {
    const body = registerSchema.parse(req.body);
    // A device's FCM token identifies one physical install, so it must belong to
    // exactly one user. When the app switches accounts on the same device it
    // re-registers the same token under the new user; evict any prior owner here
    // or the previous account keeps receiving this device's pushes (a logged-out
    // user's chat notifications leaking onto whoever logged in next).
    await supabaseAdmin
      .from('partner_push_tokens')
      .delete()
      .eq('token', body.token)
      .neq('user_id', req.userId!);
    const { error } = await supabaseAdmin
      .from('partner_push_tokens')
      .upsert(
        {
          user_id: req.userId!,
          token: body.token,
          platform: body.platform,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,token' },
      );
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /push/unregister — drop a token on logout.
router.post('/unregister', async (req: Request, res: Response) => {
  try {
    const body = unregisterSchema.parse(req.body);
    await supabaseAdmin
      .from('partner_push_tokens')
      .delete()
      .eq('user_id', req.userId!)
      .eq('token', body.token);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---- Browser Web Push (installable PWA) ----

// GET /push/vapid-public-key — the browser needs this to call
// pushManager.subscribe(). Not secret. null when web push isn't configured.
router.get('/vapid-public-key', (_req: Request, res: Response) => {
  res.json({ success: true, key: config.webPushVapidPublicKey || null });
});

// POST /push/web-register — upsert this browser's PushSubscription.
router.post('/web-register', async (req: Request, res: Response) => {
  try {
    const body = webRegisterSchema.parse(req.body);
    // A browser PushSubscription endpoint is per-browser-install, not per-user:
    // logging in as a different account in the same PWA reuses it. Evict any
    // prior owner so a signed-out account stops getting this browser's pushes.
    await supabaseAdmin
      .from('web_push_subscriptions')
      .delete()
      .eq('endpoint', body.endpoint)
      .neq('user_id', req.userId!);
    const { error } = await supabaseAdmin
      .from('web_push_subscriptions')
      .upsert(
        {
          user_id: req.userId!,
          endpoint: body.endpoint,
          p256dh: body.p256dh,
          auth: body.auth,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,endpoint' },
      );
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /push/web-unregister — drop a subscription on disable/logout.
router.post('/web-unregister', async (req: Request, res: Response) => {
  try {
    const body = webUnregisterSchema.parse(req.body);
    await supabaseAdmin
      .from('web_push_subscriptions')
      .delete()
      .eq('user_id', req.userId!)
      .eq('endpoint', body.endpoint);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
