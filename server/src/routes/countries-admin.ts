import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

// GET /admin/countries
router.get('/', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('countries')
      .select('*')
      .order('sort_order');

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('List countries error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  currency: z.enum(['INR', 'USD']),
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = createSchema.parse(req.body);

    const { data: existing } = await supabaseAdmin
      .from('countries')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1);
    const nextSort = ((existing?.[0]?.sort_order as number) ?? 0) + 1;

    const { data, error } = await supabaseAdmin
      .from('countries')
      .insert({ ...body, sort_order: nextSort })
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
    console.error('Create country error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  currency: z.enum(['INR', 'USD']).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).optional(),
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const body = updateSchema.parse(req.body);
    const { data, error } = await supabaseAdmin
      .from('countries')
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
    console.error('Update country error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /admin/countries/:id — only if no references exist
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const [{ count: planPricingCount }, { count: clientCount }, { count: submissionCount }] = await Promise.all([
      supabaseAdmin.from('subscription_plan_pricing').select('*', { count: 'exact', head: true }).eq('country_id', req.params.id),
      supabaseAdmin.from('clients').select('*', { count: 'exact', head: true }).eq('country_id', req.params.id),
      supabaseAdmin.from('client_submissions').select('*', { count: 'exact', head: true }).eq('country_id', req.params.id),
    ]);

    if ((planPricingCount || 0) > 0 || (clientCount || 0) > 0 || (submissionCount || 0) > 0) {
      res.status(400).json({ success: false, error: 'Country is in use by plans or clients. Deactivate instead.' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('countries')
      .delete()
      .eq('id', req.params.id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete country error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
