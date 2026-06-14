import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

// Admin module: view + manage subscription assignment terms. Rows are created /
// closed automatically by the finalize-selection / unassign flow (see
// subscription-cards-admin-select.ts). Here the admin can list them and edit the
// work start / end dates (assigned / unassigned timestamps stay read-only audit).

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// GET /admin/subscription-assignments?status=active|ended|all&search=...
router.get('/', async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string) || 'all';
    const search = ((req.query.search as string) || '').trim();

    let query = supabaseAdmin
      .from('subscription_assignment_terms')
      .select('*')
      .order('assigned_date', { ascending: false });

    if (status === 'active' || status === 'ended') {
      query = query.eq('status', status);
    }
    if (search) {
      const safe = search.replace(/[%,]/g, ' ');
      query = query.or(
        `recipient_name.ilike.%${safe}%,business_name.ilike.%${safe}%,subscription_name.ilike.%${safe}%`,
      );
    }

    const { data, error } = await query;
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    res.json({ success: true, data: data || [] });
  } catch (err: any) {
    console.error('[subscription-assignments] list error', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// PATCH /admin/subscription-assignments/:id — edit the work start / end dates.
const updateSchema = z
  .object({
    work_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    work_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .strict();

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const body = updateSchema.parse(req.body);

    if (
      body.work_start_date &&
      body.work_end_date &&
      body.work_end_date < body.work_start_date
    ) {
      res.status(400).json({ success: false, error: 'Work end date cannot be before the work start date' });
      return;
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ('work_start_date' in body) patch.work_start_date = body.work_start_date ?? null;
    if ('work_end_date' in body) patch.work_end_date = body.work_end_date ?? null;

    const { data, error } = await supabaseAdmin
      .from('subscription_assignment_terms')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    if (!data) { res.status(404).json({ success: false, error: 'Assignment term not found' }); return; }
    res.json({ success: true, data });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('[subscription-assignments] update error', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
