import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireMiniAppOrAdmin } from '../middleware/miniApp';
import { supabaseAdmin } from '../supabase';
import { categorizeJobCard } from '../utils/jobStage';
import { logJobCardEvent } from '../utils/jobCardEvents';
import { fetchSquadhireCategories } from '../utils/squadhireCategories';
import {
  findOrCreateSubmissionByContact,
  findSubmissionByContact,
  findClientForSubmission,
} from '../utils/leadLookup';
import {
  buildSquadhireJobPayload,
  deliverJobCardToSquadhire,
  postJobsWebhook,
  previewJobMatches,
} from '../utils/squadhireJobWebhook';

/**
 * Job Cards — admin pipeline (sibling of Subscription Cards).
 *
 * Stored state is small (new → onboarding → published → closed); the nine
 * pipeline tabs are DERIVED via categorizeJobCard(). Publish delivers to
 * SquadHire inline (card_type='hiring' rides Profiles' generic card ingest);
 * every takedown (recall / pause / cancel / close / archive) re-delivers at
 * the mutation site — the jobs sweeper is a RETRY net only, never the
 * initiator (the never-published guard lives in buildSquadhireJobPayload).
 */

const router = Router();

router.use(requireAuth);
// Internal admins, plus anyone granted the Leads mini app — the web app
// renders these same modules for the team (see migration 164).
router.use(requireMiniAppOrAdmin('leads'));

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function adminActor(req: Request) {
  return {
    actorId: req.userId ?? null,
    actorType: 'admin' as const,
    actorLabel: req.userName ?? null,
  };
}

async function loadCard(cardId: string): Promise<any | null> {
  const { data } = await supabaseAdmin
    .from('job_cards')
    .select('*')
    .eq('id', cardId)
    .maybeSingle();
  return data ?? null;
}

/** Fire-and-forget delivery of a card's current lifecycle to SquadHire. */
function deliverInBackground(cardId: string, context: string): void {
  buildSquadhireJobPayload(cardId)
    .then((payload) => payload && deliverJobCardToSquadhire(cardId, payload))
    .catch((err) => console.error(`[job-cards ${context}] squadhire delivery threw unexpectedly`, err));
}

/** Reset the outbound sync bookkeeping so the (re)delivery is authoritative. */
const SYNC_RESET = {
  squadhire_synced_at: null,
  squadhire_sync_attempts: 0,
  squadhire_sync_last_error: null,
} as const;

/** Attach the joined profile/business/brand + derived stage to cards. */
async function hydrateJobCards(cards: any[]): Promise<any[]> {
  if (cards.length === 0) return [];
  const profileIds = Array.from(
    new Set(cards.map((c) => c.job_profile_id).filter(Boolean)),
  ) as string[];
  const profileById: Record<string, any> = {};
  const businessById: Record<string, any> = {};
  const brandById: Record<string, any> = {};
  if (profileIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from('job_profiles')
      .select('id, title, business_profile_id, brand_profile_id, squadhire_category_ids, preference_rules, salary_min, salary_max, salary_currency, salary_period, employment_type, work_mode')
      .in('id', profileIds);
    (profiles ?? []).forEach((p: any) => { profileById[p.id] = p; });

    const businessIds = Array.from(new Set((profiles ?? []).map((p: any) => p.business_profile_id).filter(Boolean)));
    const brandIds = Array.from(new Set((profiles ?? []).map((p: any) => p.brand_profile_id).filter(Boolean)));
    const [{ data: businesses }, { data: brands }] = await Promise.all([
      businessIds.length > 0
        ? supabaseAdmin.from('business_profiles').select('id, name, logo_url, industry').in('id', businessIds)
        : Promise.resolve({ data: [] } as { data: any[] }),
      brandIds.length > 0
        ? supabaseAdmin.from('brand_profiles').select('id, name, logo_url').in('id', brandIds)
        : Promise.resolve({ data: [] } as { data: any[] }),
    ]);
    (businesses ?? []).forEach((b: any) => { businessById[b.id] = b; });
    (brands ?? []).forEach((b: any) => { brandById[b.id] = b; });
  }

  return cards.map((card) => {
    const profile = card.job_profile_id ? profileById[card.job_profile_id] ?? null : null;
    return {
      ...card,
      stage: categorizeJobCard(card),
      job_profile: profile,
      business_profile: profile?.business_profile_id ? businessById[profile.business_profile_id] ?? null : null,
      brand_profile: profile?.brand_profile_id ? brandById[profile.brand_profile_id] ?? null : null,
    };
  });
}

// ------------------------------------------------------------
// Schemas
// ------------------------------------------------------------

// Same explicit-null semantics as job_cards.rule_overrides: a null value
// means "clear this profile rule" (mergeJobRules drops the axis).
const ruleOverridesSchema = z
  .object({
    category_ids: z.array(z.string().uuid()).nullable().optional(),
    target_tiers: z.array(z.string().max(40)).nullable().optional(),
    min_experience_years: z.number().int().min(0).nullable().optional(),
    max_experience_years: z.number().int().min(0).nullable().optional(),
    target_languages: z.array(z.string().max(40)).nullable().optional(),
    target_country_names: z.array(z.string().max(120)).nullable().optional(),
    target_regions: z.array(z.string().max(120)).nullable().optional(),
    min_age: z.number().int().min(0).max(100).nullable().optional(),
    max_age: z.number().int().min(0).max(100).nullable().optional(),
    target_genders: z.array(z.string().max(30)).nullable().optional(),
    target_districts: z.array(z.string().max(120)).nullable().optional(),
  })
  .strict();

// One card per selected role, mirroring the subscription ClientBriefForm's
// role options (Designers / Editors / the hybrid Designer plus Editor).
const jobBriefSchema = z.object({
  role_service_types: z.array(z.enum(['Designers', 'Editors', 'Designer plus Editor'])).min(1).max(3)
    .refine((arr) => new Set(arr).size === arr.length, { message: 'Roles must be unique' }),
  contact_name: z.string().max(200).optional(),
  business_name: z.string().max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  business_location: z.string().max(500).optional(),
  country_id: z.string().uuid().optional(),
  brief_note: z.string().max(4000).optional(),
  package_min: z.number().int().min(0).optional(),
  package_max: z.number().int().min(0).optional(),
  package_currency: z.string().max(10).optional(),
  package_period: z.enum(['monthly', 'annual']).optional(),
  package_notes: z.string().max(2000).optional(),
  openings_count: z.number().int().min(1).max(500).optional(),
  expected_joining_date: z.string().max(40).optional(),
});

const patchCardSchema = z.object({
  role_service_type: z.string().max(60).nullable().optional(),
  brief_note: z.string().max(4000).nullable().optional(),
  customer_name: z.string().max(200).nullable().optional(),
  customer_company: z.string().max(200).nullable().optional(),
  customer_email: z.string().email().nullable().optional(),
  customer_phone: z.string().max(30).nullable().optional(),
  customer_location: z.string().max(500).nullable().optional(),
  package_min: z.number().int().min(0).nullable().optional(),
  package_max: z.number().int().min(0).nullable().optional(),
  package_currency: z.string().max(10).optional(),
  package_period: z.enum(['monthly', 'annual']).optional(),
  package_notes: z.string().max(2000).nullable().optional(),
  openings_count: z.number().int().min(1).max(500).optional(),
  expected_joining_date: z.string().max(40).nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  rule_overrides: ruleOverridesSchema.optional(),
  distribution: z.enum(['broadcast', 'manual']).optional(),
});

// ============================================================
// POST /admin/job-cards/client-brief — brief lands in New Deals; the lead is
// find-or-created (client_submissions) and linked via a DIRECT FK. One card
// per selected role.
// ============================================================
router.post('/client-brief', async (req: Request, res: Response) => {
  try {
    const body = jobBriefSchema.parse(req.body);

    // Find-or-create the lead by contact identity (best-effort: the brief
    // still lands without a lead when no contact identity was given).
    const submission = await findOrCreateSubmissionByContact({
      email: body.email ?? null,
      phone: body.phone ?? null,
      contact_name: body.contact_name ?? null,
      business_name: body.business_name ?? null,
      business_location: body.business_location ?? null,
      country_id: body.country_id ?? null,
    });
    const client = submission ? await findClientForSubmission(submission.id) : null;

    const cards: any[] = [];
    for (const role of body.role_service_types) {
      const { data: card, error } = await supabaseAdmin
        .from('job_cards')
        .insert({
          source: 'internal_brief',
          state: 'new',
          lead_submission_id: submission?.id ?? null,
          client_id: client?.id ?? null,
          role_service_type: role,
          brief_note: body.brief_note ?? null,
          customer_name: body.contact_name ?? null,
          customer_company: body.business_name ?? null,
          customer_email: body.email ?? null,
          customer_phone: body.phone ?? null,
          customer_location: body.business_location ?? null,
          package_min: body.package_min ?? null,
          package_max: body.package_max ?? null,
          package_currency: body.package_currency ?? 'INR',
          package_period: body.package_period ?? 'monthly',
          package_notes: body.package_notes ?? null,
          openings_count: body.openings_count ?? 1,
          expected_joining_date: body.expected_joining_date ?? null,
          created_by: req.userId!,
        })
        .select('*')
        .single();
      if (error) {
        res.status(500).json({ success: false, error: error.message });
        return;
      }
      await logJobCardEvent({
        cardId: card.id,
        eventType: 'created',
        ...adminActor(req),
        metadata: { source: 'internal_brief', role },
      });
      cards.push(card);
    }

    res.json({ success: true, data: await hydrateJobCards(cards) });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create job brief error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// GET /admin/job-cards/squadhire-categories — category picker for jobs
// onboarding. Same cached SquadHire fetch the subscription picker uses, but
// behind this router's own Leads gate: the subscription variant
// (/admin/integrations/squadhire/categories) is gated on Sales Leads module
// access, which a hiring-only admin may not have — and categories are
// REQUIRED to publish a job card. (Registered before /:id.)
// ============================================================
router.get('/squadhire-categories', async (_req: Request, res: Response) => {
  try {
    const { data, cached } = await fetchSquadhireCategories();
    res.json({ success: true, data, cached });
  } catch (err: any) {
    console.error('[job-cards] categories fetch failed:', err);
    res.status(502).json({
      success: false,
      error: err?.message || 'Failed to load SquadHire categories',
    });
  }
});

// ============================================================
// GET /admin/job-cards/lead-lookup?email=&phone= — live autofill for the
// brief form: newest lead matching the contact identity, returned as
// prefillable fields. Read-only — find-OR-CREATE still happens at submit.
// (Registered before /:id so 'lead-lookup' isn't captured as a card id.)
// ============================================================
router.get('/lead-lookup', async (req: Request, res: Response) => {
  try {
    const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
    const phone = typeof req.query.phone === 'string' ? req.query.phone.trim() : '';
    if (!email && !phone) {
      res.json({ success: true, data: null });
      return;
    }

    const submission = await findSubmissionByContact(email || null, phone || null);
    if (!submission) {
      res.json({ success: true, data: null });
      return;
    }

    // Location: the submission's business_address when set; else fall back to
    // the newest job card's customer_location for this lead (earlier briefs
    // stored location only on the card).
    let businessLocation: string | null = submission.business_address ?? null;
    if (!businessLocation) {
      const { data: lastCard } = await supabaseAdmin
        .from('job_cards')
        .select('customer_location')
        .eq('lead_submission_id', submission.id)
        .not('customer_location', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      businessLocation = (lastCard as any)?.customer_location ?? null;
    }

    res.json({
      success: true,
      data: {
        submission_id: submission.id,
        business_name: submission.business_name ?? null,
        contact_person: submission.contact_person ?? null,
        email: submission.email ?? null,
        phone: submission.contact_number ?? null,
        business_location: businessLocation,
        country_id: submission.country_id ?? null,
      },
    });
  } catch (err: any) {
    console.error('Lead lookup error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// GET /admin/job-cards?stage=&search= — list with derived stage buckets
// ============================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const stage = typeof req.query.stage === 'string' ? req.query.stage : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    let query = supabaseAdmin
      .from('job_cards')
      .select('*')
      .order('created_at', { ascending: false });
    // Trash is its own bucket; every other list hides soft-deleted cards.
    if (stage === 'trash') query = query.not('deleted_at', 'is', null);
    else query = query.is('deleted_at', null);

    const { data: cards, error } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    let hydrated = await hydrateJobCards(cards ?? []);
    if (stage && stage !== 'all') {
      hydrated = hydrated.filter((c) => c.stage === stage);
    }
    if (search) {
      const needle = search.toLowerCase();
      hydrated = hydrated.filter((c) =>
        [c.customer_company, c.customer_name, c.role_service_type, c.job_profile?.title, c.business_profile?.name]
          .some((v: string | null | undefined) => (v ?? '').toLowerCase().includes(needle)),
      );
    }
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('List job cards error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// GET /admin/job-cards/:id — detail (profile, business, brand, stage)
// ============================================================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const card = await loadCard(req.params.id as string);
    if (!card) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    const [hydrated] = await hydrateJobCards([card]);
    // Detail carries the FULL profile (list hydration is a thin projection).
    if (card.job_profile_id) {
      const { data: profile } = await supabaseAdmin
        .from('job_profiles')
        .select('*')
        .eq('id', card.job_profile_id)
        .maybeSingle();
      if (profile) {
        const [{ data: business }, { data: brand }] = await Promise.all([
          supabaseAdmin.from('business_profiles').select('*').eq('id', profile.business_profile_id).maybeSingle(),
          profile.brand_profile_id
            ? supabaseAdmin.from('brand_profiles').select('*').eq('id', profile.brand_profile_id).maybeSingle()
            : Promise.resolve({ data: null } as { data: any }),
        ]);
        hydrated.job_profile = profile;
        hydrated.business_profile = business ?? null;
        hydrated.brand_profile = brand ?? null;
      }
    }
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Get job card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// PATCH /admin/job-cards/:id — edit card fields (published cards re-deliver)
// ============================================================
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const body = patchCardSchema.parse(req.body);
    const card = await loadCard(req.params.id as string);
    if (!card || card.deleted_at) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    const { data: updated, error } = await supabaseAdmin
      .from('job_cards')
      .update(body)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    await logJobCardEvent({
      cardId: card.id,
      eventType: 'updated',
      ...adminActor(req),
      metadata: { fields: Object.keys(body) },
    });
    // A live published card must reflect edits (package, overrides, expiry)
    // on the SquadHire mirror.
    if (updated.state === 'published' && updated.published_at) {
      deliverInBackground(updated.id, 'patch');
    }
    const [hydrated] = await hydrateJobCards([updated]);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Patch job card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/job-cards/:id/attach-profile — link the onboarding job profile
// (new → onboarding)
// ============================================================
const attachProfileSchema = z.object({ job_profile_id: z.string().uuid() });

router.post('/:id/attach-profile', async (req: Request, res: Response) => {
  try {
    const body = attachProfileSchema.parse(req.body);
    const card = await loadCard(req.params.id as string);
    if (!card || card.deleted_at) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    if (card.state !== 'new' && card.state !== 'onboarding') {
      res.status(409).json({ success: false, error: 'Profile can only be attached before publish' });
      return;
    }
    const { data: profile } = await supabaseAdmin
      .from('job_profiles')
      .select('id, business_profile_id')
      .eq('id', body.job_profile_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!profile) {
      res.status(404).json({ success: false, error: 'Job profile not found' });
      return;
    }

    // Adopt the business profile's lead/client link when the brief didn't
    // resolve one (keeps the Clients module listing accurate).
    const patch: Record<string, unknown> = {
      job_profile_id: profile.id,
      state: 'onboarding',
    };
    if (!card.lead_submission_id || !card.client_id) {
      const { data: business } = await supabaseAdmin
        .from('business_profiles')
        .select('lead_submission_id, client_id')
        .eq('id', profile.business_profile_id)
        .maybeSingle();
      if (!card.lead_submission_id && business?.lead_submission_id) {
        patch.lead_submission_id = business.lead_submission_id;
      }
      if (!card.client_id && business?.client_id) {
        patch.client_id = business.client_id;
      }
    }

    const { data: updated, error } = await supabaseAdmin
      .from('job_cards')
      .update(patch)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    await logJobCardEvent({
      cardId: card.id,
      eventType: 'profile_attached',
      ...adminActor(req),
      metadata: { job_profile_id: profile.id },
    });
    const [hydrated] = await hydrateJobCards([updated]);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Attach job profile error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/job-cards/:id/publish — validate completeness → deliver inline
// ============================================================
const publishSchema = z.object({
  distribution: z.enum(['broadcast', 'manual']).optional(),
});

router.post('/:id/publish', async (req: Request, res: Response) => {
  try {
    const body = publishSchema.parse(req.body ?? {});
    const card = await loadCard(req.params.id as string);
    if (!card || card.deleted_at) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    if (card.state !== 'onboarding') {
      res.status(409).json({
        success: false,
        error: card.state === 'new'
          ? 'Complete onboarding (attach a job profile) before publishing'
          : 'Card is already published or closed',
      });
      return;
    }
    if (!card.job_profile_id) {
      res.status(400).json({ success: false, error: 'Attach a job profile before publishing' });
      return;
    }
    // Completeness gate — fail closed at publish time so a broken card never
    // reaches SquadHire (mirrors the subscription tier-required gate).
    const { data: profile } = await supabaseAdmin
      .from('job_profiles')
      .select('id, title, status, deleted_at, squadhire_category_ids, business_profile_id')
      .eq('id', card.job_profile_id)
      .maybeSingle();
    if (!profile || profile.deleted_at || profile.status !== 'active') {
      res.status(400).json({ success: false, error: 'The linked job profile is missing or archived' });
      return;
    }
    const categoryIds = Array.isArray(profile.squadhire_category_ids)
      ? (profile.squadhire_category_ids as string[])
      : [];
    if (categoryIds.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Pick at least one SquadHire category on the job profile — without it the card cannot be broadcast.',
      });
      return;
    }
    const { data: business } = await supabaseAdmin
      .from('business_profiles')
      .select('id, deleted_at')
      .eq('id', profile.business_profile_id)
      .maybeSingle();
    if (!business || business.deleted_at) {
      res.status(400).json({ success: false, error: 'The linked business profile is missing' });
      return;
    }

    const distribution = body.distribution ?? card.distribution ?? 'broadcast';
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('job_cards')
      .update({
        state: 'published',
        distribution,
        published_at: new Date().toISOString(),
        published_by: req.userId!,
        recalled_at: null,
        ...SYNC_RESET,
      })
      .eq('id', req.params.id)
      .eq('state', 'onboarding')
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

    // Deliver inline (fire-and-forget with retries; the sweeper is the net).
    deliverInBackground(updated.id, 'publish');

    await logJobCardEvent({
      cardId: updated.id,
      eventType: 'published',
      ...adminActor(req),
      metadata: { distribution },
    });
    const [hydrated] = await hydrateJobCards([updated]);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Publish job card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// Lifecycle: recall / pause / resume / cancel / close / archive / unarchive
// ============================================================

router.post('/:id/recall', async (req: Request, res: Response) => {
  try {
    const card = await loadCard(req.params.id as string);
    if (!card || card.deleted_at) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    if (card.state !== 'published') {
      res.status(409).json({ success: false, error: 'Only published cards can be recalled' });
      return;
    }
    // Back to onboarding for edits + re-publish. published_at is kept — it is
    // the never-published guard's "has a SquadHire mirror" signal, and the
    // takedown below must reach that mirror.
    const { data: updated, error } = await supabaseAdmin
      .from('job_cards')
      .update({
        state: 'onboarding',
        recalled_at: new Date().toISOString(),
        paused_at: null,
        ...SYNC_RESET,
      })
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    deliverInBackground(updated.id, 'recall');
    await logJobCardEvent({ cardId: updated.id, eventType: 'recalled', ...adminActor(req) });
    const [hydrated] = await hydrateJobCards([updated]);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Recall job card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.post('/:id/pause', async (req: Request, res: Response) => {
  try {
    const card = await loadCard(req.params.id as string);
    if (!card || card.deleted_at) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    if (card.state !== 'published' || card.paused_at) {
      res.status(409).json({ success: false, error: 'Only live published cards can be paused' });
      return;
    }
    const { data: updated, error } = await supabaseAdmin
      .from('job_cards')
      .update({ paused_at: new Date().toISOString(), ...SYNC_RESET })
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    deliverInBackground(updated.id, 'pause');
    await logJobCardEvent({ cardId: updated.id, eventType: 'paused', ...adminActor(req) });
    const [hydrated] = await hydrateJobCards([updated]);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Pause job card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.post('/:id/resume', async (req: Request, res: Response) => {
  try {
    const card = await loadCard(req.params.id as string);
    if (!card || card.deleted_at) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    if (!card.paused_at) {
      res.status(409).json({ success: false, error: 'Card is not paused' });
      return;
    }
    const { data: updated, error } = await supabaseAdmin
      .from('job_cards')
      .update({ paused_at: null, ...SYNC_RESET })
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    deliverInBackground(updated.id, 'resume');
    await logJobCardEvent({ cardId: updated.id, eventType: 'resumed', ...adminActor(req) });
    const [hydrated] = await hydrateJobCards([updated]);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Resume job card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

/**
 * Shared close/cancel core. Sets the terminal state locally, re-delivers the
 * archived payload inline (the sync-sweeper memory: MANUAL takedowns must be
 * delivered at the mutation site), and — when the card ever reached SquadHire
 * — fires the jobs close webhook so Profiles runs its close semantics
 * (withdraw un-accepted offers + notify remaining offered candidates).
 * source:'squadhub' is the loop-guard: Profiles suppresses the echo event.
 */
async function closeCardCore(
  req: Request,
  res: Response,
  mode: 'cancel' | 'close',
): Promise<void> {
  const card = await loadCard(req.params.id as string);
  if (!card || card.deleted_at) {
    res.status(404).json({ success: false, error: 'Job card not found' });
    return;
  }
  if (card.state === 'closed') {
    res.status(409).json({ success: false, error: 'Card is already closed' });
    return;
  }
  const reason =
    mode === 'cancel'
      ? 'cancelled'
      : (typeof req.body?.reason === 'string' && ['filled', 'cancelled', 'expired'].includes(req.body.reason)
          ? req.body.reason
          : 'filled');
  const now = new Date().toISOString();
  const { data: updated, error } = await supabaseAdmin
    .from('job_cards')
    .update({
      state: 'closed',
      closed_at: now,
      closed_reason: reason,
      ...(mode === 'cancel' ? { cancelled_at: now } : {}),
      paused_at: null,
      ...SYNC_RESET,
    })
    .eq('id', req.params.id)
    .select('*')
    .single();
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  if (updated.published_at) {
    deliverInBackground(updated.id, mode);
    postJobsWebhook('/close', {
      external_id: updated.id,
      reason,
      source: 'squadhub',
      actor: { type: 'admin', email: req.userEmail ?? null, name: req.userName ?? null },
    }).catch((err) => console.error(`[job-cards ${mode}] close webhook threw`, err));
  }

  await logJobCardEvent({
    cardId: updated.id,
    eventType: mode === 'cancel' ? 'cancelled' : 'closed',
    ...adminActor(req),
    metadata: { reason },
  });
  const [hydrated] = await hydrateJobCards([updated]);
  res.json({ success: true, data: hydrated });
}

router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    await closeCardCore(req, res, 'cancel');
  } catch (err: any) {
    console.error('Cancel job card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.post('/:id/close', async (req: Request, res: Response) => {
  try {
    await closeCardCore(req, res, 'close');
  } catch (err: any) {
    console.error('Close job card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.post('/:id/archive', async (req: Request, res: Response) => {
  try {
    const card = await loadCard(req.params.id as string);
    if (!card || card.deleted_at) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    if (card.archived_at) {
      res.status(409).json({ success: false, error: 'Card is already archived' });
      return;
    }
    const { data: updated, error } = await supabaseAdmin
      .from('job_cards')
      .update({
        archived_at: new Date().toISOString(),
        // Reset sync only for cards with a SquadHire mirror — a never-
        // published draft has nothing to take down (and the payload builder's
        // guard would refuse anyway).
        ...(card.published_at ? SYNC_RESET : {}),
      })
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (updated.published_at) deliverInBackground(updated.id, 'archive');
    await logJobCardEvent({ cardId: updated.id, eventType: 'archived', ...adminActor(req) });
    const [hydrated] = await hydrateJobCards([updated]);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Archive job card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.post('/:id/unarchive', async (req: Request, res: Response) => {
  try {
    const card = await loadCard(req.params.id as string);
    if (!card || card.deleted_at) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    if (!card.archived_at) {
      res.status(409).json({ success: false, error: 'Card is not archived' });
      return;
    }
    const { data: updated, error } = await supabaseAdmin
      .from('job_cards')
      .update({
        archived_at: null,
        ...(card.published_at ? SYNC_RESET : {}),
      })
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (updated.published_at) deliverInBackground(updated.id, 'unarchive');
    await logJobCardEvent({ cardId: updated.id, eventType: 'unarchived', ...adminActor(req) });
    const [hydrated] = await hydrateJobCards([updated]);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Unarchive job card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/job-cards/:id/duplicate — copy details → New Deals draft
// ============================================================
router.post('/:id/duplicate', async (req: Request, res: Response) => {
  try {
    const card = await loadCard(req.params.id as string);
    if (!card) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    const { data: copy, error } = await supabaseAdmin
      .from('job_cards')
      .insert({
        source: 'internal_brief',
        state: card.job_profile_id ? 'onboarding' : 'new',
        lead_submission_id: card.lead_submission_id,
        client_id: card.client_id,
        job_profile_id: card.job_profile_id,
        role_service_type: card.role_service_type,
        brief_note: card.brief_note,
        customer_name: card.customer_name,
        customer_company: card.customer_company,
        customer_email: card.customer_email,
        customer_phone: card.customer_phone,
        customer_location: card.customer_location,
        package_min: card.package_min,
        package_max: card.package_max,
        package_currency: card.package_currency,
        package_period: card.package_period,
        package_notes: card.package_notes,
        openings_count: card.openings_count,
        expected_joining_date: card.expected_joining_date,
        rule_overrides: card.rule_overrides ?? {},
        distribution: card.distribution,
        created_by: req.userId!,
      })
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    await logJobCardEvent({
      cardId: copy.id,
      eventType: 'duplicated',
      ...adminActor(req),
      metadata: { duplicated_from: card.id },
    });
    const [hydrated] = await hydrateJobCards([copy]);
    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('Duplicate job card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// DELETE /admin/job-cards/:id — soft-delete into the admin Trash
// ============================================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const card = await loadCard(req.params.id as string);
    if (!card || card.deleted_at) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    const now = new Date().toISOString();
    const { data: updated, error } = await supabaseAdmin
      .from('job_cards')
      .update({
        deleted_at: now,
        deleted_by: req.userId!,
        // A live mirror must come down with the delete. Never-published cards
        // stay local-only (the payload builder guard is the belt).
        ...(card.published_at ? { archived_at: card.archived_at ?? now, ...SYNC_RESET } : {}),
      })
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (updated.published_at) deliverInBackground(updated.id, 'soft-delete');
    await logJobCardEvent({ cardId: updated.id, eventType: 'deleted', ...adminActor(req) });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Delete job card error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /admin/job-cards/:id/match-preview — read-only "who would match"
// (no ingest, no recipients, no notifications). Cached on the card.
// ============================================================
router.post('/:id/match-preview', async (req: Request, res: Response) => {
  try {
    const card = await loadCard(req.params.id as string);
    if (!card || card.deleted_at) {
      res.status(404).json({ success: false, error: 'Job card not found' });
      return;
    }
    if (!card.job_profile_id) {
      res.status(400).json({ success: false, error: 'Attach a job profile before previewing matches' });
      return;
    }
    const preview = await previewJobMatches(card.id);
    const cached = { ...preview, refreshed_at: new Date().toISOString() };
    await supabaseAdmin
      .from('job_cards')
      .update({ squadhire_match_preview: cached })
      .eq('id', card.id);
    await logJobCardEvent({
      cardId: card.id,
      eventType: 'match_preview_refreshed',
      ...adminActor(req),
      metadata: { count: preview.count },
    });
    res.json({ success: true, data: cached });
  } catch (err: any) {
    console.error('Job card match preview error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// GET /admin/job-cards/:id/events — activity log
// ============================================================
router.get('/:id/events', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('job_card_events')
      .select('*')
      .eq('card_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data ?? [] });
  } catch (err: any) {
    console.error('List job card events error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// Q&A — list + moderation delete (proxy + tombstone both sides; the local
// tombstone survives event replays, contract §7)
// ============================================================
// Q&A read: live from SquadHire (so a missed job_question_asked event can't
// hide a question), falling back to the local mirror. Admin moderation
// tombstones on the mirror are always honoured — a deleted question never
// reappears even if the Profiles delete-proxy once failed. id =
// external_question_id everywhere so DELETE keys the same in both modes.
router.get('/:id/questions', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const { data: mirrorRows } = await supabaseAdmin
      .from('job_card_questions')
      .select('*')
      .eq('card_id', cardId)
      .order('created_at', { ascending: false });
    const rows = (mirrorRows ?? []) as any[];
    const tombstoned = new Set(
      rows.filter((q) => q.deleted_at).map((q) => q.external_question_id as string),
    );

    const live = await postJobsWebhook('/questions/list', { external_id: cardId, source: 'squadhub' });
    if (live.ok && live.body?.success && Array.isArray(live.body.questions)) {
      const data = (live.body.questions as any[])
        .filter((q) => !tombstoned.has(q.question_id))
        .map((q) => ({
          id: q.question_id,
          card_id: cardId,
          job_profile_id: q.job_profile_id ?? null,
          external_question_id: q.question_id,
          talent_user_id: q.talent_user_id ?? null,
          talent_name: q.talent_name ?? null,
          question: q.question,
          answer: q.answer ?? null,
          answered_at: q.answered_at ?? null,
          answered_by_label: q.answered_by_label ?? null,
          deleted_at: null,
          deleted_by: null,
          created_at: q.created_at ?? '',
          updated_at: q.updated_at ?? q.created_at ?? '',
        }));
      res.json({ success: true, source: 'live', data });
      return;
    }

    // Fallback: local mirror (id = external_question_id to match the live path).
    const data = rows
      .filter((q) => !q.deleted_at)
      .map((q) => ({ ...q, id: q.external_question_id }));
    res.json({ success: true, source: 'mirror', data });
  } catch (err: any) {
    console.error('List job card questions error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// :questionId is the external_question_id (Profiles' question id) — that's what
// the live read returns as `id`. Tombstone the mirror (inserting a tombstone row
// for a live-only question that was never mirrored) so the deletion holds
// regardless of the proxy, then proxy the soft-delete to Profiles.
router.delete('/:id/questions/:questionId', async (req: Request, res: Response) => {
  try {
    const cardId = req.params.id as string;
    const externalQuestionId = req.params.questionId as string;
    const { data: question } = await supabaseAdmin
      .from('job_card_questions')
      .select('id, deleted_at')
      .eq('card_id', cardId)
      .eq('external_question_id', externalQuestionId)
      .maybeSingle();

    if (question) {
      if (!question.deleted_at) {
        const { error } = await supabaseAdmin
          .from('job_card_questions')
          .update({ deleted_at: new Date().toISOString(), deleted_by: req.userId! })
          .eq('id', question.id);
        if (error) {
          res.status(500).json({ success: false, error: error.message });
          return;
        }
      }
    } else {
      // Live-only question (event never mirrored) — record the tombstone so the
      // live read excludes it even if the proxy below fails. Best-effort.
      const { error: insErr } = await supabaseAdmin.from('job_card_questions').insert({
        card_id: cardId,
        external_question_id: externalQuestionId,
        question: '[deleted]',
        deleted_at: new Date().toISOString(),
        deleted_by: req.userId!,
      });
      if (insErr) console.error('[job-questions] tombstone insert failed', insErr.message);
    }

    // Best-effort proxy so Profiles tombstones its canonical row too.
    const result = await postJobsWebhook('/questions/delete', {
      external_id: cardId,
      question_id: externalQuestionId,
      source: 'squadhub',
      actor: { type: 'admin', email: req.userEmail ?? null, name: req.userName ?? null },
    });
    await logJobCardEvent({
      cardId,
      eventType: 'question_deleted',
      ...adminActor(req),
      metadata: { question_id: externalQuestionId, squadhire_notified: result.ok },
    });
    res.json({ success: true, squadhire_notified: result.ok });
  } catch (err: any) {
    console.error('Delete job card question error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
