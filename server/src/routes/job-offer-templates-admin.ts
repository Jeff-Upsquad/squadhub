import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import {
  DEFAULT_OFFER_LETTER_TEMPLATE,
  renderOfferTemplate,
} from '../utils/offerTemplate';

/**
 * Offer-letter templates — CANONICAL on SquadHub (contract §1). Admin CRUD
 * lives here; SquadHire's business-portal composer pulls the template via the
 * signed GET /integrations/squadhire/jobs/offer-template and edits sections +
 * package per offer before send. Exactly one live default template (partial
 * unique index, migration 161).
 */

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

// ------------------------------------------------------------
// Lazy seed: the very first read plants the default template extracted from
// the sample offer letter, so the composer always has something to pull.
// ------------------------------------------------------------
async function ensureDefaultTemplate(): Promise<void> {
  const { count, error } = await supabaseAdmin
    .from('offer_letter_templates')
    .select('id', { count: 'exact', head: true })
    .is('archived_at', null);
  if (error || (count ?? 0) > 0) return;
  const { error: insErr } = await supabaseAdmin
    .from('offer_letter_templates')
    .insert(DEFAULT_OFFER_LETTER_TEMPLATE);
  if (insErr) {
    console.error('[offer-templates] default seed failed', insErr.message);
  }
}

// ------------------------------------------------------------
// Schemas
// ------------------------------------------------------------

const sectionSchema = z.object({
  key: z.string().min(1).max(60),
  title: z.string().max(300),
  body_html: z.string().max(30000),
});

const mergeFieldSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(200),
  source: z.enum(['candidate', 'card', 'business', 'manual']),
});

const compensationRowSchema = z.object({
  key: z.string().min(1).max(60),
  component: z.string().min(1).max(200),
  cadence: z.enum(['per_month', 'per_annum']),
});

const signatorySchema = z.object({
  name: z.string().max(200).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  signature_image_url: z.string().max(1000).nullable().optional(),
});

const templateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  job_profile_id: z.string().uuid().nullable().optional(),
  sections: z.array(sectionSchema).min(1),
  merge_fields: z.array(mergeFieldSchema).optional(),
  compensation_schema: z.array(compensationRowSchema).optional(),
  signatory: signatorySchema.optional(),
});

// ============================================================
// CRUD
// ============================================================

router.get('/', async (req: Request, res: Response) => {
  try {
    await ensureDefaultTemplate();
    let query = supabaseAdmin
      .from('offer_letter_templates')
      .select('*')
      .order('created_at', { ascending: false });
    if (req.query.include_archived !== 'true') {
      query = query.is('archived_at', null);
    }
    if (typeof req.query.job_profile_id === 'string' && req.query.job_profile_id) {
      query = query.eq('job_profile_id', req.query.job_profile_id);
    }
    const { data, error } = await query;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data ?? [] });
  } catch (err: any) {
    console.error('List offer templates error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = templateSchema.parse(req.body);
    if (body.job_profile_id) {
      const { data: profile } = await supabaseAdmin
        .from('job_profiles')
        .select('id')
        .eq('id', body.job_profile_id)
        .is('deleted_at', null)
        .maybeSingle();
      if (!profile) {
        res.status(404).json({ success: false, error: 'Job profile not found' });
        return;
      }
    }
    const { data, error } = await supabaseAdmin
      .from('offer_letter_templates')
      .insert({
        name: body.name,
        description: body.description ?? null,
        job_profile_id: body.job_profile_id ?? null,
        sections: body.sections,
        merge_fields: body.merge_fields ?? DEFAULT_OFFER_LETTER_TEMPLATE.merge_fields,
        compensation_schema: body.compensation_schema ?? DEFAULT_OFFER_LETTER_TEMPLATE.compensation_schema,
        signatory: body.signatory ?? {},
        is_default: false,
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
    console.error('Create offer template error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('offer_letter_templates')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('Get offer template error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const body = templateSchema.partial().parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('offer_letter_templates')
      .update(body)
      .eq('id', req.params.id)
      .is('archived_at', null)
      .select('*')
      .maybeSingle();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }
    res.json({ success: true, data });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Patch offer template error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// Archive (soft) — the single live default cannot be archived without a
// replacement or the composer would fall back to nothing.
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { data: template } = await supabaseAdmin
      .from('offer_letter_templates')
      .select('id, is_default, archived_at')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!template || template.archived_at) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }
    if (template.is_default) {
      res.status(409).json({ success: false, error: 'Set another template as default before archiving this one' });
      return;
    }
    const { error } = await supabaseAdmin
      .from('offer_letter_templates')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('Archive offer template error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /:id/set-default — swap the single live default atomically enough:
// clear the current default first (partial unique index allows only one).
// ============================================================
router.post('/:id/set-default', async (req: Request, res: Response) => {
  try {
    const { data: template } = await supabaseAdmin
      .from('offer_letter_templates')
      .select('id, archived_at')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!template || template.archived_at) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }
    const { error: clearErr } = await supabaseAdmin
      .from('offer_letter_templates')
      .update({ is_default: false })
      .eq('is_default', true)
      .is('archived_at', null);
    if (clearErr) {
      res.status(500).json({ success: false, error: clearErr.message });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('offer_letter_templates')
      .update({ is_default: true })
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('Set default offer template error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ============================================================
// POST /:id/preview — render with sample/user-provided merge values
// ============================================================
const previewSchema = z.object({
  merge_values: z.record(z.union([z.string(), z.number()])).optional(),
});

router.post('/:id/preview', async (req: Request, res: Response) => {
  try {
    const body = previewSchema.parse(req.body ?? {});
    const { data: template } = await supabaseAdmin
      .from('offer_letter_templates')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!template) {
      res.status(404).json({ success: false, error: 'Template not found' });
      return;
    }
    const sampleValues: Record<string, string> = {
      candidate_name: 'A. Candidate',
      position: 'Graphic Designer',
      effective_date: '1 August 2026',
      join_by_date: '1 August 2026',
      expiry_date: '25 July 2026',
      document_date: new Date().toDateString(),
      business_name: 'Sample Business Pvt Ltd',
      brand_name: 'Sample Brand',
      workplace_location: 'Head Office',
      working_hours: '09:30 – 18:00 IST',
      working_days: 'Mon – Fri',
      signatory_name: 'Hiring Manager',
      signatory_title: 'Director',
    };
    const rendered = renderOfferTemplate(template as any, {
      ...sampleValues,
      ...(body.merge_values ?? {}),
    });
    res.json({ success: true, data: rendered });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Preview offer template error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
