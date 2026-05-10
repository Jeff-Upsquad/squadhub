import { Router, Request, Response } from 'express';
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

const submissionSchema = z.object({
  service_type: z.enum(['designer', 'video_editor', 'designer_video_editor']),
  brand_name: z.string().trim().min(1).max(200),
  business_nature: z.string().trim().min(1).max(200),
  business_note: z.string().trim().min(1).max(2000),
  requirement_note: z.string().trim().max(2000).optional().or(z.literal('')),
  company: z.string().trim().min(1).max(200),
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

// POST /leads/landing — public lead-capture form submission (no auth)
// Inserts a draft subscription_card with source='landing_page_form'.
router.post('/landing', async (req: Request, res: Response) => {
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

    // Pre-resolve SquadHire categories tied to the chosen subscription so
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
        source: 'landing_page_form',
        state: 'draft',
        markup: 0,
        service_type: serviceTypeLabel,
        target_tiers: [],
        working_days: body.working_days,
        customer_name: body.contact_name,
        customer_email: body.email,
        customer_company: body.company,
        customer_phone: body.phone,
        customer_location: body.business_location || null,
        target_languages: body.languages,
        squadhire_category_ids: squadhireCategoryIds,
        brand_name: body.brand_name,
        business_nature: body.business_nature,
        notes: body.business_note,
        requirement_note: body.requirement_note || null,
        publish_targets: ['partner', 'talent'],
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
