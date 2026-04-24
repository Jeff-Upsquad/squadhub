import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';
import { requireSalesLeadsAccess, resolveLeadForUser } from './onboarding-links';
import {
  getOrCreateDraftCard,
  hydrateCard,
  matchPartnersForCard,
} from '../utils/subscriptionCards';

const router = Router();

router.use(requireAuth);

// ------------------------------------------------------------
// Schemas
// ------------------------------------------------------------
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const PARTNER_TIERS = ['Junior', 'Pro', 'Elite', 'Custom'] as const;

const customDeliverableSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  kind: z.enum(['hours', 'item']),
  per_day: z.number().min(0),
  per_week: z.number().min(0),
  per_month: z.number().min(0),
});

const patchCardSchema = z.object({
  working_days: z.array(z.enum(WEEK_DAYS)).optional(),
  brand_name: z.string().max(200).nullable().optional(),
  business_nature: z.string().max(500).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  custom_deliverables: z.array(customDeliverableSchema).optional(),
});

const targetsSchema = z.object({
  target_tiers: z.array(z.enum(PARTNER_TIERS)),
  min_experience_years: z.number().int().min(0),
  target_languages: z.array(z.string().min(1).max(20)),
  target_country_ids: z.array(z.string().uuid()),
  target_regions: z.array(z.object({
    country_id: z.string().uuid(),
    region: z.string().min(1).max(100),
  })),
});

// ------------------------------------------------------------
// Load a card and check the caller has access to its lead.
// Returns { card, submissionId } or sends error and returns null.
// ------------------------------------------------------------
async function loadCardForUser(
  cardId: string,
  userId: string,
  res: Response,
): Promise<{ card: any; submissionId: string } | null> {
  const { data: card, error } = await supabaseAdmin
    .from('subscription_cards')
    .select('*, client_submission_subscriptions!inner(submission_id)')
    .eq('id', cardId)
    .maybeSingle();
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return null;
  }
  if (!card) {
    res.status(404).json({ success: false, error: 'Card not found' });
    return null;
  }
  const submissionId: string = card.client_submission_subscriptions.submission_id;

  const guard = await resolveLeadForUser(submissionId, userId);
  if (!guard.ok) {
    res.status(guard.code).json({ success: false, error: guard.error });
    return null;
  }

  // Strip the nested join before returning to callers.
  const { client_submission_subscriptions, ...rest } = card;
  return { card: rest, submissionId };
}

// ============================================================
// GET /subscription-cards/by-submission-sub/:id — return or lazily create draft
// ============================================================
router.get(
  '/by-submission-sub/:id',
  requireSalesLeadsAccess,
  async (req: Request, res: Response) => {
    try {
      const submissionSubId = req.params.id as string;
      const { data: staged, error: stagedErr } = await supabaseAdmin
        .from('client_submission_subscriptions')
        .select('submission_id')
        .eq('id', submissionSubId)
        .maybeSingle();
      if (stagedErr) {
        res.status(500).json({ success: false, error: stagedErr.message });
        return;
      }
      if (!staged) {
        res.status(404).json({ success: false, error: 'Staged subscription not found' });
        return;
      }
      const guard = await resolveLeadForUser(staged.submission_id, req.userId!);
      if (!guard.ok) {
        res.status(guard.code).json({ success: false, error: guard.error });
        return;
      }
      const card = await getOrCreateDraftCard(submissionSubId);
      res.json({ success: true, data: card });
    } catch (err: any) {
      console.error('Get card error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// ============================================================
// PATCH /subscription-cards/:id — edit draft scalar fields
// ============================================================
router.patch(
  '/:id',
  requireSalesLeadsAccess,
  async (req: Request, res: Response) => {
    try {
      const body = patchCardSchema.parse(req.body);
      const loaded = await loadCardForUser(req.params.id as string, req.userId!, res);
      if (!loaded) return;
      if (loaded.card.state !== 'draft') {
        res.status(409).json({ success: false, error: 'Card is not editable (not in draft)' });
        return;
      }
      const { error } = await supabaseAdmin
        .from('subscription_cards')
        .update(body)
        .eq('id', req.params.id as string);
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      const { data: fresh } = await supabaseAdmin
        .from('subscription_cards')
        .select('*')
        .eq('id', (req.params.id as string))
        .single();
      res.json({ success: true, data: await hydrateCard(fresh) });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      console.error('Patch card error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// ============================================================
// PUT /subscription-cards/:id/targets — atomic targeting replace
// ============================================================
router.put(
  '/:id/targets',
  requireSalesLeadsAccess,
  async (req: Request, res: Response) => {
    try {
      const body = targetsSchema.parse(req.body);
      const loaded = await loadCardForUser(req.params.id as string, req.userId!, res);
      if (!loaded) return;
      if (loaded.card.state !== 'draft') {
        res.status(409).json({ success: false, error: 'Targeting can only change in draft' });
        return;
      }

      const { error: updErr } = await supabaseAdmin
        .from('subscription_cards')
        .update({
          target_tiers: body.target_tiers,
          min_experience_years: body.min_experience_years,
          target_languages: body.target_languages,
        })
        .eq('id', req.params.id as string);
      if (updErr) {
        res.status(500).json({ success: false, error: updErr.message });
        return;
      }

      await supabaseAdmin
        .from('subscription_card_target_countries')
        .delete()
        .eq('card_id', (req.params.id as string));
      await supabaseAdmin
        .from('subscription_card_target_regions')
        .delete()
        .eq('card_id', (req.params.id as string));

      if (body.target_country_ids.length > 0) {
        const { error: cErr } = await supabaseAdmin
          .from('subscription_card_target_countries')
          .insert(body.target_country_ids.map((cid) => ({
            card_id: (req.params.id as string),
            country_id: cid,
          })));
        if (cErr) {
          res.status(500).json({ success: false, error: cErr.message });
          return;
        }
      }
      if (body.target_regions.length > 0) {
        const { error: rErr } = await supabaseAdmin
          .from('subscription_card_target_regions')
          .insert(body.target_regions.map((r) => ({
            card_id: (req.params.id as string),
            country_id: r.country_id,
            region: r.region,
          })));
        if (rErr) {
          res.status(500).json({ success: false, error: rErr.message });
          return;
        }
      }

      const { data: fresh } = await supabaseAdmin
        .from('subscription_cards')
        .select('*')
        .eq('id', (req.params.id as string))
        .single();
      res.json({ success: true, data: await hydrateCard(fresh) });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ success: false, error: err.errors[0].message });
        return;
      }
      console.error('Put targets error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// ============================================================
// POST /subscription-cards/:id/publish — match partners and mark published
// ============================================================
router.post(
  '/:id/publish',
  requireSalesLeadsAccess,
  async (req: Request, res: Response) => {
    try {
      const loaded = await loadCardForUser(req.params.id as string, req.userId!, res);
      if (!loaded) return;
      if (loaded.card.state !== 'draft') {
        res.status(409).json({ success: false, error: 'Card is already published or closed' });
        return;
      }

      const matched = await matchPartnersForCard(req.params.id as string);

      // Flip state; reject if something else raced us.
      const { data: updated, error: updErr } = await supabaseAdmin
        .from('subscription_cards')
        .update({
          state: 'published',
          published_at: new Date().toISOString(),
          published_by: req.userId!,
        })
        .eq('id', (req.params.id as string))
        .eq('state', 'draft')
        .select('*')
        .maybeSingle();
      if (updErr) {
        res.status(500).json({ success: false, error: updErr.message });
        return;
      }
      if (!updated) {
        res.status(409).json({ success: false, error: 'Card state changed — refresh and try again' });
        return;
      }

      res.json({
        success: true,
        data: await hydrateCard(updated),
        matched_count: matched.length,
      });
    } catch (err: any) {
      console.error('Publish card error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// ============================================================
// POST /subscription-cards/:id/recall — back to draft if zero acceptances
// ============================================================
router.post(
  '/:id/recall',
  requireSalesLeadsAccess,
  async (req: Request, res: Response) => {
    try {
      const loaded = await loadCardForUser(req.params.id as string, req.userId!, res);
      if (!loaded) return;
      if (loaded.card.state !== 'published') {
        res.status(409).json({ success: false, error: 'Only published cards can be recalled' });
        return;
      }

      const { count: acceptedCount, error: countErr } = await supabaseAdmin
        .from('subscription_card_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('card_id', (req.params.id as string))
        .eq('status', 'accepted');
      if (countErr) {
        res.status(500).json({ success: false, error: countErr.message });
        return;
      }
      if ((acceptedCount || 0) > 0) {
        res.status(409).json({
          success: false,
          error: 'Cannot recall: partners have already accepted this card',
        });
        return;
      }

      await supabaseAdmin
        .from('subscription_card_recipients')
        .delete()
        .eq('card_id', (req.params.id as string));

      const { data: updated, error: updErr } = await supabaseAdmin
        .from('subscription_cards')
        .update({ state: 'draft', published_at: null, published_by: null })
        .eq('id', (req.params.id as string))
        .select('*')
        .single();
      if (updErr) {
        res.status(500).json({ success: false, error: updErr.message });
        return;
      }
      res.json({ success: true, data: await hydrateCard(updated) });
    } catch (err: any) {
      console.error('Recall card error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// ============================================================
// POST /subscription-cards/:id/close — terminal state
// ============================================================
router.post(
  '/:id/close',
  requireSalesLeadsAccess,
  async (req: Request, res: Response) => {
    try {
      const loaded = await loadCardForUser(req.params.id as string, req.userId!, res);
      if (!loaded) return;
      if (loaded.card.state === 'closed') {
        res.status(409).json({ success: false, error: 'Card is already closed' });
        return;
      }

      const { data: updated, error } = await supabaseAdmin
        .from('subscription_cards')
        .update({ state: 'closed', closed_at: new Date().toISOString() })
        .eq('id', (req.params.id as string))
        .select('*')
        .single();
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      res.json({ success: true, data: await hydrateCard(updated) });
    } catch (err: any) {
      console.error('Close card error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

export default router;
