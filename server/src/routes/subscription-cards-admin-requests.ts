import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { fanOutTierCards, hydrateCard, matchPartnersForCard } from '../utils/subscriptionCards';
import {
  buildSquadhirePayloadForCard,
  deliverCardToSquadhire,
} from '../utils/squadhireWebhook';
import {
  listSubscriptionRequests,
  getSubscriptionRequest,
  updateSubscriptionRequestStatus,
} from '../utils/upsquadApi';
import { config } from '../config';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

// Map upsquad's tier vocabulary (Juniors/Pros/Elites) to SquadHub's enum
// (Junior/Pro/Elite/Custom). Unknown values are dropped.
const TIER_MAP: Record<string, string> = {
  juniors: 'Junior',
  junior: 'Junior',
  pros: 'Pro',
  pro: 'Pro',
  elites: 'Elite',
  elite: 'Elite',
  custom: 'Custom',
};
function normalizeTiers(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => TIER_MAP[t.trim().toLowerCase()])
    .filter((t): t is string => Boolean(t));
}

// ============================================================
// GET /admin/subscription-requests — proxy list from upsquad
// ============================================================
router.get('/subscription-requests', async (req: Request, res: Response) => {
  if (!config.upsquadApiUrl) {
    res.status(503).json({ success: false, error: 'upsquad API not configured' });
    return;
  }
  try {
    const { status, search, limit, offset } = req.query;
    const result = await listSubscriptionRequests({
      status: status ? String(status) : undefined,
      search: search ? String(search) : undefined,
      limit: limit ? parseInt(String(limit), 10) : undefined,
      offset: offset ? parseInt(String(offset), 10) : undefined,
    });

    // Enrich each request with the local card_id (if any) so the UI can
    // show "View Card" instead of "Review" and recover from orphan
    // upsquad-published requests that never created a local card.
    const ids = result.items.map((r: any) => r.id).filter(Boolean);
    let cardByRequestId = new Map<number, string>();
    if (ids.length > 0) {
      const { data: cards } = await supabaseAdmin
        .from('subscription_cards')
        .select('id, subscription_request_id')
        .in('subscription_request_id', ids);
      cardByRequestId = new Map(
        (cards ?? []).map((c: any) => [c.subscription_request_id as number, c.id as string]),
      );
    }
    const enriched = result.items.map((r: any) => ({
      ...r,
      card_id: cardByRequestId.get(r.id) ?? null,
    }));

    res.json({ success: true, data: enriched, total: result.total });
  } catch (err: any) {
    console.error('Proxy list subscription requests error:', err);
    res.status(502).json({ success: false, error: err?.message || 'Failed to reach upsquad' });
  }
});

// ============================================================
// GET /admin/subscription-requests/:id — proxy single from upsquad
// ============================================================
router.get('/subscription-requests/:id', async (req: Request, res: Response) => {
  if (!config.upsquadApiUrl) {
    res.status(503).json({ success: false, error: 'upsquad API not configured' });
    return;
  }
  try {
    const id = parseInt(req.params.id as string, 10);
    if (!id) { res.status(400).json({ success: false, error: 'Invalid ID' }); return; }
    const data = await getSubscriptionRequest(id);
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('Proxy get subscription request error:', err);
    res.status(502).json({ success: false, error: err?.message || 'Failed to reach upsquad' });
  }
});

// ============================================================
// POST /admin/subscription-cards/from-request — create draft card from a request
// ============================================================
const fromRequestSchema = z.object({
  subscription_request_id: z.number().int().positive(),
});

router.post('/subscription-cards/from-request', async (req: Request, res: Response) => {
  try {
    const parsed = fromRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }
    const { subscription_request_id } = parsed.data;

    // Check if a card already exists for this request
    const { data: existing } = await supabaseAdmin
      .from('subscription_cards')
      .select('id')
      .eq('subscription_request_id', subscription_request_id)
      .maybeSingle();
    if (existing) {
      const hydrated = await hydrateCard(
        (await supabaseAdmin.from('subscription_cards').select('*').eq('id', existing.id).single()).data,
      );
      res.json({ success: true, data: hydrated });
      return;
    }

    // Fetch request data from upsquad
    let requestData;
    try {
      requestData = await getSubscriptionRequest(subscription_request_id);
    } catch {
      res.status(502).json({ success: false, error: 'Could not fetch request from upsquad' });
      return;
    }

    // Parse tiers, days, languages, states from upsquad's CSV-style fields.
    const tiers = normalizeTiers(requestData.tier || '');
    const splitCsv = (s: any) =>
      typeof s === 'string'
        ? s.split(',').map((x: string) => x.trim()).filter(Boolean)
        : [];
    const days = splitCsv((requestData as any).working_days);
    const states = splitCsv((requestData as any).states_csv);
    const languages = splitCsv((requestData as any).languages_csv);

    // Map upsquad's service_type label to a SquadHub subscription slug, then
    // resolve the SquadHire category IDs the admin has wired through the
    // "SquadHire Profiles" dropdown (subscription_squadhire_profiles). With
    // this prefill, request-source cards behave like sales-source cards: the
    // squadhireWebhook gate sees a non-empty array and actually delivers.
    const serviceToSlug: Record<string, string> = {
      Designers: 'designer',
      Editors: 'video_editor',
      'Designer plus Editor': 'designer_video_editor',
    };
    const subscriptionSlug = serviceToSlug[requestData.service_type] || '';
    let squadhireCategoryIds: string[] = [];
    if (subscriptionSlug) {
      const { data: subRow } = await supabaseAdmin
        .from('subscriptions')
        .select('id')
        .eq('slug', subscriptionSlug)
        .maybeSingle();
      if (subRow?.id) {
        const { data: profileRows } = await supabaseAdmin
          .from('subscription_squadhire_profiles')
          .select('squadhire_category_id')
          .eq('subscription_id', subRow.id);
        squadhireCategoryIds = (profileRows || []).map((r: any) => r.squadhire_category_id);
      }
    }

    // Look up the country row for the upsquad country code, if any. Used to
    // populate target_country_ids / target_regions on the card.
    let countryId: string | null = null;
    const upsquadCountryCode = String((requestData as any).country || '').toUpperCase();
    if (upsquadCountryCode) {
      const codeToName: Record<string, string> = {
        IN: 'India', US: 'United States', GB: 'United Kingdom',
        AE: 'United Arab Emirates', SG: 'Singapore', AU: 'Australia', CA: 'Canada',
      };
      const countryName = codeToName[upsquadCountryCode] || '';
      if (countryName) {
        const { data: countryRow } = await supabaseAdmin
          .from('countries')
          .select('id')
          .ilike('name', countryName)
          .maybeSingle();
        countryId = (countryRow as any)?.id ?? null;
      }
    }
    const targetRegions =
      countryId && states.length > 0
        ? states.map((region) => ({ country_id: countryId, region }))
        : [];

    const { data: card, error } = await supabaseAdmin
      .from('subscription_cards')
      .insert({
        source: 'request',
        subscription_request_id,
        state: 'draft',
        proposed_price: requestData.proposed_price,
        markup: 0,
        service_type: requestData.service_type,
        plan_name: requestData.plan,
        target_tiers: tiers,
        working_days: days,
        customer_name: requestData.name,
        customer_email: requestData.email,
        customer_company: requestData.company || null,
        customer_phone: requestData.phone,
        target_languages: languages,
        squadhire_category_ids: squadhireCategoryIds,
        brand_name: (requestData as any).brand_name || null,
        business_nature: (requestData as any).nature_of_business || null,
        notes: (requestData as any).short_note || null,
        customer_location: (requestData as any).location_of_business || null,
        requirement_note: (requestData as any).requirement_note || null,
        publish_targets: ['partner', 'talent'],
      })
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Country/region targeting lives in join tables; populate them now.
    if (countryId) {
      await supabaseAdmin
        .from('subscription_card_target_countries')
        .insert({ card_id: (card as any).id, country_id: countryId });
    }
    if (targetRegions.length > 0) {
      await supabaseAdmin
        .from('subscription_card_target_regions')
        .insert(
          targetRegions.map((r) => ({ card_id: (card as any).id, country_id: r.country_id, region: r.region })),
        );
    }

    // Mark request as in_review (fire-and-forget)
    updateSubscriptionRequestStatus(subscription_request_id, 'in_review').catch(() => {});

    const hydrated = await hydrateCard(card);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Create card from request error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/custom — create blank custom card
// ============================================================
const customCardSchema = z.object({
  customer_company: z.string().optional(),
  customer_name: z.string().optional(),
  customer_email: z.string().email().optional(),
  customer_phone: z.string().optional(),
  service_type: z.string().optional(),
  plan_name: z.string().optional(),
});

router.post('/subscription-cards/custom', async (req: Request, res: Response) => {
  try {
    const parsed = customCardSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }
    const body = parsed.data;

    const { data: card, error } = await supabaseAdmin
      .from('subscription_cards')
      .insert({
        source: 'custom',
        state: 'draft',
        markup: 0,
        customer_company: body.customer_company || null,
        customer_name: body.customer_name || null,
        customer_email: body.customer_email || null,
        customer_phone: body.customer_phone || null,
        service_type: body.service_type || null,
        plan_name: body.plan_name || null,
        publish_targets: ['partner', 'talent'],
      })
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const hydrated = await hydrateCard(card);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Create custom card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// PATCH /admin/subscription-cards/:id/edit — update draft request/custom card
// ============================================================
const editCardSchema = z.object({
  brand_name: z.string().nullable().optional(),
  business_nature: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  requirement_note: z.string().nullable().optional(),
  working_days: z.array(z.string()).optional(),
  custom_deliverables: z.array(z.object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(['hours', 'item']),
    per_day: z.number().default(0),
    per_week: z.number().default(0),
    per_month: z.number().default(0),
  })).optional(),
  proposed_price: z.number().int().positive().nullable().optional(),
  markup: z.number().int().min(0).optional(),
  // Per-tier draft pricing. Used when the admin picks 2+ tiers — the
  // publish handler validates every selected tier has an entry here, then
  // fans the draft out to one published card per tier (each card carries
  // that tier's proposed_price/markup). Empty {} on single-tier drafts.
  tier_pricing: z
    .record(
      z.string(),
      z.object({
        proposed_price: z.number().int().min(0),
        markup: z.number().int().min(0),
      }),
    )
    .optional(),
  partner_price_override: z.number().int().min(0).nullable().optional(),
  publish_targets: z.array(z.enum(['partner', 'talent'])).min(1).optional(),
  distribution: z.enum(['broadcast', 'manual']).optional(),
  customer_company: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  customer_email: z.string().nullable().optional(),
  customer_phone: z.string().nullable().optional(),
  customer_location: z.string().nullable().optional(),
  service_type: z.string().nullable().optional(),
  plan_name: z.string().nullable().optional(),
});

router.patch('/subscription-cards/:id/edit', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const parsed = editCardSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, source')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    if (card.state !== 'draft') {
      res.status(409).json({ success: false, error: 'Only draft cards can be edited' });
      return;
    }
    if (
      card.source !== 'request' &&
      card.source !== 'custom' &&
      card.source !== 'shared_form' &&
      card.source !== 'landing_page_form'
    ) {
      res.status(409).json({ success: false, error: 'This card source cannot be edited here' });
      return;
    }

    const updates: Record<string, unknown> = {};
    const body = parsed.data;
    if (body.brand_name !== undefined) updates.brand_name = body.brand_name;
    if (body.business_nature !== undefined) updates.business_nature = body.business_nature;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.requirement_note !== undefined) updates.requirement_note = body.requirement_note;
    if (body.working_days !== undefined) updates.working_days = body.working_days;
    if (body.custom_deliverables !== undefined) updates.custom_deliverables = body.custom_deliverables;
    if (body.proposed_price !== undefined) updates.proposed_price = body.proposed_price;
    if (body.markup !== undefined) updates.markup = body.markup;
    if (body.tier_pricing !== undefined) updates.tier_pricing = body.tier_pricing;
    if (body.partner_price_override !== undefined) updates.partner_price_override = body.partner_price_override;
    if (body.publish_targets !== undefined) updates.publish_targets = body.publish_targets;
    if (body.distribution !== undefined) updates.distribution = body.distribution;
    if (body.customer_company !== undefined) updates.customer_company = body.customer_company;
    if (body.customer_name !== undefined) updates.customer_name = body.customer_name;
    if (body.customer_email !== undefined) updates.customer_email = body.customer_email;
    if (body.customer_phone !== undefined) updates.customer_phone = body.customer_phone;
    if (body.customer_location !== undefined) updates.customer_location = body.customer_location;
    if (body.service_type !== undefined) updates.service_type = body.service_type;
    if (body.plan_name !== undefined) updates.plan_name = body.plan_name;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    const { data: updated, error } = await supabaseAdmin
      .from('subscription_cards')
      .update(updates)
      .eq('id', cardId)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const hydrated = await hydrateCard(updated);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Edit request/custom card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// PUT /admin/subscription-cards/:id/targets — update targeting for request/custom card
// ============================================================
const targetsSchema = z.object({
  target_tiers: z.array(z.string()).optional(),
  min_experience_years: z.number().int().min(0).optional(),
  target_languages: z.array(z.string()).optional(),
  target_country_ids: z.array(z.string()).optional(),
  target_regions: z.array(z.object({ country_id: z.string(), region: z.string() })).optional(),
  squadhire_category_ids: z.array(z.string()).optional(),
});

router.put('/subscription-cards/:id/targets', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const parsed = targetsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, source')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    if (card.state !== 'draft') {
      res.status(409).json({ success: false, error: 'Only draft cards can be targeted' });
      return;
    }

    const body = parsed.data;

    // Update scalar targeting on the card row
    const cardUpdates: Record<string, unknown> = {};
    if (body.target_tiers !== undefined) cardUpdates.target_tiers = body.target_tiers;
    if (body.min_experience_years !== undefined) cardUpdates.min_experience_years = body.min_experience_years;
    if (body.target_languages !== undefined) cardUpdates.target_languages = body.target_languages;
    if (body.squadhire_category_ids !== undefined) cardUpdates.squadhire_category_ids = body.squadhire_category_ids;

    if (Object.keys(cardUpdates).length > 0) {
      await supabaseAdmin.from('subscription_cards').update(cardUpdates).eq('id', cardId);
    }

    // Replace country targeting
    if (body.target_country_ids !== undefined) {
      await supabaseAdmin.from('subscription_card_target_countries').delete().eq('card_id', cardId);
      if (body.target_country_ids.length > 0) {
        await supabaseAdmin
          .from('subscription_card_target_countries')
          .insert(body.target_country_ids.map((cid) => ({ card_id: cardId, country_id: cid })));
      }
    }

    // Replace region targeting
    if (body.target_regions !== undefined) {
      await supabaseAdmin.from('subscription_card_target_regions').delete().eq('card_id', cardId);
      if (body.target_regions.length > 0) {
        await supabaseAdmin
          .from('subscription_card_target_regions')
          .insert(body.target_regions.map((r) => ({ card_id: cardId, country_id: r.country_id, region: r.region })));
      }
    }

    const { data: updated } = await supabaseAdmin
      .from('subscription_cards')
      .select('*')
      .eq('id', cardId)
      .single();
    const hydrated = await hydrateCard(updated);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Update request/custom card targets error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/publish — publish a request/custom card
// ============================================================
const publishSchema = z.object({
  distribution: z.enum(['broadcast', 'manual']).default('broadcast'),
});

router.post('/subscription-cards/:id/publish', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const parsed = publishSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('*')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    if (card.state !== 'draft') {
      res.status(409).json({ success: false, error: 'Only draft cards can be published' });
      return;
    }

    const publishTargets: string[] = card.publish_targets || ['partner', 'talent'];
    const distribution = parsed.data.distribution;

    if (publishTargets.length === 0) {
      res.status(400).json({ success: false, error: 'At least one publish target required' });
      return;
    }

    // Multi-tier validation: when 2+ tiers selected, every tier must have
    // a non-zero price in tier_pricing. Single-tier (or untargeted) drafts
    // fall through to the legacy proposed_price/markup display-price check.
    const targetTiers: string[] = Array.isArray(card.target_tiers)
      ? (card.target_tiers as string[]).filter(Boolean)
      : [];
    const tierPricing: Record<string, { proposed_price?: number; markup?: number }> =
      card.tier_pricing && typeof card.tier_pricing === 'object'
        ? card.tier_pricing
        : {};

    if (targetTiers.length > 1) {
      for (const tier of targetTiers) {
        const entry = tierPricing[tier];
        if (!entry || !entry.proposed_price || entry.proposed_price <= 0) {
          res.status(400).json({
            success: false,
            error: `Missing pricing for tier "${tier}"`,
          });
          return;
        }
      }
    } else if (card.proposed_price && (card.proposed_price + (card.markup || 0)) <= 0) {
      res.status(400).json({ success: false, error: 'Display price must be > 0' });
      return;
    }

    // Fan out (or single-publish) — returns the original id first, then
    // any sibling ids created for additional tiers.
    let cardIds: string[];
    try {
      cardIds = await fanOutTierCards(cardId, (req as any).userId, distribution);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message ?? 'Fan-out failed' });
      return;
    }

    // Partner matching per card (each card has target_tiers=[oneTier], so
    // matchPartnersForCard naturally routes only that tier's partners).
    if (publishTargets.includes('partner') && distribution === 'broadcast') {
      for (const cid of cardIds) {
        await matchPartnersForCard(cid);
      }
    }

    // SquadHire delivery per card (only on broadcast — manual publishes
    // sync lazily on first manual talent assignment). Fire-and-forget so
    // a slow webhook doesn't block the publish response.
    if (publishTargets.includes('talent') && distribution === 'broadcast') {
      for (const cid of cardIds) {
        buildSquadhirePayloadForCard(cid)
          .then((payload) => payload && deliverCardToSquadhire(cid, payload))
          .catch((err) =>
            console.error('[publish-request-card] squadhire delivery error', err),
          );
      }
    }

    // Notify upsquad once — only the original carries subscription_request_id.
    if (card.subscription_request_id) {
      updateSubscriptionRequestStatus(card.subscription_request_id, 'published').catch(() => {});
    }

    const { data: updated } = await supabaseAdmin
      .from('subscription_cards')
      .select('*')
      .eq('id', cardId)
      .single();
    const hydrated = await hydrateCard(updated);
    res.json({
      success: true,
      data: hydrated,
      child_card_ids: cardIds.slice(1),
    });
  } catch (err: any) {
    console.error('Publish request/custom card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/broadcast — upgrade a soft-published
// (manual) card to broadcast, running auto-match for partners & talents
// ============================================================
router.post('/subscription-cards/:id/broadcast', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('*')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    if (card.state !== 'published') {
      res.status(409).json({ success: false, error: 'Only published cards can be broadcast' });
      return;
    }
    if (card.distribution !== 'manual') {
      res.status(409).json({ success: false, error: 'Card is already broadcast' });
      return;
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update({ distribution: 'broadcast' })
      .eq('id', cardId)
      .select('*')
      .single();
    if (updErr) {
      res.status(500).json({ success: false, error: updErr.message });
      return;
    }

    const publishTargets: string[] = card.publish_targets || ['partner', 'talent'];

    if (publishTargets.includes('partner')) {
      await matchPartnersForCard(cardId);
    }

    if (publishTargets.includes('talent')) {
      buildSquadhirePayloadForCard(cardId)
        .then((payload) => payload && deliverCardToSquadhire(cardId, payload))
        .catch((err) =>
          console.error('[broadcast-card] squadhire delivery error', err),
        );
    }

    const hydrated = await hydrateCard(updated);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Broadcast card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// DELETE /admin/subscription-cards/:id — hard delete draft only
// ============================================================
router.delete('/subscription-cards/:id', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, source, subscription_request_id')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    if (card.state !== 'draft') {
      res.status(409).json({ success: false, error: 'Only draft cards can be deleted' });
      return;
    }

    // Clean up targeting rows
    await Promise.all([
      supabaseAdmin.from('subscription_card_target_countries').delete().eq('card_id', cardId),
      supabaseAdmin.from('subscription_card_target_regions').delete().eq('card_id', cardId),
    ]);

    await supabaseAdmin.from('subscription_cards').delete().eq('id', cardId);

    // Reset upsquad request status back to pending
    if (card.subscription_request_id) {
      updateSubscriptionRequestStatus(card.subscription_request_id, 'pending').catch(() => {});
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Delete request/custom card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
