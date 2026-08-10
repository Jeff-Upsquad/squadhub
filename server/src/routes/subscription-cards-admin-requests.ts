import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireMiniAppOrAdmin } from '../middleware/miniApp';
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
import { logCardEvent } from '../utils/cardEvents';
import { ensureHubContact } from '../utils/leadLookup';
import { generateBriefVoiceUploadUrl } from '../r2';
import {
  buildCatalogTierPricing,
  coerceProposedPrice,
} from '../utils/subscriptionFormPricing';

const router = Router();

// Internal admins, plus anyone granted the Leads mini app — the web app
// renders these same modules for the team (see migration 164).
//
// Scoped to the paths this router owns: it is mounted at bare '/admin', so an
// unscoped gate would impose a Leads requirement on every other /admin/*
// router too (see the note in admin.ts).
const OWN_PATHS = ['/subscription-cards', '/subscription-requests'];
router.use(OWN_PATHS, requireAuth);
router.use(OWN_PATHS, requireMiniAppOrAdmin('leads'));

// Map upsquad's tier vocabulary to SquadHub's enum
// (Junior/Pro/Top Talents/Custom). Unknown values are dropped.
const TIER_MAP: Record<string, string> = {
  juniors: 'Junior',
  junior: 'Junior',
  pros: 'Pro',
  pro: 'Pro',
  'top talents': 'Top Talents',
  'top_talents': 'Top Talents',
  toptalents: 'Top Talents',
  'top talent': 'Top Talents',
  custom: 'Custom',
};
function normalizeTiers(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => TIER_MAP[t.trim().toLowerCase()])
    .filter((t): t is string => Boolean(t));
}

// ============================================================
// Per-card shareable pre-fill links (see migration 108).
// Only form-request DRAFT cards can be shared; the client opens the link,
// confirms the pre-filled brief, and the SAME card is updated (handled by
// the public endpoints in leads-public.ts).
// ============================================================
const FORM_REQUEST_SOURCES = ['shared_form', 'landing_page_form', 'request', 'internal_brief'];

function buildCardShareUrl(token: string): string {
  const base =
    process.env.WEB_APP_URL ||
    (process.env.NODE_ENV === 'production' ? 'https://squadhub.in' : 'http://localhost:3000');
  return `${base.replace(/\/$/, '')}/card/${token}`;
}

function deriveShareLinkStatus(link: {
  completed_at: string | null;
  revoked_at: string | null;
  expires_at: string;
}): 'active' | 'expired' | 'completed' | 'revoked' {
  if (link.completed_at) return 'completed';
  if (link.revoked_at) return 'revoked';
  if (new Date(link.expires_at).getTime() < Date.now()) return 'expired';
  return 'active';
}

// Loads a card and asserts it's a shareable form-request draft. Returns the
// card on success, or an { error } tuple the caller maps to an HTTP status.
async function loadFormRequestDraft(cardId: string): Promise<
  | { card: { id: string; state: string; source: string } }
  | { error: 404 | 409; msg: string }
> {
  const { data: card } = await supabaseAdmin
    .from('subscription_cards')
    .select('id, state, source')
    .eq('id', cardId)
    .maybeSingle();
  if (!card) return { error: 404, msg: 'Card not found' };
  if (card.state !== 'draft') return { error: 409, msg: 'Only draft cards can be shared' };
  if (!FORM_REQUEST_SOURCES.includes(card.source)) {
    return { error: 409, msg: 'Only form-request cards can be shared' };
  }
  return { card: card as any };
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
        .in('subscription_request_id', ids)
        // Soft-deleted cards live in the admin Trash, not in any card list.
        // Attaching a trashed card_id here would make the row render
        // "View Card" / "Share link" that dead-end on the editor's
        // deleted_at-filtered fetch ("Card not found.").
        .is('deleted_at', null);
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

    // Check if a *live* card already exists for this request. A soft-deleted
    // card sits in the Trash and must be treated as absent, so a fresh draft
    // is created instead of re-opening a card the editor can't load.
    const { data: existing } = await supabaseAdmin
      .from('subscription_cards')
      .select('id')
      .eq('subscription_request_id', subscription_request_id)
      .is('deleted_at', null)
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

    // Stage B: Hub contact is SSOT from the first card onward.
    const { submission: hubContact } = await ensureHubContact({
      email: requestData.email || null,
      phone: requestData.phone || null,
      contact_name: requestData.name || null,
      business_name: requestData.company || null,
      business_location: (requestData as any).location_of_business || null,
      country_id: countryId,
    });

    const { data: card, error } = await supabaseAdmin
      .from('subscription_cards')
      .insert({
        source: 'request',
        subscription_request_id,
        state: 'draft',
        proposed_price: requestData.proposed_price,
        // null = inherit the plan catalog margin until an admin adjusts it.
        markup: null,
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
        hours_note: (requestData as any).hours_note || null,
        publish_targets: ['partner', 'talent'],
        lead_submission_id: hubContact?.id ?? null,
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

    await logCardEvent({
      cardId: (card as any).id,
      eventType: 'created',
      actorId: (req as any).userId ?? null,
      actorType: 'admin',
      actorLabel: (req as any).userName ?? null,
      metadata: { source: 'request', subscription_request_id },
    });

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

    // Stage B: ensure Hub contact when any contact identity is present.
    const { submission: hubContact } = await ensureHubContact({
      email: body.customer_email || null,
      phone: body.customer_phone || null,
      contact_name: body.customer_name || null,
      business_name: body.customer_company || null,
    });

    const { data: card, error } = await supabaseAdmin
      .from('subscription_cards')
      .insert({
        source: 'custom',
        state: 'draft',
        // null = inherit the plan catalog margin until an admin adjusts it.
        markup: null,
        customer_company: body.customer_company || null,
        customer_name: body.customer_name || null,
        customer_email: body.customer_email || null,
        customer_phone: body.customer_phone || null,
        service_type: body.service_type || null,
        plan_name: body.plan_name || null,
        publish_targets: ['partner', 'talent'],
        lead_submission_id: hubContact?.id ?? null,
      })
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    await logCardEvent({
      cardId: (card as any).id,
      eventType: 'created',
      actorId: (req as any).userId ?? null,
      actorType: 'admin',
      actorLabel: (req as any).userName ?? null,
      metadata: { source: 'custom' },
    });

    const hydrated = await hydrateCard(card);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Create custom card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/client-brief — an internal user fills out a
// client brief form on the client's behalf. Lands in Form Requests as an
// 'internal_brief' draft; created_by records who filled it. They can then send
// a 24h share link for the client to review & approve.
// ============================================================
const clientBriefSchema = z.object({
  service_type: z.string().min(1),
  brand_name: z.string().optional(),
  business_nature: z.string().optional(),
  business_note: z.string().optional(),
  contact_name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  business_location: z.string().optional(),
  country_id: z.string().uuid().optional(),
  state_regions: z.array(z.string()).optional().default([]),
  languages: z.array(z.string()).optional().default([]),
  working_days: z.array(z.string()).optional().default([]),
  requirement_note: z.string().optional(),
  requirement_voice_url: z.string().url().max(1000).optional(),
  hours_note: z.string().optional(),
  // Build-your-own-subscription: experience level(s), weekly plan, and the
  // client's stated monthly budget. Enum-guarded so target_tiers can't trip
  // the subscription_cards CHECK constraint.
  target_tiers: z
    .array(z.enum(['Junior', 'Pro', 'Top Talents', 'Custom']))
    .optional()
    .default([]),
  plan_name: z.string().optional(),
  proposed_price: z.number().int().nonnegative().optional(),
  // Product line. 'assignment' is a one-off freelance project — the plan is
  // dropped and proposed_price is the one-time project budget; the timeline
  // fields below are stored in assignment_details.
  card_type: z.enum(['subscription', 'assignment']).optional().default('subscription'),
  duration: z.string().optional(),
  start_date: z.string().optional(),
  deadline: z.string().optional(),
  scope_type: z.string().optional(),
  // How an assignment card is priced to talents. 'priced' shows the budget as
  // an offer (accept/decline/counter); 'unpriced' invites talents to submit
  // their own offer. Stored in assignment_details.pricing_mode.
  pricing_mode: z.enum(['priced', 'unpriced']).optional(),
});

// POST /admin/subscription-cards/voice-upload-url — presigned R2 PUT URL for
// the admin brief form's requirement voice note (same storage as /connect).
router.post('/subscription-cards/voice-upload-url', async (req: Request, res: Response) => {
  try {
    const filename = String(req.body?.filename || 'voice-note.webm').slice(0, 200);
    // Drop MIME parameters (`audio/webm;codecs=opus`) so the base type is what
    // R2 signs the presigned PUT against — matching the client's PUT header.
    const contentType = String(req.body?.content_type || '').split(';')[0].trim();
    if (!/^audio\/[a-z0-9.+-]+$/i.test(contentType)) {
      res.status(400).json({ success: false, error: 'content_type must be an audio MIME type' });
      return;
    }
    const { uploadUrl, publicUrl } = await generateBriefVoiceUploadUrl(filename, contentType);
    res.json({ success: true, data: { upload_url: uploadUrl, public_url: publicUrl } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Could not prepare upload.' });
  }
});

router.post('/subscription-cards/client-brief', async (req: Request, res: Response) => {
  try {
    const parsed = clientBriefSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      return;
    }
    const body = parsed.data;

    // Soft-validate the country (drop it rather than failing the FK insert).
    let countryId: string | null = null;
    if (body.country_id) {
      const { data: countryRow } = await supabaseAdmin
        .from('countries')
        .select('id')
        .eq('id', body.country_id)
        .maybeSingle();
      countryId = (countryRow as any)?.id ?? null;
    }

    // Stage B: ensure Hub contact + CRM/Hire soft refs for this brief.
    const { submission: hubContact } = await ensureHubContact({
      email: body.email || null,
      phone: body.phone || null,
      contact_name: body.contact_name || null,
      business_name: body.brand_name || null,
      business_location: body.business_location || null,
      country_id: countryId,
    });

    const SERVICE_TYPE_TO_SLUG: Record<string, string> = {
      Designers: 'designer',
      Editors: 'video_editor',
      'Designer plus Editor': 'designer_video_editor',
      Accountants: 'accountant',
    };
    const briefTiers = body.target_tiers || [];
    const briefClientBudget =
      body.card_type !== 'assignment' && body.proposed_price && body.proposed_price > 0
        ? body.proposed_price
        : null;
    const briefTierPricing =
      body.card_type === 'assignment'
        ? {}
        : await buildCatalogTierPricing({
            serviceSlug: SERVICE_TYPE_TO_SLUG[body.service_type] || '',
            planName: body.plan_name || null,
            tiers: briefTiers,
            countryId,
            clientBudget: briefClientBudget,
          });
    const briefFirstTier =
      briefTiers.length === 1 ? briefTierPricing[briefTiers[0]] : undefined;

    const { data: card, error } = await supabaseAdmin
      .from('subscription_cards')
      .insert({
        source: 'internal_brief',
        // Lands in the New Deals queue as 'new'. The admin fills in the rest of
        // the details and "Save Draft" promotes new → draft, which unlocks the
        // shareable client link (link generation is draft-gated).
        state: 'new',
        markup: briefFirstTier?.markup ?? null,
        created_by: req.userId!,
        service_type: body.service_type,
        brand_name: body.brand_name || null,
        business_nature: body.business_nature || null,
        notes: body.business_note || null,
        requirement_note: body.requirement_note || null,
        requirement_voice_url: body.requirement_voice_url || null,
        hours_note: body.hours_note || null,
        target_tiers: briefTiers,
        // Assignment cards have no weekly plan; their budget IS the one-time
        // proposed/offer price. Subscriptions leave proposed_price at 0 and
        // seed Final/margin from the catalog when possible.
        // chk constraints require NULL or > 0, so coerce 0 ("not stated") → NULL.
        plan_name: body.card_type === 'assignment' ? null : body.plan_name || null,
        proposed_price:
          body.card_type === 'assignment' && body.proposed_price && body.proposed_price > 0
            ? body.proposed_price
            : coerceProposedPrice(briefFirstTier?.proposed_price),
        subscription_price:
          body.card_type === 'assignment'
            ? null
            : briefFirstTier?.subscription_price ?? null,
        client_budget: briefClientBudget,
        tier_pricing: briefTierPricing,
        card_type: body.card_type,
        assignment_details:
          body.card_type === 'assignment'
            ? {
                duration: body.duration || null,
                start_date: body.start_date || null,
                deadline: body.deadline || null,
                scope_type: body.scope_type || null,
                pricing_mode: body.pricing_mode || 'priced',
              }
            : null,
        working_days: body.working_days || [],
        target_languages: body.languages || [],
        customer_name: body.contact_name || null,
        customer_company: body.brand_name || null,
        customer_email: body.email || null,
        customer_phone: body.phone || null,
        customer_location: body.business_location || null,
        publish_targets: ['partner', 'talent'],
        lead_submission_id: hubContact?.id ?? null,
      })
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    // Target country + regions (mirror the share-link submit handler).
    if (countryId) {
      await supabaseAdmin
        .from('subscription_card_target_countries')
        .insert({ card_id: card.id, country_id: countryId });
      if (body.state_regions.length > 0) {
        await supabaseAdmin
          .from('subscription_card_target_regions')
          .insert(
            body.state_regions.map((region) => ({
              card_id: card.id,
              country_id: countryId,
              region,
            })),
          );
      }
    }

    await logCardEvent({
      cardId: (card as any).id,
      eventType: 'created',
      actorId: (req as any).userId ?? null,
      actorType: 'admin',
      actorLabel: (req as any).userName ?? null,
      metadata: { source: 'internal_brief' },
    });

    const hydrated = await hydrateCard(card);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Create client brief error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/verify — an internal user verifies a brief
// the client submitted directly (shared_form / landing_page_form). Stamps
// verified_by / verified_at so the queue can show "Verified by …".
// ============================================================
router.post('/subscription-cards/:id/verify', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id;
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, source')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) {
      res.status(404).json({ success: false, error: 'Card not found' });
      return;
    }
    if (card.source !== 'shared_form' && card.source !== 'landing_page_form') {
      res.status(409).json({ success: false, error: 'Only client-submitted briefs can be verified' });
      return;
    }

    const { data: updated, error } = await supabaseAdmin
      .from('subscription_cards')
      .update({ verified_by: req.userId!, verified_at: new Date().toISOString() })
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
    console.error('Verify client brief error:', err);
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
  hours_note: z.string().nullable().optional(),
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
  // Finalized monthly client price. null = not finalized (falls back to proposed).
  subscription_price: z.number().int().positive().nullable().optional(),
  // Adjusted margin. null = inherit the plan catalog margin.
  markup: z.number().int().min(0).nullable().optional(),
  // Per-tier draft pricing. Used when the admin picks 2+ tiers — the
  // publish handler validates every selected tier has an entry here, then
  // fans the draft out to one published card per tier (each card carries
  // that tier's proposed_price/markup). Empty {} on single-tier drafts.
  tier_pricing: z
    .record(
      z.string(),
      z.object({
        proposed_price: z.number().int().min(0),
        markup: z.number().int().min(0).nullable().optional(),
        subscription_price: z.number().int().positive().nullable().optional(),
        // The client's stated budget for this tier — reference only, carried
        // through so an editor save doesn't wipe it from the JSONB entry.
        client_budget: z.number().int().positive().nullable().optional(),
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
    if (card.state !== 'draft' && card.state !== 'new') {
      res.status(409).json({ success: false, error: 'Only new or draft cards can be edited' });
      return;
    }
    if (
      card.source !== 'request' &&
      card.source !== 'custom' &&
      card.source !== 'shared_form' &&
      card.source !== 'landing_page_form' &&
      card.source !== 'internal_brief'
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
    if (body.hours_note !== undefined) updates.hours_note = body.hours_note;
    if (body.working_days !== undefined) updates.working_days = body.working_days;
    if (body.custom_deliverables !== undefined) updates.custom_deliverables = body.custom_deliverables;
    if (body.proposed_price !== undefined) updates.proposed_price = body.proposed_price;
    if (body.subscription_price !== undefined) updates.subscription_price = body.subscription_price;
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

    // "Save Draft" on a New Deal promotes it: new → draft. This is the gate
    // that unlocks the shareable client link (link generation is draft-only).
    if (card.state === 'new') updates.state = 'draft';

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

    await logCardEvent({
      cardId,
      eventType: 'draft_saved',
      actorId: (req as any).userId ?? null,
      actorType: 'admin',
      actorLabel: (req as any).userName ?? null,
      metadata: { promoted_from_new: card.state === 'new' },
    });

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
    if (card.state !== 'draft' && card.state !== 'new') {
      res.status(409).json({ success: false, error: 'Only new or draft cards can be targeted' });
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

    // Tier-required gate: a card delivered to talents MUST have at least one
    // target tier. Otherwise the SquadHire matcher's tier filter is skipped
    // (it only fires when match_rules.target_tiers is non-empty), and every
    // category-matching talent becomes a recipient regardless of skill level
    // — which is exactly the bug the per-tier fan-out is meant to fix.
    const cardTargetTiers: string[] = Array.isArray(card.target_tiers)
      ? (card.target_tiers as string[]).filter(Boolean)
      : [];
    if (publishTargets.includes('talent') && cardTargetTiers.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Pick at least one tier — empty target_tiers would broadcast to every category-matching talent.',
      });
      return;
    }

    // Multi-tier validation: when 2+ tiers selected, every tier must have
    // a client-facing price in tier_pricing (proposed OR finalized
    // subscription_price — catalog-seeded briefs often leave proposed at 0).
    // Single-tier (or untargeted) drafts fall through to the legacy
    // proposed_price / subscription_price check.
    const targetTiers: string[] = Array.isArray(card.target_tiers)
      ? (card.target_tiers as string[]).filter(Boolean)
      : [];
    const tierPricing: Record<
      string,
      { proposed_price?: number; markup?: number; subscription_price?: number | null }
    > =
      card.tier_pricing && typeof card.tier_pricing === 'object'
        ? card.tier_pricing
        : {};

    if (targetTiers.length > 1) {
      for (const tier of targetTiers) {
        const entry = tierPricing[tier];
        const hasFinal = entry?.subscription_price != null && entry.subscription_price > 0;
        const hasProposed = entry?.proposed_price != null && entry.proposed_price > 0;
        if (!entry || (!hasFinal && !hasProposed)) {
          res.status(400).json({
            success: false,
            error: `Missing pricing for tier "${tier}"`,
          });
          return;
        }
      }
    } else {
      const finalized =
        (card.subscription_price != null && card.subscription_price > 0
          ? card.subscription_price
          : null) ??
        (card.proposed_price != null && card.proposed_price > 0 ? card.proposed_price : null);
      // Also accept a single-tier entry living only in tier_pricing.
      const singleEntry = targetTiers.length === 1 ? tierPricing[targetTiers[0]] : null;
      const singleFinalized =
        finalized ??
        (singleEntry?.subscription_price != null && singleEntry.subscription_price > 0
          ? singleEntry.subscription_price
          : null) ??
        (singleEntry?.proposed_price != null && singleEntry.proposed_price > 0
          ? singleEntry.proposed_price
          : null);
      if (singleFinalized == null || singleFinalized <= 0) {
        res.status(400).json({ success: false, error: 'Display price must be > 0' });
        return;
      }
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

    // Publish builds the staged recipient list but SENDS NOTHING. The separate
    // "Broadcast" action releases partners (broadcast_at) and delivers to
    // SquadHire. Broadcast mode auto-matches every qualifying partner into the
    // staged list (broadcast_at = NULL, invisible until broadcast); soft-publish
    // (manual) starts empty and the admin hand-picks recipients.
    if (publishTargets.includes('partner') && distribution === 'broadcast') {
      for (const cid of cardIds) {
        await matchPartnersForCard(cid, { staged: true });
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

    await logCardEvent({
      cardId,
      eventType: distribution === 'manual' ? 'soft_published' : 'published',
      actorId: (req as any).userId ?? null,
      actorType: 'admin',
      actorLabel: (req as any).userName ?? null,
      metadata: {
        distribution,
        publish_targets: publishTargets,
        child_card_ids: cardIds.slice(1),
      },
    });

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
      // Release any partners hand-picked while soft-published that are still
      // staged (broadcast_at IS NULL), so the manual→broadcast upgrade surfaces
      // everyone rather than leaving the earlier hand-picks hidden.
      await supabaseAdmin
        .from('subscription_card_recipients')
        .update({ broadcast_at: new Date().toISOString() })
        .eq('card_id', cardId)
        .is('broadcast_at', null)
        .is('archived_at', null);
    }

    if (publishTargets.includes('talent')) {
      buildSquadhirePayloadForCard(cardId)
        .then((payload) => payload && deliverCardToSquadhire(cardId, payload))
        .catch((err) =>
          console.error('[broadcast-card] squadhire delivery error', err),
        );
    }

    await logCardEvent({
      cardId,
      eventType: 'broadcast',
      actorId: (req as any).userId ?? null,
      actorType: 'admin',
      actorLabel: (req as any).userName ?? null,
      metadata: { upgraded_from: 'manual', publish_targets: publishTargets },
    });

    const hydrated = await hydrateCard(updated);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Broadcast card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// DELETE /admin/subscription-cards/:id — hard delete draft only
// NOTE: This route is SHADOWED. index.ts mounts subscriptionCardsAdminRoutes
// at '/admin/subscription-cards' (its DELETE /:id) BEFORE this router at
// '/admin', so that handler wins and now SOFT-deletes the card into Trash.
// This hard-delete handler is unreachable via that path; if you ever change
// the mount order, port the soft-delete here too or drafts will vanish
// instead of moving to Trash.
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

// ============================================================
// POST /admin/subscription-cards/:id/share-link — generate (or regenerate)
// a 24h client pre-fill link for a form-request draft card. Regenerating
// revokes any currently-active link first (one live link per card).
// ============================================================
router.post('/subscription-cards/:id/share-link', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const guard = await loadFormRequestDraft(cardId);
    if ('error' in guard) {
      res.status(guard.error).json({ success: false, error: guard.msg });
      return;
    }

    // Revoke the existing active link so the partial unique index
    // (uniq_card_share_link_active) admits the new row, and any previously
    // shared URL stops working.
    await supabaseAdmin
      .from('subscription_card_share_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('card_id', cardId)
      .is('revoked_at', null)
      .is('completed_at', null);

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from('subscription_card_share_links')
      .insert({ card_id: cardId, created_by: req.userId!, expires_at: expiresAt })
      .select('*')
      .single();

    if (error || !data) {
      res.status(500).json({ success: false, error: error?.message || 'Failed to generate link' });
      return;
    }

    res.json({
      success: true,
      data: {
        token: data.id,
        url: buildCardShareUrl(data.id),
        expires_at: data.expires_at,
        completed_at: data.completed_at,
        revoked_at: data.revoked_at,
        status: deriveShareLinkStatus(data),
      },
    });
  } catch (err: any) {
    console.error('Generate card share link error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// GET /admin/subscription-cards/:id/share-link — the newest link for a card
// (any status), or null. Used by the admin modal to show current state.
// ============================================================
router.get('/subscription-cards/:id/share-link', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const { data } = await supabaseAdmin
      .from('subscription_card_share_links')
      .select('*')
      .eq('card_id', cardId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) {
      res.json({ success: true, data: null });
      return;
    }

    res.json({
      success: true,
      data: {
        token: data.id,
        url: buildCardShareUrl(data.id),
        expires_at: data.expires_at,
        completed_at: data.completed_at,
        revoked_at: data.revoked_at,
        status: deriveShareLinkStatus(data),
      },
    });
  } catch (err: any) {
    console.error('Get card share link error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/subscription-cards/:id/share-link/revoke — stop sharing
// without generating a replacement (revokes the active link, if any).
// ============================================================
router.post('/subscription-cards/:id/share-link/revoke', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const { data } = await supabaseAdmin
      .from('subscription_card_share_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('card_id', cardId)
      .is('revoked_at', null)
      .is('completed_at', null)
      .select('*')
      .maybeSingle();

    res.json({
      success: true,
      data: data
        ? {
            token: data.id,
            url: buildCardShareUrl(data.id),
            expires_at: data.expires_at,
            completed_at: data.completed_at,
            revoked_at: data.revoked_at,
            status: deriveShareLinkStatus(data),
          }
        : null,
    });
  } catch (err: any) {
    console.error('Revoke card share link error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
