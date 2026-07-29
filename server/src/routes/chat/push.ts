import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { supabaseAdmin } from '../../supabase-chat';

const router = Router();

const registerSchema = z.object({
  token: z.string().min(1),
  app_variant: z.enum(['clients', 'team']),
  platform: z.enum(['ios', 'android']),
  provider: z.enum(['expo', 'fcm']).optional().default('expo'),
});

const unregisterSchema = z.object({
  token: z.string().min(1),
});

// POST /chat/push/register — upsert device token
router.post('/register', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = registerSchema.parse(req.body);

    // A device token identifies one physical install, so it must map to exactly
    // one user. Switching accounts on the same device re-registers the same
    // token under the new user; evict any prior owner or the previous account
    // keeps receiving this device's chat pushes.
    await supabaseAdmin
      .from('chat_push_tokens')
      .delete()
      .eq('token', body.token)
      .neq('user_id', req.userId!);

    const { error } = await supabaseAdmin
      .from('chat_push_tokens')
      .upsert(
        {
          user_id: req.userId!,
          token: body.token,
          app_variant: body.app_variant,
          platform: body.platform,
          provider: body.provider,
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

// POST /chat/push/unregister — delete token on logout
router.post('/unregister', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = unregisterSchema.parse(req.body);
    await supabaseAdmin
      .from('chat_push_tokens')
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
