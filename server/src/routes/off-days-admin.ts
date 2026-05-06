import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

// GET / — list all off-day requests (with filters + pagination)
router.get('/', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const userId = req.query.user_id as string | undefined;
    const startDate = req.query.start_date as string | undefined;
    const endDate = req.query.end_date as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabaseAdmin
      .from('off_day_requests')
      .select('*, user:users(id, display_name, email, avatar_url)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status) query = query.eq('status', status);
    if (userId) query = query.eq('user_id', userId);
    if (startDate) query = query.gte('created_at', `${startDate}T00:00:00`);
    if (endDate) query = query.lte('created_at', `${endDate}T23:59:59`);

    const { data, error, count } = await query;

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data, total: count ?? 0, page, limit });
  } catch (err) {
    console.error('Admin list off-days error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /:id/approve
router.put('/:id/approve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminId = req.userId!;

    const { data: existing } = await supabaseAdmin
      .from('off_day_requests')
      .select('id, status')
      .eq('id', id)
      .single();

    if (!existing) {
      res.status(404).json({ success: false, error: 'Request not found' });
      return;
    }

    if (existing.status !== 'pending') {
      res.status(400).json({ success: false, error: 'Only pending requests can be approved' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('off_day_requests')
      .update({ status: 'approved', reviewed_by: adminId, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Approve off-day error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /:id/reject
router.put('/:id/reject', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adminId = req.userId!;

    const { data: existing } = await supabaseAdmin
      .from('off_day_requests')
      .select('id, status')
      .eq('id', id)
      .single();

    if (!existing) {
      res.status(404).json({ success: false, error: 'Request not found' });
      return;
    }

    if (existing.status !== 'pending') {
      res.status(400).json({ success: false, error: 'Only pending requests can be rejected' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('off_day_requests')
      .update({ status: 'rejected', reviewed_by: adminId, reviewed_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Reject off-day error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
