import { Router, Request, Response } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requireSalesLeadsAccess } from '../onboarding-links';
import {
  fetchSquadhireCategories,
  clearSquadhireCategoriesCache,
} from '../../utils/squadhireCategories';

/**
 * Signed read-through proxy for SquadHire's category list.
 *
 * The subscription-card drawer uses this to populate a multi-select picker
 * so admins pick real SquadHire category IDs (which then flow into
 * match_rules.category_ids on publish). Gated behind the same sales-leads
 * app gate as the card editor itself.
 *
 * The actual fetch + cache live in utils/squadhireCategories.ts so the
 * profile-access list-hydration path can share the same cache without
 * doing internal HTTP roundtrips.
 */

const router = Router();

router.use(requireAuth);

router.get('/categories', requireSalesLeadsAccess, async (_req: Request, res: Response) => {
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
});

// Re-export for tests / ops (kept for backwards compatibility with whatever
// already imports it).
export { clearSquadhireCategoriesCache };

export default router;
