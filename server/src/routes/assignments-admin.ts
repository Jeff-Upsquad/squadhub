import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { requireMiniAppOrAdmin } from '../middleware/miniApp';
import { supabaseAdmin } from '../supabase';
import {
  ensureUniqueServiceSlug,
  hydrateAssignmentService,
  loadAssignmentMargin,
  slugifyServiceName,
} from '../utils/assignmentCatalog';

const router = Router();

router.use(requireAuth);

// ============================================================
// Margin lookup for the card editor: service label + level (+ country)
// → the margin rule that will be applied to this card's amounts.
//
// The assignment twin of GET /admin/subscriptions/lookup, and like it,
// readable by the Leads mini app (which renders the same card editor).
//
// MUST stay above the parameterised routes below.
// ============================================================
router.get('/lookup', requireMiniAppOrAdmin('leads'), async (req: Request, res: Response) => {
  try {
    const service = String(req.query.service || '').trim();
    const tier = String(req.query.tier || '').trim();
    const countryId = String(req.query.country_id || '').trim() || null;
    if (!service || !tier) {
      res.status(400).json({ success: false, error: 'service and tier are required' });
      return;
    }

    const margin = await loadAssignmentMargin({ serviceType: service, tier, countryId });
    res.json({
      success: true,
      data: margin
        ? { margin_value: margin.margin_value, margin_type: margin.margin_type }
        : null,
    });
  } catch (err) {
    console.error('Assignment margin lookup error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Service list for pickers. Leads-readable like /lookup so the card editor
// can offer admin-added services (e.g. "Content") without a code change.
// ============================================================
router.get('/services', requireMiniAppOrAdmin('leads'), async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('assignment_services')
      .select('id, slug, name, is_active, sort_order')
      .eq('is_active', true)
      .order('sort_order');
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data: data || [] });
  } catch (err) {
    console.error('List assignment services error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Everything below is admin-only.
router.use(requireAdmin);

// GET /admin/assignment-catalog — every service with its margin rows
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data: services, error } = await supabaseAdmin
      .from('assignment_services')
      .select('*')
      .order('sort_order');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const hydrated = await Promise.all(
      (services || []).map((s: any) => hydrateAssignmentService(s.id)),
    );
    res.json({ success: true, data: hydrated.filter(Boolean) });
  } catch (err) {
    console.error('List assignment catalog error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const createServiceSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
});

// POST /admin/assignment-catalog — add a service (e.g. "Content")
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createServiceSchema.parse(req.body);
    const slug = await ensureUniqueServiceSlug(slugifyServiceName(body.name));

    const { data: last } = await supabaseAdmin
      .from('assignment_services')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1);
    const sortOrder = ((last?.[0] as any)?.sort_order ?? 0) + 1;

    const { data, error } = await supabaseAdmin
      .from('assignment_services')
      .insert({
        slug,
        name: body.name,
        description: body.description ?? null,
        sort_order: sortOrder,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.status(201).json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Create assignment service error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const updateServiceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  is_active: z.boolean().optional(),
});

// PUT /admin/assignment-catalog/:id — rename / describe / toggle
// The slug is immutable: cards resolve their margin through it.
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const body = updateServiceSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('assignment_services')
      .update(body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Update assignment service error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/assignment-catalog/:id — drops the service and its margins.
// Cards keep their service_type; they simply stop resolving a margin.
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('assignment_services')
      .delete()
      .eq('id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete assignment service error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================================
// Margins per level + country (upsert + delete) — same contract as
// /admin/subscriptions/plans/:planId/pricing, minus the price.
// ============================================================

const upsertMarginSchema = z.object({
  tier: z.enum(['Junior', 'Pro', 'Top Talents']),
  country_id: z.string().uuid(),
  margin_value: z.number().int().min(0),
  margin_type: z.enum(['fixed', 'percent']),
});

router.post('/:id/margins', async (req: Request, res: Response) => {
  try {
    const body = upsertMarginSchema.parse(req.body);
    if (body.margin_type === 'percent' && body.margin_value > 100) {
      res.status(400).json({ success: false, error: 'A percentage margin cannot exceed 100' });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from('assignment_service_margins')
      .upsert(
        {
          service_id: req.params.id,
          tier: body.tier,
          country_id: body.country_id,
          margin_value: body.margin_value,
          margin_type: body.margin_type,
        },
        { onConflict: 'service_id,tier,country_id' },
      )
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('Upsert assignment margin error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.delete('/:id/margins/:tier/:countryId', async (req: Request, res: Response) => {
  try {
    const { error } = await supabaseAdmin
      .from('assignment_service_margins')
      .delete()
      .eq('service_id', req.params.id)
      .eq('tier', req.params.tier)
      .eq('country_id', req.params.countryId);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete assignment margin error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
