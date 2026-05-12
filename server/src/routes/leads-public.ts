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
};

const VALID_DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

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
  service_type: z.enum(['designer', 'video_editor', 'designer_video_editor']),
  brand_name: z.string().trim().min(1).max(200),
  business_nature: z.string().trim().min(1).max(200),
  business_note: z.string().trim().min(1).max(2000),
  requirement_note: z.string().trim().max(2000).optional().or(z.literal('')),
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

    const brandFields = {
      submission_id: submission.id,
      brand_name: body.brand_name,
      business_nature: body.business_nature,
      business_note: body.business_note,
      requirement_note: body.requirement_note || null,
      service_type: body.service_type,
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

    // 3. Pre-resolve SquadHire categories tied to the chosen subscription so
    // the admin doesn't have to re-pick them. Mirrors from-request flow.
    let squadhireCategoryIds: string[] = [];
    {
      const { data: subRow } = await supabaseAdmin
        .from('subscriptions')
        .select('id')
        .eq('slug', body.service_type)
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

    const serviceTypeLabel = SLUG_TO_SERVICE_TYPE[body.service_type];
    const targetRegions =
      countryId && body.state_regions.length > 0
        ? body.state_regions.map((region) => ({ country_id: countryId, region }))
        : [];

    const { data: card, error } = await supabaseAdmin
      .from('subscription_cards')
      .insert({
        source: 'shared_form',
        state: 'draft',
        markup: 0,
        service_type: serviceTypeLabel,
        target_tiers: [],
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
        requirement_note: body.requirement_note || null,
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

    // Don't return the card id from a public endpoint.
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

export default router;
