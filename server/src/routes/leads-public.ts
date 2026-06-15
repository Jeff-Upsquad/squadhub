import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../supabase';

const router = Router();

// Map the form's service_type slug back to the upsquad-style display label
// the rest of the system already uses (AdminCardEditor + plan resolution
// in subscription-cards-admin.ts both key off these exact strings).
const SLUG_TO_SERVICE_TYPE: Record<string, string> = {
  designer: 'Designers',
  video_editor: 'Editors',
  designer_video_editor: 'Designer plus Editor',
  accountant: 'Accountants',
};

const VALID_DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

// Reverse of SLUG_TO_SERVICE_TYPE — the card stores a display label, but
// client_submission_brands.service_type stores the slug vocabulary.
const SERVICE_TYPE_TO_SLUG: Record<string, string> = {
  Designers: 'designer',
  Editors: 'video_editor',
  'Designer plus Editor': 'designer_video_editor',
  Accountants: 'accountant',
};

// Card sources that surface in the admin "Form Requests" queue and can be
// shared with a client pre-fill link (mirrors subscription-cards-admin-requests).
const FORM_REQUEST_SOURCES = ['shared_form', 'landing_page_form', 'request', 'internal_brief'];

// ---------------------------------------------------------------------------
// In-process IP rate-limiter (no Redis). 10 req/min/IP shared across all
// public lead endpoints. Resets on server restart — adequate for the
// current volume on /lookup and /landing. Bumping the window/limit is
// trivial if abuse appears.
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
type Bucket = { count: number; resetAt: number };
const ipBuckets = new Map<string, Bucket>();

function ipRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() ||
    req.ip ||
    'unknown';
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    res.status(429).json({ success: false, error: 'Too many requests. Try again shortly.' });
    return;
  }
  bucket.count += 1;
  next();
}

// Drop expired buckets every couple of minutes so the map doesn't grow
// forever under sustained traffic.
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of ipBuckets) {
    if (b.resetAt < now) ipBuckets.delete(ip);
  }
}, 2 * 60_000).unref();

// ---------------------------------------------------------------------------
// Helpers — shared between /lookup and /landing.
// ---------------------------------------------------------------------------

// Last 10 digits is the universal phone identity in this system (the
// admin Squad-CRM lookup uses the same shape). 7+ digits guards against
// trivial partial matches.
function phoneSuffix(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

// Returns the most recently matching client_submissions row, or null.
// Matches case-insensitive email first; falls back to last-10-digit phone
// suffix (mirrors the regex used in migration 081's backfill and the
// existing /lookup-crm-lead admin endpoint).
async function findSubmissionByContact(
  email?: string | null,
  phone?: string | null,
): Promise<any | null> {
  const normEmail = email?.trim().toLowerCase() || null;
  const suffix = phoneSuffix(phone);

  if (normEmail) {
    const { data } = await supabaseAdmin
      .from('client_submissions')
      .select('*')
      .ilike('email', normEmail)
      .order('created_at', { ascending: false })
      .limit(1);
    if (data && data.length > 0) return data[0];
  }

  if (suffix) {
    // Supabase's PostgREST can't do right(regexp_replace(...)) directly;
    // we pull a small candidate set and match in-process. The contact_number
    // column isn't huge, but we still filter to rows ending in the last
    // four digits to cut the candidate set down.
    const tail4 = suffix.slice(-4);
    const { data } = await supabaseAdmin
      .from('client_submissions')
      .select('*')
      .ilike('contact_number', `%${tail4}`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) {
      for (const row of data) {
        const rowSuffix = phoneSuffix(row.contact_number);
        if (rowSuffix && rowSuffix === suffix) return row;
      }
    }
  }

  return null;
}

type BrandRow = {
  id: string;
  submission_id: string;
  brand_name: string;
  business_nature: string | null;
  business_note: string | null;
  requirement_note: string | null;
  service_type: string | null;
  target_languages: string[];
  working_days: string[];
  country_id: string | null;
  target_tiers: string[];
  business_location: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

async function fetchBrandsWithRegions(submissionId: string) {
  const { data: brands } = await supabaseAdmin
    .from('client_submission_brands')
    .select('*')
    .eq('submission_id', submissionId)
    .order('updated_at', { ascending: false });

  const brandRows: BrandRow[] = (brands || []) as any;
  if (brandRows.length === 0) return [];

  const ids = brandRows.map((b) => b.id);
  const { data: regions } = await supabaseAdmin
    .from('client_submission_brand_regions')
    .select('brand_id, region')
    .in('brand_id', ids);

  const regionsByBrand: Record<string, string[]> = {};
  for (const r of (regions || []) as any[]) {
    (regionsByBrand[r.brand_id] = regionsByBrand[r.brand_id] || []).push(r.region);
  }

  return brandRows.map((b) => ({
    ...b,
    target_regions: regionsByBrand[b.id] || [],
  }));
}

// Find-or-create the brand row for (leadId, brand_name) and return its id.
// Resolution is by (submission_id, lower(brand_name)) — the same key
// /leads/landing uses — which keeps sibling cards safe: renaming the brand
// resolves to a different/new row, so the original brand (and the other cards
// that still point at it) is left untouched. On UPDATE we preserve the
// brand's service_type/source (a single card can't know the brand's full
// multi-role slug). Returns null on write failure so callers can treat the
// lead/brand link as best-effort.
async function upsertBrandForLead(
  leadId: string,
  fields: {
    brand_name: string;
    business_nature: string | null;
    business_note: string | null;
    target_languages: string[];
    working_days: string[];
    business_location: string | null;
    service_type_label: string | null; // card display label → slug on insert
  },
  countryId: string | null,
  stateRegions: string[],
): Promise<string | null> {
  const { data: existing } = await supabaseAdmin
    .from('client_submission_brands')
    .select('id')
    .eq('submission_id', leadId)
    .ilike('brand_name', fields.brand_name)
    .maybeSingle();

  let brandId: string;
  if (existing?.id) {
    brandId = existing.id as string;
    const { error } = await supabaseAdmin
      .from('client_submission_brands')
      .update({
        brand_name: fields.brand_name,
        business_nature: fields.business_nature,
        business_note: fields.business_note,
        target_languages: fields.target_languages,
        working_days: fields.working_days,
        country_id: countryId,
        business_location: fields.business_location,
        updated_at: new Date().toISOString(),
      })
      .eq('id', brandId);
    if (error) return null;
    await supabaseAdmin
      .from('client_submission_brand_regions')
      .delete()
      .eq('brand_id', brandId);
  } else {
    const { data: created, error } = await supabaseAdmin
      .from('client_submission_brands')
      .insert({
        submission_id: leadId,
        brand_name: fields.brand_name,
        business_nature: fields.business_nature,
        business_note: fields.business_note,
        service_type: fields.service_type_label
          ? SERVICE_TYPE_TO_SLUG[fields.service_type_label] ?? null
          : null,
        target_languages: fields.target_languages,
        working_days: fields.working_days,
        country_id: countryId,
        target_tiers: [],
        business_location: fields.business_location,
        source: 'shared_form',
      })
      .select('id')
      .single();
    if (error || !created) return null;
    brandId = (created as any).id;
  }

  if (countryId && stateRegions.length > 0) {
    await supabaseAdmin
      .from('client_submission_brand_regions')
      .insert(stateRegions.map((region) => ({ brand_id: brandId, country_id: countryId, region })));
  }
  return brandId;
}

// ---------------------------------------------------------------------------
// GET /leads/lookup?email=&phone= — public autofill probe for the brief form.
// Single-field match (email OR phone) returns the most recent matching lead
// plus ALL its brands so the form can rehydrate from the latest brand.
// ---------------------------------------------------------------------------
router.get('/lookup', ipRateLimit, async (req: Request, res: Response) => {
  try {
    const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
    const phone = typeof req.query.phone === 'string' ? req.query.phone.trim() : '';

    if (!email && !phone) {
      res.json({ success: true, data: { found: false, lead: null, brands: [] } });
      return;
    }

    const submission = await findSubmissionByContact(email || null, phone || null);
    if (!submission) {
      res.json({ success: true, data: { found: false, lead: null, brands: [] } });
      return;
    }

    const brands = await fetchBrandsWithRegions(submission.id);

    res.json({
      success: true,
      data: {
        found: true,
        lead: {
          submission_id: submission.id,
          contact_name: submission.contact_person,
          email: submission.email,
          phone: submission.contact_number,
          country_id: submission.country_id,
        },
        brands,
      },
    });
  } catch (err) {
    console.error('Lead lookup error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /leads/landing — public brief-form submission.
// Pipeline:
//   1. Find-or-create a client_submissions row by email/phone (this is the
//      "lead" record that powers admin > Clients > New Clients).
//   2. Find-or-create a client_submission_brands row for (lead, brand_name).
//      Same brand re-submitted -> UPDATE the existing brand to latest values.
//   3. Insert subscription_cards as before, with the new brand_id FK.
// ---------------------------------------------------------------------------
const submissionSchema = z.object({
  // One slug per role checkbox ticked on /connect Step 1. Two boxes ticked →
  // two cards. The "Designer + Editor" combo box is its own distinct slug
  // (`designer_video_editor`) meaning one hybrid person, not two specialists.
  service_types: z
    .array(z.enum(['designer', 'video_editor', 'designer_video_editor', 'accountant']))
    .min(1)
    .max(4)
    .refine((arr) => new Set(arr).size === arr.length, {
      message: 'service_types must be unique',
    }),
  brand_name: z.string().trim().min(1).max(200),
  business_nature: z.string().trim().min(1).max(200),
  business_note: z.string().trim().min(1).max(2000),
  contact_name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().min(4).max(30),
  business_location: z.string().trim().max(500).optional().or(z.literal('')),
  country_id: z.string().uuid(),
  state_regions: z.array(z.string().trim().min(1).max(100)).max(60).default([]),
  languages: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
  working_days: z
    .array(z.string().trim())
    .min(1)
    .max(7)
    .refine((arr) => arr.every((d) => VALID_DAYS.has(d)), {
      message: 'working_days must be Mon..Sun',
    }),
  // Per-role requirement details, keyed by service_type slug. Each card
  // emitted below picks up its own entry. Brand-level requirement_note is
  // no longer the source of truth — kept on the brand row as null going
  // forward; legacy rows retain their existing value.
  role_requirements: z
    .record(
      z.enum(['designer', 'video_editor', 'designer_video_editor', 'accountant']),
      z.object({
        note: z.string().trim().max(2000).optional(),
        hours: z.string().trim().max(200).optional(),
        // Build-your-own-subscription: experience level(s), weekly plan, and
        // the client's stated monthly budget. tiers are enum-guarded so they
        // can't trip the subscription_cards.target_tiers CHECK.
        tiers: z
          .array(z.enum(['Junior', 'Pro', 'Elite', 'Top Talents', 'Custom']))
          .max(5)
          .optional(),
        plan: z.string().trim().max(50).optional(),
        budget: z.number().int().nonnegative().optional(),
      }),
    )
    .optional()
    .default({}),
});

router.post('/landing', ipRateLimit, async (req: Request, res: Response) => {
  try {
    const body = submissionSchema.parse(req.body);

    // Validate the country_id exists. Drop it (and the associated regions)
    // rather than fail the submission outright if the lookup misses — admin
    // can fix on review.
    const { data: countryRow } = await supabaseAdmin
      .from('countries')
      .select('id')
      .eq('id', body.country_id)
      .maybeSingle();
    const countryId: string | null = (countryRow as any)?.id ?? null;

    // 1. Find or create the lead.
    let submission = await findSubmissionByContact(body.email, body.phone);
    if (!submission) {
      // country_id is NOT NULL on client_submissions, so fall back to the
      // form's country_id (talent country) when we have no other signal.
      // Admin can rebill later.
      const fallbackCountry = countryId || body.country_id;
      const { data: created, error: leadErr } = await supabaseAdmin
        .from('client_submissions')
        .insert({
          business_name: body.brand_name,
          contact_person: body.contact_name,
          contact_number: body.phone,
          email: body.email,
          country_id: fallbackCountry,
          status: 'new',
        })
        .select('*')
        .single();
      if (leadErr || !created) {
        console.error('Lead create error:', leadErr);
        res.status(500).json({ success: false, error: 'Failed to submit. Please try again.' });
        return;
      }
      submission = created;
    }

    // 2. Find or create the brand for this (lead, brand_name).
    const { data: existingBrand } = await supabaseAdmin
      .from('client_submission_brands')
      .select('id')
      .eq('submission_id', submission.id)
      .ilike('brand_name', body.brand_name)
      .maybeSingle();

    // The brand row holds a single slug; when 2+ slugs were submitted we
    // store the combo value so the autofill probe in /leads/lookup still
    // returns something meaningful for returning visitors. The individual
    // cards (below) carry the per-role service_type for the real source of
    // truth.
    const brandServiceType =
      body.service_types.length === 1
        ? body.service_types[0]
        : 'designer_video_editor';

    const brandFields = {
      submission_id: submission.id,
      brand_name: body.brand_name,
      business_nature: body.business_nature,
      business_note: body.business_note,
      // requirement_note lives on subscription_cards now (one per role). Keep
      // the brand column at null for new submissions; legacy rows still
      // populated from before this change render as a fallback in admin.
      requirement_note: null,
      service_type: brandServiceType,
      target_languages: body.languages,
      working_days: body.working_days,
      country_id: countryId,
      target_tiers: [] as string[],
      business_location: body.business_location || null,
      source: 'shared_form' as const,
    };

    let brandId: string;
    if (existingBrand?.id) {
      brandId = existingBrand.id as string;
      const { error: updErr } = await supabaseAdmin
        .from('client_submission_brands')
        .update({ ...brandFields, updated_at: new Date().toISOString() })
        .eq('id', brandId);
      if (updErr) {
        console.error('Brand update error:', updErr);
        res.status(500).json({ success: false, error: 'Failed to submit. Please try again.' });
        return;
      }
      // Replace region rows for this brand with the latest selection.
      await supabaseAdmin
        .from('client_submission_brand_regions')
        .delete()
        .eq('brand_id', brandId);
    } else {
      const { data: createdBrand, error: brandErr } = await supabaseAdmin
        .from('client_submission_brands')
        .insert(brandFields)
        .select('id')
        .single();
      if (brandErr || !createdBrand) {
        console.error('Brand create error:', brandErr);
        res.status(500).json({ success: false, error: 'Failed to submit. Please try again.' });
        return;
      }
      brandId = (createdBrand as any).id;
    }

    // Insert region rows (state_regions × country_id) — same denorm shape
    // used by subscription_card_target_regions.
    if (countryId && body.state_regions.length > 0) {
      await supabaseAdmin
        .from('client_submission_brand_regions')
        .insert(
          body.state_regions.map((region) => ({
            brand_id: brandId,
            country_id: countryId,
            region,
          })),
        );
    }

    // 3. Emit one draft subscription_cards row per slug ticked on Step 1.
    // Cards share brand_id + contact details but each carries its own
    // service_type + squadhire_category_ids. Multi-tier publish already
    // fans out into independent siblings the same way, so the admin UI
    // and downstream matching don't need any changes.
    const targetRegions =
      countryId && body.state_regions.length > 0
        ? body.state_regions.map((region) => ({ country_id: countryId, region }))
        : [];

    for (const slug of body.service_types) {
      // Pre-resolve SquadHire categories for THIS service_type so the admin
      // doesn't have to re-pick them. Mirrors from-request flow.
      let squadhireCategoryIds: string[] = [];
      {
        const { data: subRow } = await supabaseAdmin
          .from('subscriptions')
          .select('id')
          .eq('slug', slug)
          .maybeSingle();
        if (subRow?.id) {
          const { data: profileRows } = await supabaseAdmin
            .from('subscription_squadhire_profiles')
            .select('squadhire_category_id')
            .eq('subscription_id', subRow.id);
          squadhireCategoryIds = (profileRows || []).map(
            (r: any) => r.squadhire_category_id,
          );
        }
      }

      const roleReq = body.role_requirements?.[slug];

      const { data: card, error } = await supabaseAdmin
        .from('subscription_cards')
        .insert({
          source: 'shared_form',
          state: 'draft',
          markup: 0,
          service_type: SLUG_TO_SERVICE_TYPE[slug],
          target_tiers: roleReq?.tiers || [],
          plan_name: roleReq?.plan || null,
          proposed_price: roleReq?.budget ?? null,
          working_days: body.working_days,
          customer_name: body.contact_name,
          customer_email: body.email,
          customer_phone: body.phone,
          customer_location: body.business_location || null,
          target_languages: body.languages,
          squadhire_category_ids: squadhireCategoryIds,
          brand_name: body.brand_name,
          business_nature: body.business_nature,
          notes: body.business_note,
          requirement_note: roleReq?.note || null,
          hours_note: roleReq?.hours || null,
          publish_targets: ['partner', 'talent'],
          brand_id: brandId,
        })
        .select('id')
        .single();

      if (error || !card) {
        console.error('Landing page submission insert error:', error);
        res.status(500).json({ success: false, error: 'Failed to submit. Please try again.' });
        return;
      }

      // Country/region targeting lives in join tables, mirroring from-request.
      if (countryId) {
        await supabaseAdmin
          .from('subscription_card_target_countries')
          .insert({ card_id: (card as any).id, country_id: countryId });
      }
      if (targetRegions.length > 0) {
        await supabaseAdmin
          .from('subscription_card_target_regions')
          .insert(
            targetRegions.map((r) => ({
              card_id: (card as any).id,
              country_id: r.country_id,
              region: r.region,
            })),
          );
      }
    }

    // Don't return card ids from a public endpoint.
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Landing page submission error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Per-card client pre-fill share links (see migration 108 +
// subscription-cards-admin-requests.ts for the admin generate/revoke side).
// The token (= subscription_card_share_links.id) identifies ONE form-request
// draft card. GET returns the card's safe pre-fill payload; POST updates the
// SAME card with the client's confirmed details. Unauthenticated, rate-limited.
// ---------------------------------------------------------------------------

// GET /leads/card-link/:token — validate the link + return the pre-fill brief.
router.get('/card-link/:token', ipRateLimit, async (req: Request, res: Response) => {
  try {
    const parsed = z.string().uuid().safeParse(req.params.token);
    if (!parsed.success) {
      res.json({ success: true, data: { valid: false, expired: false, completed: false } });
      return;
    }

    const { data: link } = await supabaseAdmin
      .from('subscription_card_share_links')
      .select('*')
      .eq('id', parsed.data)
      .maybeSingle();
    if (!link || link.revoked_at) {
      res.json({ success: true, data: { valid: false, expired: false, completed: false } });
      return;
    }

    const completed = !!link.completed_at;
    const expired = new Date(link.expires_at).getTime() < Date.now();
    if (completed || expired) {
      res.json({
        success: true,
        data: { valid: false, expired, completed, expires_at: link.expires_at },
      });
      return;
    }

    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select(
        'id, state, source, brand_name, business_nature, notes, customer_name, customer_email, customer_phone, customer_location, service_type, working_days, target_languages, requirement_note, hours_note',
      )
      .eq('id', link.card_id)
      .maybeSingle();

    // Defensive: the card may have been published or deleted after the link
    // was generated. Treat as invalid rather than leaking a stale brief.
    if (!card || card.state !== 'draft' || !FORM_REQUEST_SOURCES.includes(card.source)) {
      res.json({ success: true, data: { valid: false, expired: false, completed: false } });
      return;
    }

    const { data: tc } = await supabaseAdmin
      .from('subscription_card_target_countries')
      .select('country_id')
      .eq('card_id', card.id)
      .limit(1)
      .maybeSingle();
    const countryId: string | null = (tc as any)?.country_id ?? null;
    let stateRegions: string[] = [];
    if (countryId) {
      const { data: tr } = await supabaseAdmin
        .from('subscription_card_target_regions')
        .select('region')
        .eq('card_id', card.id)
        .eq('country_id', countryId);
      stateRegions = (tr || []).map((r: any) => r.region);
    }

    res.json({
      success: true,
      data: {
        valid: true,
        expired: false,
        completed: false,
        expires_at: link.expires_at,
        // Safe allow-list only — no pricing/tiers/squadhire/publish targets or
        // salesperson identity. The client only ever sees their own brief.
        prefill: {
          brand_name: card.brand_name,
          business_nature: card.business_nature,
          business_note: card.notes,
          contact_name: card.customer_name,
          email: card.customer_email,
          phone: card.customer_phone,
          business_location: card.customer_location,
          service_type: card.service_type,
          working_days: card.working_days || [],
          languages: card.target_languages || [],
          country_id: countryId,
          state_regions: stateRegions,
          requirement_note: card.requirement_note,
          hours_note: card.hours_note,
        },
      },
    });
  } catch (err) {
    console.error('Validate card share link error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Client-writable fields. NOTE: service_type is intentionally absent — the
// role the card is for is immutable (a card is one of possibly-many siblings,
// each pinned to a role). Pricing/tiers/targeting recipients are never exposed.
const cardSubmitSchema = z.object({
  brand_name: z.string().trim().min(1).max(200),
  business_nature: z.string().trim().min(1).max(200),
  business_note: z.string().trim().min(1).max(2000),
  contact_name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().min(4).max(30),
  business_location: z.string().trim().max(500).optional().or(z.literal('')),
  country_id: z.string().uuid(),
  state_regions: z.array(z.string().trim().min(1).max(100)).max(60).default([]),
  languages: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
  working_days: z
    .array(z.string().trim())
    .min(1)
    .max(7)
    .refine((arr) => arr.every((d) => VALID_DAYS.has(d)), {
      message: 'working_days must be Mon..Sun',
    }),
  requirement_note: z.string().trim().max(2000).optional().or(z.literal('')),
  hours_note: z.string().trim().max(200).optional().or(z.literal('')),
});

// POST /leads/card-link/:token/submit — update the SAME card; mark link used.
router.post('/card-link/:token/submit', ipRateLimit, async (req: Request, res: Response) => {
  try {
    const parsedToken = z.string().uuid().safeParse(req.params.token);
    if (!parsedToken.success) {
      res.status(400).json({ success: false, error: 'This link is invalid.' });
      return;
    }
    const token = parsedToken.data;

    const { data: link } = await supabaseAdmin
      .from('subscription_card_share_links')
      .select('*')
      .eq('id', token)
      .maybeSingle();
    if (!link || link.revoked_at) {
      res.status(400).json({ success: false, error: 'This link is invalid.' });
      return;
    }
    if (link.completed_at) {
      res.status(400).json({ success: false, error: 'This link has already been used.' });
      return;
    }
    if (new Date(link.expires_at).getTime() < Date.now()) {
      res.status(400).json({ success: false, error: 'This link has expired.' });
      return;
    }

    const body = cardSubmitSchema.parse(req.body);

    // Re-assert the card is still an editable form-request draft (defends
    // against a publish/delete that happened after the link was generated).
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, source, service_type')
      .eq('id', link.card_id)
      .maybeSingle();
    if (!card || !FORM_REQUEST_SOURCES.includes(card.source)) {
      res.status(400).json({ success: false, error: 'This link is invalid.' });
      return;
    }
    if (card.state !== 'draft') {
      res
        .status(409)
        .json({ success: false, error: 'This request is no longer open for editing.' });
      return;
    }

    // Validate the country (soft — fall back to the submitted id; admin can fix).
    const { data: countryRow } = await supabaseAdmin
      .from('countries')
      .select('id')
      .eq('id', body.country_id)
      .maybeSingle();
    const countryId: string | null = (countryRow as any)?.id ?? null;

    // 1. UPDATE the SAME card. service_type/pricing/tiers/state are NOT touched.
    const { error: updErr } = await supabaseAdmin
      .from('subscription_cards')
      .update({
        customer_name: body.contact_name,
        customer_email: body.email,
        customer_phone: body.phone,
        customer_location: body.business_location || null,
        brand_name: body.brand_name,
        business_nature: body.business_nature,
        notes: body.business_note,
        requirement_note: body.requirement_note || null,
        hours_note: body.hours_note || null,
        working_days: body.working_days,
        target_languages: body.languages,
        // The client reviewed the brief via the share link and submitted it —
        // surfaces as "Client approved" on the Form Requests queue.
        client_approved_at: new Date().toISOString(),
      })
      .eq('id', card.id);
    if (updErr) {
      console.error('Card share submit update error:', updErr);
      res.status(500).json({ success: false, error: 'Failed to submit. Please try again.' });
      return;
    }

    // 2. Replace card target country + regions (mirror the /targets handler).
    await supabaseAdmin.from('subscription_card_target_countries').delete().eq('card_id', card.id);
    await supabaseAdmin.from('subscription_card_target_regions').delete().eq('card_id', card.id);
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

    // 3. Link/refresh the lead + brand (best-effort) so the client shows up in
    //    admin > Clients > New Clients and /leads/lookup autofill stays fresh.
    //    A failure here must NOT fail the card update — that's the contract.
    try {
      let submission = await findSubmissionByContact(body.email, body.phone);
      if (!submission) {
        const fallbackCountry = countryId || body.country_id;
        const { data: created } = await supabaseAdmin
          .from('client_submissions')
          .insert({
            business_name: body.brand_name,
            contact_person: body.contact_name,
            contact_number: body.phone,
            email: body.email,
            country_id: fallbackCountry,
            status: 'new',
          })
          .select('*')
          .single();
        submission = created;
      }
      if (submission) {
        const brandId = await upsertBrandForLead(
          submission.id,
          {
            brand_name: body.brand_name,
            business_nature: body.business_nature,
            business_note: body.business_note,
            target_languages: body.languages,
            working_days: body.working_days,
            business_location: body.business_location || null,
            service_type_label: card.service_type ?? null,
          },
          countryId,
          body.state_regions,
        );
        if (brandId) {
          await supabaseAdmin
            .from('subscription_cards')
            .update({ brand_id: brandId })
            .eq('id', card.id);
        }
      }
    } catch (linkErr) {
      console.error('Card share submit lead/brand link error (non-fatal):', linkErr);
    }

    // 4. Mark the link used (single-use). Idempotent guard on completed_at.
    await supabaseAdmin
      .from('subscription_card_share_links')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', token)
      .is('completed_at', null);

    // Don't return card ids from a public endpoint.
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Card share submit error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
