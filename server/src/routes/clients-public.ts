import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { isValidStoredPhone, normalizeStoredPhone } from '@squadhub/shared';
import { supabaseAdmin } from '../supabase';
import { getEligibleSalesUserIds } from './onboarding-links';

const router = Router();

const contactNumberSchema = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .transform((v) => normalizeStoredPhone(v))
  .refine((v) => isValidStoredPhone(v), {
    message: 'Enter a valid phone number (10 digits for India)',
  });

// POST /clients/onboard — public onboarding form submission (no auth)
// GET /clients/countries — public list of active countries (for onboarding form)
// GET /clients/onboarding-links/:token — validate a tokenized invite link
router.get('/countries', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('countries')
      .select('id, name, currency, sort_order')
      .eq('is_active', true)
      .order('sort_order');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('List public countries error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /clients/onboarding-links/:token — validate a tokenized link
// Returns metadata (primary SP) + status flags. No auth.
router.get('/onboarding-links/:token', async (req: Request, res: Response) => {
  try {
    const tokenSchema = z.string().uuid();
    const parsed = tokenSchema.safeParse(req.params.token);
    if (!parsed.success) {
      res.json({ success: true, data: { valid: false, expired: false, used: false } });
      return;
    }

    const { data: link } = await supabaseAdmin
      .from('client_onboarding_links')
      .select('*')
      .eq('id', parsed.data)
      .maybeSingle();

    if (!link) {
      res.json({ success: true, data: { valid: false, expired: false, used: false } });
      return;
    }

    const used = !!link.submission_id;
    const expired = new Date(link.expires_at).getTime() < Date.now();

    let primary_sales_person: any = null;
    if (link.primary_sales_person_id) {
      const { data: p } = await supabaseAdmin
        .from('users')
        .select('id, display_name, email, avatar_url')
        .eq('id', link.primary_sales_person_id)
        .maybeSingle();
      primary_sales_person = p || null;
    }

    let secondary_sales_person: any = null;
    if (link.secondary_sales_person_id) {
      const { data: s } = await supabaseAdmin
        .from('users')
        .select('id, display_name, email, avatar_url')
        .eq('id', link.secondary_sales_person_id)
        .maybeSingle();
      secondary_sales_person = s || null;
    }

    res.json({
      success: true,
      data: {
        valid: !used && !expired,
        expired,
        used,
        expires_at: link.expires_at,
        primary_sales_person,
        secondary_sales_person,
      },
    });
  } catch (err) {
    console.error('Validate onboarding link error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const onboardSchema = z.object({
  business_name: z.string().min(1).max(200),
  contact_person: z.string().min(1).max(200),
  designation: z.string().max(200).optional(),
  contact_number: contactNumberSchema,
  email: z.string().email(),
  business_address: z.string().min(1).max(1000),
  gst_registered: z.boolean(),
  gst_number: z.string().max(50).optional(),
  accounts_email: z.string().email().optional().or(z.literal('')),
  country_id: z.string().uuid(),
  token: z.string().uuid(),
  secondary_sales_person_id: z.string().uuid().nullable().optional(),
});

router.post('/onboard', async (req: Request, res: Response) => {
  try {
    const body = onboardSchema.parse(req.body);

    // Validate token: exists, not expired, not used
    const { data: link } = await supabaseAdmin
      .from('client_onboarding_links')
      .select('*')
      .eq('id', body.token)
      .maybeSingle();

    if (!link) {
      res.status(400).json({ success: false, error: 'Invalid invite link' });
      return;
    }
    if (link.submission_id) {
      res.status(400).json({ success: false, error: 'This invite link has already been used' });
      return;
    }
    if (new Date(link.expires_at).getTime() < Date.now()) {
      res.status(400).json({ success: false, error: 'This invite link has expired' });
      return;
    }

    // Secondary SP: body > link (if body provides one, validate it's in Sales pool)
    let secondaryId: string | null = link.secondary_sales_person_id || null;
    if (body.secondary_sales_person_id !== undefined) {
      secondaryId = body.secondary_sales_person_id;
      if (secondaryId) {
        const allowed = new Set(await getEligibleSalesUserIds());

        if (!allowed.has(secondaryId)) {
          res.status(400).json({ success: false, error: 'Selected secondary sales person is not eligible' });
          return;
        }
        if (secondaryId === link.primary_sales_person_id) {
          res.status(400).json({ success: false, error: 'Secondary sales person must differ from primary' });
          return;
        }
      }
    }

    const { data: submission, error: subErr } = await supabaseAdmin
      .from('client_submissions')
      .insert({
        business_name: body.business_name,
        contact_person: body.contact_person,
        designation: body.designation || null,
        contact_number: body.contact_number,
        email: body.email,
        business_address: body.business_address,
        gst_registered: body.gst_registered,
        gst_number: body.gst_registered ? (body.gst_number || null) : null,
        accounts_email: body.accounts_email || null,
        country_id: body.country_id,
        primary_sales_person_id: link.primary_sales_person_id,
        secondary_sales_person_id: secondaryId,
        onboarding_link_id: link.id,
      })
      .select()
      .single();

    if (subErr || !submission) {
      res.status(500).json({ success: false, error: subErr?.message || 'Failed to submit' });
      return;
    }

    // Mark the link as used (single-use). If this fails, the submission still exists,
    // but a second attempt will be caught by the submission_id check above.
    await supabaseAdmin
      .from('client_onboarding_links')
      .update({ submission_id: submission.id })
      .eq('id', link.id);

    res.json({ success: true, data: submission });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Client onboarding error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
