import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import {
  listAssignmentTerms,
  listUserPayments,
  getUserPaymentDetail,
} from '../services/partnerPayments';
import {
  listPaymentStatuses,
  upsertPaymentStatus,
  isPaymentStatus,
} from '../services/partnerPaymentStatus';

// Admin module ("Partner Payments"): view + manage subscription assignment
// terms. Rows are created / closed automatically by the finalize-selection /
// unassign flow (see subscription-cards-admin-select.ts). Here the admin can
// list them, edit the work start / end dates (assigned / unassigned timestamps
// stay read-only audit), and set each payout's workflow status.
//
// All the payout MATH lives in services/partnerPayments.ts, shared with the
// partner mini app and with SquadBooks (via routes/squadbooks-integration.ts),
// so the three surfaces cannot disagree. This file is only routing + auth.

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// GET /admin/subscription-assignments?status=active|ended|all&search=...&month=YYYY-MM
// Without `month`: raw terms + card lifecycle (legacy shape).
// With `month`: each term enriched with that month's active-days, prorated pay,
// and frozen billing (partner price + committed hours), filtered to terms that
// were active in the month. The client folds multiple periods on one
// card·talent (pause/resume, plan change) into a single row.
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await listAssignmentTerms({
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
      month: req.query.month,
    });
    if (result.month) {
      res.json({ success: true, data: result.data, month: result.month });
      return;
    }
    res.json({ success: true, data: result.data });
  } catch (err: any) {
    console.error('[subscription-assignments] list error', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// ------------------------------------------------------------
// Payout workflow status (shared store — see services/partnerPaymentStatus.ts).
// Declared before /:id so "statuses" isn't swallowed by the term-id route.
// ------------------------------------------------------------

// GET /admin/subscription-assignments/statuses?month=YYYY-MM
router.get('/statuses', async (req: Request, res: Response) => {
  try {
    const month = String(req.query.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
      return;
    }
    const map = await listPaymentStatuses(month);
    res.json({ success: true, data: { month, statuses: [...map.values()] } });
  } catch (err: any) {
    console.error('[subscription-assignments] statuses list error', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

const statusSchema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
    recipient_type: z.enum(['talent', 'partner']),
    recipient_id: z.string().min(1),
    status: z.string().refine(isPaymentStatus, 'Invalid status'),
    hold_reason: z.string().nullable().optional(),
  })
  .strict();

// POST /admin/subscription-assignments/statuses — set one payout's status.
router.post('/statuses', async (req: Request, res: Response) => {
  try {
    const body = statusSchema.parse(req.body);
    const record = await upsertPaymentStatus({
      month: body.month,
      recipientType: body.recipient_type,
      recipientId: body.recipient_id,
      status: body.status as any,
      holdReason: body.hold_reason ?? null,
      source: 'hub',
      updatedBy: req.userId ?? null,
    });
    res.json({ success: true, data: record });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message });
      return;
    }
    console.error('[subscription-assignments] status upsert error', err);
    res.status(400).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// GET /admin/subscription-assignments/users?month=YYYY-MM&status=active|all&search=
// One row per recipient with the selected month's payment (per currency),
// committed weekly hours, and (talent) self-declared available hours.
router.get('/users', async (req: Request, res: Response) => {
  try {
    const data = await listUserPayments({
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
      month: req.query.month,
    });
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('[subscription-assignments] users list error', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// GET /admin/subscription-assignments/users/:recipientType/:recipientId?month=YYYY-MM
// Per-card breakdown for one recipient: start/stop, partner price, prorated
// month payment, committed hours, plus the talent's available-hours summary.
router.get('/users/:recipientType/:recipientId', async (req: Request, res: Response) => {
  try {
    const recipientType = req.params.recipientType as 'talent' | 'partner';
    if (recipientType !== 'talent' && recipientType !== 'partner') {
      res.status(400).json({ success: false, error: 'Invalid recipient type' });
      return;
    }
    const data = await getUserPaymentDetail({
      recipientType,
      recipientId: req.params.recipientId as string,
      month: req.query.month,
    });
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('[subscription-assignments] user detail error', err);
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
