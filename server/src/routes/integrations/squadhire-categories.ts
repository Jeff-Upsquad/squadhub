import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { requireAdmin } from '../../middleware/admin';
import { requireMiniAppOrAdmin, requireAnyMiniAppOrAdmin } from '../../middleware/miniApp';
import {
  fetchSquadhireCategories,
  clearSquadhireCategoriesCache,
} from '../../utils/squadhireCategories';
import { lookupSquadhireUsers } from '../../utils/squadhireLookup';
import { config } from '../../config';

/**
 * Admin-facing proxy for SquadHire integration data.
 *
 * /categories     — category picker for subscription cards
 * /config         — tells the frontend whether SquadHire linking is available
 * /lookup-users   — batch email→talent lookup for partner↔talent linking
 */

const router = Router();

router.use(requireAuth);

// Categories are REQUIRED to publish a card, and three modules need them:
// Sales Leads, the Leads mini app, and admins. The old sales-leads-only gate
// locked out admins who lack that module (see the note on
// /admin/job-cards/squadhire-categories, which exists to work around it).
router.get(
  '/categories',
  requireAnyMiniAppOrAdmin(['sales-leads', 'leads']),
  async (_req: Request, res: Response) => {
  try {
    const { data, cached } = await fetchSquadhireCategories();
    res.json({ success: true, data, cached });
    } catch (err: any) {
      console.error('[squadhire-categories] fetch failed:', err);
      res.status(502).json({
        success: false,
        error: err?.message || 'Failed to load SquadHire categories',
      });
    }
  },
);

// ── SquadHire config (admin + Leads mini app) ──
// Reports whether SquadHire linking is available; the Leads modules read it to
// decide whether to offer the "open in SquadHire" affordances.

router.get('/config', requireMiniAppOrAdmin('leads'), (_req: Request, res: Response) => {
  const adminUrl = config.squadhireAdminUrl || null;
  const configured = !!(adminUrl && config.squadhireWebhookUrl && config.squadhireWebhookSecret);
  res.json({ success: true, data: { admin_url: adminUrl, configured } });
});

// ── Batch email→talent lookup (admin-only) ──

const lookupSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(50),
});

router.post('/lookup-users', requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = lookupSchema.parse(req.body);
    const results = await lookupSquadhireUsers(body.emails);
    const data: Record<string, { talent_user_id: string; name: string }> = {};
    for (const [email, match] of results) {
      data[email] = match;
    }
    res.json({ success: true, data });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('[squadhire-lookup] error:', err);
    res.json({ success: true, data: {}, note: err?.message || 'Lookup failed' });
  }
});

// Re-export for tests / ops (kept for backwards compatibility with whatever
// already imports it).
export { clearSquadhireCategoriesCache };

export default router;
