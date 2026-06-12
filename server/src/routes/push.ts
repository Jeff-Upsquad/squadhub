import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';
import { requireAuth } from '../middleware/auth';

// Device push tokens for the native partner app (in.squadhub.partner). Distinct
// from the Squad Chat tokens (/chat/push) — these drive pushes mirrored from the
// `notifications` table (task updates + chat). See server/src/push/partnerPush.ts.
const router = Router();
router.use(requireAuth);

const registerSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['ios', 'android']).optional().default('android'),
});

const unregisterSchema = z.object({
  token: z.string().min(1),
});

// POST /push/register — upsert this device's token.
router.post('/register', async (req: Request, res: Response) => {
  try {
    const body = registerSchema.parse(req.body);
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

export default router;
