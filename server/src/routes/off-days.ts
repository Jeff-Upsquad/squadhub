import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);

const submitSchema = z
  .object({
    request_type: z.enum(['half_day', 'full_day', 'long_term']),
    date: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    reason: z.string().optional(),
  })
  .refine(
    (d) => {
      if (d.request_type === 'half_day' || d.request_type === 'full_day') return !!d.date;
      return !!d.start_date && !!d.end_date && d.end_date >= d.start_date;
    },
    { message: 'Invalid date fields for the selected request type' },
  );

// POST / — submit an off-day request
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const body = submitSchema.parse(req.body);

    const row: Record<string, unknown> = {
      user_id: userId,
      request_type: body.request_type,
      reason: body.reason || '',
    };

    if (body.request_type === 'half_day' || body.request_type === 'full_day') {
      row.date = body.date;
    } else {
      row.start_date = body.start_date;
      row.end_date = body.end_date;
    }

    const { data, error } = await supabaseAdmin
      .from('off_day_requests')
      .insert(row)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      res.status(400).json({ success: false, error: err.errors });
      return;
    }
    console.error('Submit off-day error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET / — list own requests
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const status = req.query.status as string | undefined;

    let query = supabaseAdmin
      .from('off_day_requests')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('List off-days error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// DELETE /:id — cancel a pending request
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('off_day_requests')
      .select('id, status')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (fetchErr || !existing) {
      res.status(404).json({ success: false, error: 'Request not found' });
      return;
    }

    if (existing.status !== 'pending') {
      res.status(400).json({ success: false, error: 'Only pending requests can be cancelled' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('off_day_requests')
      .delete()
      .eq('id', id);

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, message: 'Request cancelled' });
  } catch (err) {
    console.error('Cancel off-day error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
