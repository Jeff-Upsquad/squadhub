import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireMiniAppOrAdmin } from '../middleware/miniApp';
import { getCardsAttention } from '../utils/cardAttention';

/**
 * The Requirement Cards sidebar badge, for all three apps that show it: the
 * admin panel, the Requirement Cards mini app, and Squad CRM (which frames the
 * module and so has no way to count client-side).
 *
 * One number from one place — a per-app count would drift the first time a
 * lifecycle rule moved.
 */
const router = Router();

router.use(requireAuth);
router.use(requireMiniAppOrAdmin('leads'));

// GET /admin/cards/attention → { total, parts, by_pipeline }
router.get('/attention', async (_req: Request, res: Response) => {
  const data = await getCardsAttention();
  res.json({ success: true, data });
});

export default router;
