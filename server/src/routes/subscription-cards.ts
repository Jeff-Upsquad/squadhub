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
import {
  buildSquadhirePayloadForCard,
  deliverCardToSquadhire,
} from '../utils/squadhireWebhook';

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
  // Optional FK to subscription_deliverable_types so the UI can show which item
  // type was picked. Null/missing on legacy rows.
  deliverable_type_id: z.string().uuid().nullable().optional(),
});

const patchCardSchema = z.object({
  working_days: z.array(z.enum(WEEK_DAYS)).optional(),
  brand_name: z.string().max(200).nullable().optional(),
  business_nature: z.string().max(500).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  custom_deliverables: z.array(customDeliverableSchema).optional(),
  // null = clear override and fall back to the plan's default partner price.
  partner_price_override: z.number().int().min(0).nullable().optional(),
  // FKs to subscription_plan_deliverables that this card has disabled.
  disabled_default_deliverable_ids: z.array(z.string().uuid()).optional(),
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
  // SquadHire (Profiles) category IDs. UUIDs from SquadHire's DB, not ours —
  // no FK. Empty array means "don't publish to SquadHire on publish".
  squadhire_category_ids: z.array(z.string().uuid()).default([]),
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
          squadhire_category_ids: body.squadhire_category_ids,
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
const publishBodySchema = z.object({
  distribution: z.enum(['broadcast', 'manual']).default('broadcast'),
});

router.post(
  '/:id/publish',
  requireSalesLeadsAccess,
  async (req: Request, res: Response) => {
    try {
      const parsed = publishBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' });
        return;
      }
      const { distribution } = parsed.data;

      const loaded = await loadCardForUser(req.params.id as string, req.userId!, res);
      if (!loaded) return;
      if (loaded.card.state !== 'draft') {
        res.status(409).json({ success: false, error: 'Card is already published or closed' });
        return;
      }

      // Manual distribution skips the auto-fan-out. The card still flips to
      // 'published' so it's visible in the admin Published Cards list and in
      // the client portal; admins then hand-pick recipients via the
      // assign-partner / assign-talent endpoints.
      const matched =
        distribution === 'broadcast'
          ? await matchPartnersForCard(req.params.id as string)
          : [];

      // Flip state; reject if something else raced us.
      const { data: updated, error: updErr } = await supabaseAdmin
        .from('subscription_cards')
        .update({
          state: 'published',
          distribution,
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

      // Fan out to SquadHire. Fire-and-forget from the user's point of view:
      // the admin sees "published" immediately; delivery runs in the
      // background with inline retries and the sweeper as the safety net.
      // Never block or fail the publish response on this call. The payload
      // includes `distribution` so SquadHire knows whether to broadcast to
      // talents (broadcast) or only show in its admin Published Cards list
      // (manual).
      buildSquadhirePayloadForCard(updated.id)
        .then((payload) => {
          if (payload) {
            return deliverCardToSquadhire(updated.id, payload);
          }
        })
        .catch((err) => {
          console.error('[publish] squadhire delivery threw unexpectedly', err);
        });

      res.json({
        success: true,
        data: await hydrateCard(updated),
        matched_count: matched.length,
        distribution,
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
        .update({
          state: 'draft',
          published_at: null,
          published_by: null,
          // Reset SquadHire sync state so the fire-and-forget below (and the
          // sweeper, as a safety net) retries delivery with the new state.
          // buildSquadhirePayloadForCard will compute status='archived' from
          // the new state='draft'.
          squadhire_synced_at: null,
          squadhire_sync_attempts: 0,
          squadhire_sync_last_error: null,
        })
        .eq('id', (req.params.id as string))
        .select('*')
        .single();
      if (updErr) {
        res.status(500).json({ success: false, error: updErr.message });
        return;
      }

      buildSquadhirePayloadForCard(updated.id)
        .then((payload) => payload && deliverCardToSquadhire(updated.id, payload))
        .catch((err) => {
          console.error('[recall] squadhire delivery threw unexpectedly', err);
        });

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
        .update({
          state: 'closed',
          closed_at: new Date().toISOString(),
          // Reset sync state so the archived-delivery is re-attempted,
          // mirroring the recall path.
          squadhire_synced_at: null,
          squadhire_sync_attempts: 0,
          squadhire_sync_last_error: null,
        })
        .eq('id', (req.params.id as string))
        .select('*')
        .single();
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }

      buildSquadhirePayloadForCard(updated.id)
        .then((payload) => payload && deliverCardToSquadhire(updated.id, payload))
        .catch((err) => {
          console.error('[close] squadhire delivery threw unexpectedly', err);
        });

      res.json({ success: true, data: await hydrateCard(updated) });
    } catch (err: any) {
      console.error('Close card error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// ============================================================
// GET /subscription-cards/published-by-me — list published+closed cards the
// current sales user published. Powers the Sales Leads "Published cards" tab.
// ============================================================
router.get(
  '/published-by-me',
  requireSalesLeadsAccess,
  async (_req: Request, res: Response) => {
    try {
      const userId = _req.userId!;

      const { data: cards, error } = await supabaseAdmin
        .from('subscription_cards')
        .select('*')
        .eq('published_by', userId)
        .in('state', ['published', 'closed'])
        .order('published_at', { ascending: false });
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }

      const list = cards || [];
      if (list.length === 0) {
        res.json({ success: true, data: [] });
        return;
      }

      // Hydrate counts/targets, then enrich with submission + staged sub for
      // display. We pull staged subs in one shot rather than per-card.
      const stagedIds = list.map((c: any) => c.submission_subscription_id);
      const { data: stagedRows } = await supabaseAdmin
        .from('client_submission_subscriptions')
        .select('*')
        .in('id', stagedIds);
      const stagedById: Record<string, any> = {};
      (stagedRows || []).forEach((r: any) => { stagedById[r.id] = r; });

      const submissionIds = Array.from(
        new Set((stagedRows || []).map((r: any) => r.submission_id)),
      );
      const subscriptionIds = Array.from(
        new Set((stagedRows || []).map((r: any) => r.subscription_id)),
      );
      const planIds = Array.from(
        new Set((stagedRows || []).map((r: any) => r.plan_id)),
      );

      const [
        { data: submissions },
        { data: subs },
        { data: plans },
        { data: pricing },
        { data: countries },
      ] = await Promise.all([
        supabaseAdmin
          .from('client_submissions')
          .select('id, business_name, country_id')
          .in('id', submissionIds.length ? submissionIds : ['00000000-0000-0000-0000-000000000000']),
        supabaseAdmin
          .from('subscriptions')
          .select('id, name')
          .in('id', subscriptionIds.length ? subscriptionIds : ['00000000-0000-0000-0000-000000000000']),
        supabaseAdmin
          .from('subscription_plans')
          .select('id, plan, tier')
          .in('id', planIds.length ? planIds : ['00000000-0000-0000-0000-000000000000']),
        supabaseAdmin
          .from('subscription_plan_pricing')
          .select('plan_id, country_id, price')
          .in('plan_id', planIds.length ? planIds : ['00000000-0000-0000-0000-000000000000']),
        supabaseAdmin.from('countries').select('id, name, currency'),
      ]);

      const submissionById: Record<string, any> = {};
      (submissions || []).forEach((s: any) => { submissionById[s.id] = s; });
      const subById: Record<string, any> = {};
      (subs || []).forEach((s: any) => { subById[s.id] = s; });
      const planById: Record<string, any> = {};
      (plans || []).forEach((p: any) => { planById[p.id] = p; });
      const countryById: Record<string, any> = {};
      (countries || []).forEach((c: any) => { countryById[c.id] = c; });
      const pricingByPlan: Record<string, any[]> = {};
      (pricing || []).forEach((p: any) => {
        (pricingByPlan[p.plan_id] = pricingByPlan[p.plan_id] || []).push(p);
      });

      const hydrated = await Promise.all(list.map(async (card: any) => {
        const staged = stagedById[card.submission_subscription_id] || null;
        const submission = staged ? submissionById[staged.submission_id] || null : null;
        const country = submission ? countryById[submission.country_id] || null : null;
        const plan = staged ? planById[staged.plan_id] || null : null;
        const subscription = staged ? subById[staged.subscription_id] || null : null;
        const planPricing = staged ? pricingByPlan[staged.plan_id] || [] : [];
        const priceForCountry = country
          ? planPricing.find((pr: any) => pr.country_id === country.id) || null
          : null;

        const base = await hydrateCard(card);
        return {
          ...base,
          submission: submission
            ? { ...submission, country }
            : null,
          submission_subscription: staged
            ? {
                ...staged,
                subscription,
                plan: plan
                  ? {
                      ...plan,
                      pricing: priceForCountry
                        ? [{ ...priceForCountry, country }]
                        : [],
                    }
                  : null,
              }
            : null,
        };
      }));

      res.json({ success: true, data: hydrated });
    } catch (err: any) {
      console.error('List published cards error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

// ============================================================
// GET /subscription-cards/:id/recipients — names + statuses for the side panel
// ============================================================
router.get(
  '/:id/recipients',
  requireSalesLeadsAccess,
  async (req: Request, res: Response) => {
    try {
      const cardId = req.params.id as string;
      const loaded = await loadCardForUser(cardId, req.userId!, res);
      if (!loaded) return;
      // Only the publisher of the card sees its recipients.
      if (loaded.card.published_by && loaded.card.published_by !== req.userId) {
        res.status(403).json({ success: false, error: 'Not your card' });
        return;
      }

      const [
        { data: partnerRows, error: pErr },
        { data: talentRows, error: tErr },
      ] = await Promise.all([
        supabaseAdmin
          .from('subscription_card_recipients')
          .select('partner_id, status, responded_at, assigned_manually')
          .eq('card_id', cardId),
        supabaseAdmin
          .from('subscription_card_external_recipients')
          .select('external_user_id, talent_name, status, responded_at, assigned_manually')
          .eq('card_id', cardId),
      ]);
      if (pErr) {
        res.status(500).json({ success: false, error: pErr.message });
        return;
      }
      if (tErr) {
        res.status(500).json({ success: false, error: tErr.message });
        return;
      }

      const partnerIds = Array.from(new Set((partnerRows || []).map((r: any) => r.partner_id)));
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, display_name, email')
        .in('id', partnerIds.length ? partnerIds : ['00000000-0000-0000-0000-000000000000']);
      const userById: Record<string, any> = {};
      (users || []).forEach((u: any) => { userById[u.id] = u; });

      const partners = (partnerRows || []).map((r: any) => {
        const u = userById[r.partner_id];
        return {
          id: r.partner_id,
          name: u?.display_name || u?.email || r.partner_id,
          status: r.status,
          responded_at: r.responded_at,
          assigned_manually: !!r.assigned_manually,
        };
      });

      const talents = (talentRows || []).map((r: any) => ({
        external_user_id: r.external_user_id,
        name: r.talent_name || null,
        status: r.status,
        responded_at: r.responded_at,
        assigned_manually: !!r.assigned_manually,
      }));

      res.json({ success: true, data: { partners, talents } });
    } catch (err: any) {
      console.error('List card recipients error:', err);
      res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
    }
  },
);

export default router;
