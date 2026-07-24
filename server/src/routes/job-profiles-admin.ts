import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireMiniAppOrAdmin } from '../middleware/miniApp';
import { supabaseAdmin } from '../supabase';
import {
  buildSquadhireJobPayload,
  deliverJobCardToSquadhire,
} from '../utils/squadhireJobWebhook';

/**
 * Job Cards — onboarding profile hierarchy (admin CRUD).
 *
 *   business_profiles  — parent, required (everything a candidate should
 *                        know about the business)
 *   business_locations — saved interview venues (reused via dropdown when
 *                        scheduling physical interviews)
 *   brand_profiles     — optional 0..n brands under a business
 *   job_profiles       — n per business; linked to the business itself OR
 *                        one of its brands; carries the default candidate
 *                        preference rules that job_cards override per card.
 *
 * A PATCH to any profile re-delivers the published job cards it feeds, so
 * the SquadHire mirror never serves a stale snapshot.
 */

const router = Router();

router.use(requireAuth);
// Internal admins, plus anyone granted the Leads mini app — the web app
// renders these same modules for the team (see migration 164).
router.use(requireMiniAppOrAdmin('leads'));

// ------------------------------------------------------------
// Re-delivery: profile edits must reach the SquadHire mirror of every LIVE
// published card built on them. Fire-and-forget with the inline retry budget;
// the jobs sweeper is the safety net.
// ------------------------------------------------------------
async function redeliverPublishedCardsForJobProfiles(jobProfileIds: string[]): Promise<void> {
  if (jobProfileIds.length === 0) return;
  const { data: cards } = await supabaseAdmin
    .from('job_cards')
    .select('id')
    .in('job_profile_id', jobProfileIds)
    .eq('state', 'published')
    .not('published_at', 'is', null)
    .is('deleted_at', null);
  for (const card of cards ?? []) {
    buildSquadhireJobPayload(card.id)
      .then((payload) => payload && deliverJobCardToSquadhire(card.id, payload))
      .catch((err) => console.error('[job-profiles] redelivery error', err));
  }
}

async function redeliverForBusinessProfile(businessProfileId: string): Promise<void> {
  const { data: profiles } = await supabaseAdmin
    .from('job_profiles')
    .select('id')
    .eq('business_profile_id', businessProfileId)
    .is('deleted_at', null);
  await redeliverPublishedCardsForJobProfiles((profiles ?? []).map((p: any) => p.id as string));
}

async function redeliverForBrandProfile(brandProfileId: string): Promise<void> {
  const { data: profiles } = await supabaseAdmin
    .from('job_profiles')
    .select('id')
    .eq('brand_profile_id', brandProfileId)
    .is('deleted_at', null);
  await redeliverPublishedCardsForJobProfiles((profiles ?? []).map((p: any) => p.id as string));
}

// ------------------------------------------------------------
// Schemas
// ------------------------------------------------------------

const photoSchema = z.object({
  url: z.string().min(1),
  caption: z.string().max(300).nullable().optional(),
});

const businessProfileSchema = z.object({
  lead_submission_id: z.string().uuid().nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200),
  about: z.string().max(8000).nullable().optional(),
  industry: z.string().max(200).nullable().optional(),
  company_size: z.string().max(50).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  socials: z.record(z.string()).optional(),
  logo_url: z.string().max(1000).nullable().optional(),
  photos: z.array(photoSchema).optional(),
  culture: z.string().max(8000).nullable().optional(),
  perks: z.array(z.string().max(300)).optional(),
  founded_year: z.number().int().min(1800).max(2100).nullable().optional(),
  contact_name: z.string().max(200).nullable().optional(),
  contact_email: z.string().email().nullable().optional(),
  contact_phone: z.string().max(30).nullable().optional(),
});

const locationSchema = z.object({
  label: z.string().min(1).max(200),
  address: z.string().min(1).max(1000),
  city: z.string().max(200).nullable().optional(),
  region: z.string().max(200).nullable().optional(),
  country_id: z.string().uuid().nullable().optional(),
  postal_code: z.string().max(20).nullable().optional(),
  google_maps_url: z.string().max(1000).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  is_primary: z.boolean().optional(),
});

const brandProfileSchema = z.object({
  name: z.string().min(1).max(200),
  about: z.string().max(8000).nullable().optional(),
  industry: z.string().max(200).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  socials: z.record(z.string()).optional(),
  logo_url: z.string().max(1000).nullable().optional(),
  photos: z.array(photoSchema).optional(),
});

// Preference-rule keys use the SquadHire matcher vocabulary (contract §3) —
// same shape as job_cards.rule_overrides minus the explicit-null semantics.
const preferenceRulesSchema = z
  .object({
    category_ids: z.array(z.string().uuid()).optional(),
    target_tiers: z.array(z.string().max(40)).optional(),
    min_experience_years: z.number().int().min(0).optional(),
    max_experience_years: z.number().int().min(0).optional(),
    target_languages: z.array(z.string().max(40)).optional(),
    target_country_names: z.array(z.string().max(120)).optional(),
    target_regions: z.array(z.string().max(120)).optional(),
    min_age: z.number().int().min(0).max(100).optional(),
    max_age: z.number().int().min(0).max(100).optional(),
    target_genders: z.array(z.string().max(30)).optional(),
    target_districts: z.array(z.string().max(120)).optional(),
  })
  .strict();

const workingHoursSchema = z.object({
  start: z.string().max(10).optional(),
  end: z.string().max(10).optional(),
  timezone: z.string().max(60).optional(),
});

const jobProfileSchema = z.object({
  business_profile_id: z.string().uuid(),
  brand_profile_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(16000).nullable().optional(),
  responsibilities: z.array(z.string().max(1000)).optional(),
  requirements: z.array(z.string().max(1000)).optional(),
  skills: z.array(z.string().max(120)).optional(),
  min_experience_years: z.number().int().min(0).nullable().optional(),
  max_experience_years: z.number().int().min(0).nullable().optional(),
  education: z.string().max(500).nullable().optional(),
  employment_type: z.enum(['full_time', 'part_time', 'contract', 'internship']).optional(),
  work_mode: z.enum(['onsite', 'remote', 'hybrid']).optional(),
  location_id: z.string().uuid().nullable().optional(),
  working_days: z.array(z.string().max(10)).optional(),
  working_hours: workingHoursSchema.nullable().optional(),
  salary_min: z.number().int().min(0).nullable().optional(),
  salary_max: z.number().int().min(0).nullable().optional(),
  salary_currency: z.string().max(10).optional(),
  salary_period: z.enum(['monthly', 'annual']).optional(),
  benefits: z.array(z.string().max(300)).optional(),
  growth_path: z.string().max(4000).nullable().optional(),
  preference_rules: preferenceRulesSchema.optional(),
  squadhire_category_ids: z.array(z.string().uuid()).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

// ============================================================
// Business profiles
// ============================================================

router.get('/business-profiles', async (req: Request, res: Response) => {
  try {
    let query = supabaseAdmin
      .from('business_profiles')
      .select('*')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });
    if (typeof req.query.client_id === 'string' && req.query.client_id) {
      query = query.eq('client_id', req.query.client_id);
    }
    if (typeof req.query.lead_submission_id === 'string' && req.query.lead_submission_id) {
      query = query.eq('lead_submission_id', req.query.lead_submission_id);
    }
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      query = query.ilike('name', `%${req.query.search.trim()}%`);
    }
    const { data, error } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data ?? [] });
  } catch (err: any) {
    console.error('List business profiles error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.post('/business-profiles', async (req: Request, res: Response) => {
  try {
    const body = businessProfileSchema.parse(req.body);
    // chk_bp_owner: a business profile always hangs off the lead pipeline.
    if (!body.lead_submission_id && !body.client_id) {
      res.status(400).json({ success: false, error: 'A business profile must link a lead submission or a client' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('business_profiles')
      .insert({
        lead_submission_id: body.lead_submission_id ?? null,
        client_id: body.client_id ?? null,
        name: body.name,
        about: body.about ?? null,
        industry: body.industry ?? null,
        company_size: body.company_size ?? null,
        website: body.website ?? null,
        socials: body.socials ?? {},
        logo_url: body.logo_url ?? null,
        photos: body.photos ?? [],
        culture: body.culture ?? null,
        perks: body.perks ?? [],
        founded_year: body.founded_year ?? null,
        contact_name: body.contact_name ?? null,
        contact_email: body.contact_email ?? null,
        contact_phone: body.contact_phone ?? null,
        created_by: req.userId!,
      })
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create business profile error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.get('/business-profiles/:id', async (req: Request, res: Response) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('business_profiles')
      .select('*')
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!profile) {
      res.status(404).json({ success: false, error: 'Business profile not found' });
      return;
    }
    const [{ data: locations }, { data: brands }, { data: jobProfiles }] = await Promise.all([
      supabaseAdmin
        .from('business_locations')
        .select('*')
        .eq('business_profile_id', profile.id)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('brand_profiles')
        .select('*')
        .eq('business_profile_id', profile.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('job_profiles')
        .select('*')
        .eq('business_profile_id', profile.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true }),
    ]);
    res.json({
      success: true,
      data: { ...profile, locations: locations ?? [], brands: brands ?? [], job_profiles: jobProfiles ?? [] },
    });
  } catch (err: any) {
    console.error('Get business profile error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.patch('/business-profiles/:id', async (req: Request, res: Response) => {
  try {
    const body = businessProfileSchema.partial().parse(req.body);
    const { data: existing } = await supabaseAdmin
      .from('business_profiles')
      .select('id')
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!existing) {
      res.status(404).json({ success: false, error: 'Business profile not found' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('business_profiles')
      .update(body)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    // Keep the SquadHire snapshots fresh on every published card this
    // business feeds (fire-and-forget).
    redeliverForBusinessProfile(req.params.id as string).catch((err) =>
      console.error('[job-profiles] business redelivery error', err),
    );
    res.json({ success: true, data });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Patch business profile error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.delete('/business-profiles/:id', async (req: Request, res: Response) => {
  try {
    // Refuse while live (non-closed) cards depend on it via any job profile.
    const { data: profiles } = await supabaseAdmin
      .from('job_profiles')
      .select('id')
      .eq('business_profile_id', req.params.id)
      .is('deleted_at', null);
    const profileIds = (profiles ?? []).map((p: any) => p.id as string);
    if (profileIds.length > 0) {
      const { count } = await supabaseAdmin
        .from('job_cards')
        .select('id', { count: 'exact', head: true })
        .in('job_profile_id', profileIds)
        .neq('state', 'closed')
        .is('deleted_at', null);
      if ((count ?? 0) > 0) {
        res.status(409).json({ success: false, error: 'Business profile is in use by live job cards' });
        return;
      }
    }
    const { error } = await supabaseAdmin
      .from('business_profiles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('Delete business profile error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// Business locations (interview-venue dropdown)
// ============================================================

router.get('/business-profiles/:id/locations', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('business_locations')
      .select('*')
      .eq('business_profile_id', req.params.id)
      .order('created_at', { ascending: true });
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data ?? [] });
  } catch (err: any) {
    console.error('List business locations error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.post('/business-profiles/:id/locations', async (req: Request, res: Response) => {
  try {
    const body = locationSchema.parse(req.body);
    const { data: profile } = await supabaseAdmin
      .from('business_profiles')
      .select('id')
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!profile) {
      res.status(404).json({ success: false, error: 'Business profile not found' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('business_locations')
      .insert({ ...body, business_profile_id: req.params.id })
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create business location error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.patch('/business-locations/:id', async (req: Request, res: Response) => {
  try {
    const body = locationSchema.partial().parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('business_locations')
      .update(body)
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Location not found' });
      return;
    }
    res.json({ success: true, data });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Patch business location error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.delete('/business-locations/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('business_locations')
      .delete()
      .eq('id', req.params.id);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('Delete business location error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// Brand profiles
// ============================================================

router.post('/business-profiles/:id/brands', async (req: Request, res: Response) => {
  try {
    const body = brandProfileSchema.parse(req.body);
    const { data: profile } = await supabaseAdmin
      .from('business_profiles')
      .select('id')
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!profile) {
      res.status(404).json({ success: false, error: 'Business profile not found' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('brand_profiles')
      .insert({
        business_profile_id: req.params.id,
        name: body.name,
        about: body.about ?? null,
        industry: body.industry ?? null,
        website: body.website ?? null,
        socials: body.socials ?? {},
        logo_url: body.logo_url ?? null,
        photos: body.photos ?? [],
      })
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create brand profile error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.patch('/brand-profiles/:id', async (req: Request, res: Response) => {
  try {
    const body = brandProfileSchema.partial().parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('brand_profiles')
      .update(body)
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .select('*')
      .maybeSingle();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Brand profile not found' });
      return;
    }
    redeliverForBrandProfile(req.params.id as string).catch((err) =>
      console.error('[job-profiles] brand redelivery error', err),
    );
    res.json({ success: true, data });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Patch brand profile error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.delete('/brand-profiles/:id', async (req: Request, res: Response) => {
  try {
    const { count } = await supabaseAdmin
      .from('job_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('brand_profile_id', req.params.id)
      .is('deleted_at', null);
    if ((count ?? 0) > 0) {
      res.status(409).json({ success: false, error: 'Brand profile is in use by job profiles' });
      return;
    }
    const { error } = await supabaseAdmin
      .from('brand_profiles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('Delete brand profile error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// Job profiles
// ============================================================

router.get('/job-profiles', async (req: Request, res: Response) => {
  try {
    let query = supabaseAdmin
      .from('job_profiles')
      .select('*')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });
    if (typeof req.query.business_profile_id === 'string' && req.query.business_profile_id) {
      query = query.eq('business_profile_id', req.query.business_profile_id);
    }
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      query = query.ilike('title', `%${req.query.search.trim()}%`);
    }
    const { data, error } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data ?? [] });
  } catch (err: any) {
    console.error('List job profiles error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.post('/job-profiles', async (req: Request, res: Response) => {
  try {
    const body = jobProfileSchema.parse(req.body);
    const { data: business } = await supabaseAdmin
      .from('business_profiles')
      .select('id')
      .eq('id', body.business_profile_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!business) {
      res.status(404).json({ success: false, error: 'Business profile not found' });
      return;
    }
    if (body.brand_profile_id) {
      const { data: brand } = await supabaseAdmin
        .from('brand_profiles')
        .select('id, business_profile_id')
        .eq('id', body.brand_profile_id)
        .is('deleted_at', null)
        .maybeSingle();
      if (!brand || brand.business_profile_id !== body.business_profile_id) {
        res.status(400).json({ success: false, error: 'Brand does not belong to this business profile' });
        return;
      }
    }
    const { data, error } = await supabaseAdmin
      .from('job_profiles')
      .insert({
        business_profile_id: body.business_profile_id,
        brand_profile_id: body.brand_profile_id ?? null,
        title: body.title,
        description: body.description ?? null,
        responsibilities: body.responsibilities ?? [],
        requirements: body.requirements ?? [],
        skills: body.skills ?? [],
        min_experience_years: body.min_experience_years ?? null,
        max_experience_years: body.max_experience_years ?? null,
        education: body.education ?? null,
        employment_type: body.employment_type ?? 'full_time',
        work_mode: body.work_mode ?? 'onsite',
        location_id: body.location_id ?? null,
        working_days: body.working_days ?? [],
        working_hours: body.working_hours ?? null,
        salary_min: body.salary_min ?? null,
        salary_max: body.salary_max ?? null,
        salary_currency: body.salary_currency ?? 'INR',
        salary_period: body.salary_period ?? 'monthly',
        benefits: body.benefits ?? [],
        growth_path: body.growth_path ?? null,
        preference_rules: body.preference_rules ?? {},
        squadhire_category_ids: body.squadhire_category_ids ?? [],
        status: body.status ?? 'active',
        created_by: req.userId!,
      })
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create job profile error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.get('/job-profiles/:id', async (req: Request, res: Response) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('job_profiles')
      .select('*')
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!profile) {
      res.status(404).json({ success: false, error: 'Job profile not found' });
      return;
    }
    const [{ data: business }, { data: brand }, { data: location }] = await Promise.all([
      supabaseAdmin
        .from('business_profiles')
        .select('*')
        .eq('id', profile.business_profile_id)
        .maybeSingle(),
      profile.brand_profile_id
        ? supabaseAdmin
            .from('brand_profiles')
            .select('*')
            .eq('id', profile.brand_profile_id)
            .maybeSingle()
        : Promise.resolve({ data: null } as { data: any }),
      profile.location_id
        ? supabaseAdmin
            .from('business_locations')
            .select('*')
            .eq('id', profile.location_id)
            .maybeSingle()
        : Promise.resolve({ data: null } as { data: any }),
    ]);
    res.json({
      success: true,
      data: { ...profile, business_profile: business ?? null, brand_profile: brand ?? null, location: location ?? null },
    });
  } catch (err: any) {
    console.error('Get job profile error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.patch('/job-profiles/:id', async (req: Request, res: Response) => {
  try {
    const body = jobProfileSchema.partial().parse(req.body);
    const { data: existing } = await supabaseAdmin
      .from('job_profiles')
      .select('id, business_profile_id')
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (!existing) {
      res.status(404).json({ success: false, error: 'Job profile not found' });
      return;
    }
    if (body.brand_profile_id) {
      const { data: brand } = await supabaseAdmin
        .from('brand_profiles')
        .select('id, business_profile_id')
        .eq('id', body.brand_profile_id)
        .is('deleted_at', null)
        .maybeSingle();
      const businessId = body.business_profile_id ?? existing.business_profile_id;
      if (!brand || brand.business_profile_id !== businessId) {
        res.status(400).json({ success: false, error: 'Brand does not belong to this business profile' });
        return;
      }
    }
    const { data, error } = await supabaseAdmin
      .from('job_profiles')
      .update(body)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    // Published cards built on this profile must reflect the edit on
    // SquadHire (effective rules AND the candidate-facing snapshot).
    redeliverPublishedCardsForJobProfiles([req.params.id as string]).catch((err) =>
      console.error('[job-profiles] job profile redelivery error', err),
    );
    res.json({ success: true, data });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Patch job profile error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.delete('/job-profiles/:id', async (req: Request, res: Response) => {
  try {
    const { count } = await supabaseAdmin
      .from('job_cards')
      .select('id', { count: 'exact', head: true })
      .eq('job_profile_id', req.params.id)
      .neq('state', 'closed')
      .is('deleted_at', null);
    if ((count ?? 0) > 0) {
      res.status(409).json({ success: false, error: 'Job profile is in use by live job cards' });
      return;
    }
    const { error } = await supabaseAdmin
      .from('job_profiles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('Delete job profile error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
