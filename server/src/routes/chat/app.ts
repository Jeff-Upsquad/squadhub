import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../../supabase-chat';
import type { ChatAppVariant } from '@squadhub/shared';

const router = Router();

// Public — client apps call this at boot and on resume to check for forced updates.
router.get('/config', async (req: Request, res: Response) => {
  const variant = req.query.variant as string;
  if (variant !== 'clients' && variant !== 'team') {
    res.status(400).json({ success: false, error: 'variant must be clients or team' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('chat_app_config')
    .select('variant, min_version, download_url, updated_at')
    .eq('variant', variant as ChatAppVariant)
    .single();

  if (error || !data) {
    // Fallback to defaults if row somehow missing.
    res.json({
      variant,
      min_version: '1.0.0',
      download_url: null,
      updated_at: new Date().toISOString(),
    });
    return;
  }

  res.json(data);
});

export default router;
