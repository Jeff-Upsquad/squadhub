// ============================================================
// Bridge — time totals ingest + staff verification (called by Squad Hub SaaS).
//
//   POST /bridge/v1/time-totals      {date, entries:[{hub_card_id, hub_partner_user_id, minutes}]}
//                                    idempotent upsert per (date, card, partner)
//   GET  /bridge/v1/staff/:hubUserId verify an internal staff member is active
//                                    (for "Sign in with Squad Hub")
// ============================================================
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { timeTotalsSchema, upsertSaasTimeTotals } from '../../utils/saasTimeTotals';

const router = Router();

router.post('/time-totals', async (req: Request, res: Response) => {
  try {
    const parsed = timeTotalsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.errors[0]?.message || 'Invalid body' });
      return;
    }
    const result = await upsertSaasTimeTotals(parsed.data);
    res.json({ success: true, data: { date: parsed.data.date, ...result } });
  } catch (err: any) {
    console.error('[bridge] time totals error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.get('/staff/:hubUserId', async (req: Request, res: Response) => {
  try {
    const parsed = z.string().uuid().safeParse(req.params.hubUserId);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'hubUserId must be a uuid' });
      return;
    }
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, email, display_name, avatar_url, user_type, status, is_admin')
      .eq('id', parsed.data)
      .maybeSingle();
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    const isStaff = user.user_type === 'internal';
    res.json({
      success: true,
      data: {
        hub_user_id: user.id,
        email: user.email,
        name: user.display_name,
        avatar_url: user.avatar_url ?? null,
        user_type: user.user_type,
        status: user.status,
        is_admin: !!user.is_admin,
        is_staff: isStaff,
        // Only an ACTIVE INTERNAL user may sign into the SaaS as staff.
        active: isStaff && user.status === 'active',
      },
    });
  } catch (err: any) {
    console.error('[bridge] staff verify error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
