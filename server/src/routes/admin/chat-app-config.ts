import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/admin';
import { supabaseAdmin } from '../../supabase-chat';

const router = Router();
router.use(requireAuth, requireAdmin);

const putSchema = z.object({
  min_version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semver X.Y.Z'),
  download_url: z.string().url().nullable().optional(),
});

// GET /admin/chat/app-config
router.get('/', async (_req: Request, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('chat_app_config')
    .select('variant, min_version, download_url, updated_by, updated_at')
    .order('variant');
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true, data });
});

// PUT /admin/chat/app-config/:variant
router.put('/:variant', async (req: Request, res: Response) => {
  const variant = req.params.variant;
  if (variant !== 'clients' && variant !== 'team') {
    res.status(400).json({ success: false, error: 'variant must be clients or team' });
    return;
  }
  try {
    const body = putSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('chat_app_config')
      .update({
        min_version: body.min_version,
        download_url: body.download_url ?? null,
        updated_by: req.userId,
        updated_at: new Date().toISOString(),
      })
      .eq('variant', variant)
      .select()
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
