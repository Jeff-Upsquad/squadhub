import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAnyMiniAppOrAdmin } from '../middleware/miniApp';
import { supabaseAdmin } from '../supabase';
import { getPartnerFacingHistory, getPartnerFacingMonth } from '../services/partnerPayments';

// Partner Payments mini app. Partner-facing view of subscription assignment
// terms: assigned clients (work dates), the month's prorated payout and a
// derived monthly payouts series with commission status.
//
// Payout status comes from the shared `partner_payment_statuses` store (the
// same rows the admin module and SquadBooks write), mapped through
// toPartnerFacingStatus(): `on_hold` reads as "pending" here and the internal
// hold_reason is never sent to this surface. Until that store existed, this
// route reported a hardcoded "pending" for every month, so partners saw
// "pending" against payouts that had already been marked paid.
//
// Scoping: partner callers always see only their own rows
// (recipient_id = req.userId — in this context talent and partner assignments
// are treated as the same, so no recipient_type filter is applied anywhere).
// Internal admins pass the mini-app gate automatically and may preview any
// recipient via ?recipient_id=; without it /me returns every recipient that
// has ever held a term (talent or partner) so the UI can offer a picker.

const router = Router();
router.use(requireAuth);
router.use(requireAnyMiniAppOrAdmin(['partner-payments']));

async function isInternalAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('users').select('is_admin').eq('id', userId).single();
  return !!data?.is_admin;
}

/** Resolve whose data this request may read. Admin callers may target any partner. */
async function resolveScope(
  req: Request,
): Promise<{ err?: string; selfId?: string; isAdmin?: boolean; targetId?: string }> {
  const userId = req.userId!;
  const admin = await isInternalAdmin(userId);
  if (admin) {
    const requested = typeof req.query.recipient_id === 'string' ? req.query.recipient_id : '';
    if (requested) return { isAdmin: true, targetId: requested };
    return { isAdmin: true };
  }
  // Partners (and their staff) are scoped to their own user id.
  if (req.userType === 'partner' || req.userType === 'partner_employee') {
    return { selfId: userId, isAdmin: false, targetId: userId };
  }
  return { err: 'Partner Payments is available to partner accounts. Ask an admin to grant your user access.' };
}

// GET /partner-payments/me
// Caller context for the UI: partners get their own identity; internal admins
// get every recipient that has ever held a term (talent or partner) so they
// can preview each one.
router.get('/me', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const admin = await isInternalAdmin(userId);
    if (admin) {
      const { data, error } = await supabaseAdmin
        .from('subscription_assignment_terms')
        .select('recipient_id, recipient_name');
      if (error) { res.status(500).json({ success: false, error: error.message }); return; }
      const byId = new Map<string, string | null>();
      (data || []).forEach((r: any) => {
        if (!byId.has(r.recipient_id)) byId.set(r.recipient_id, r.recipient_name ?? null);
        else if (r.recipient_name && !byId.get(r.recipient_id)) byId.set(r.recipient_id, r.recipient_name);
      });
      const recipients = [...byId.entries()]
        .map(([recipient_id, name]) => ({ recipient_id, recipient_name: name }))
        .sort((a, b) => (a.recipient_name || '').localeCompare(b.recipient_name || ''));
      res.json({ success: true, data: { mode: 'admin', recipients } });
      return;
    }
    if (req.userType === 'partner' || req.userType === 'partner_employee') {
      const { data } = await supabaseAdmin
        .from('users')
        .select('display_name')
        .eq('id', userId)
        .maybeSingle();
      res.json({
        success: true,
        data: { mode: 'self', recipient_id: userId, recipient_name: data?.display_name ?? null },
      });
      return;
    }
    res.status(403).json({
      success: false,
      error: 'Partner Payments is available to partner accounts. Ask an admin to grant your user access.',
    });
  } catch (err: any) {
    console.error('[partner-payments] me error', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// GET /partner-payments/month?month=YYYY-MM&recipient_id=
// One month's detail for one recipient: per-client cards (dates, plan, prorated
// pay incl. additional hours) + totals. Mirrors the admin module's math via
// the same shared utils.
router.get('/month', async (req: Request, res: Response) => {
  try {
    const scope = await resolveScope(req);
    if (scope.err) { res.status(403).json({ success: false, error: scope.err }); return; }
    const recipientId = scope.targetId;
    if (!recipientId) { res.status(400).json({ success: false, error: 'recipient_id is required' }); return; }

    // THE partner-facing calculator (services/partnerPayments.ts), shared with
    // the Squad Hub SaaS bridge so both surfaces show identical numbers.
    const data = await getPartnerFacingMonth(recipientId, req.query.month);
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('[partner-payments] month error', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// GET /partner-payments/history?months=12&recipient_id=
// Monthly payout series for the last N months (default 12), each carrying the
// month's real payout status from the shared store (partner-facing vocabulary
// only — see toPartnerFacingStatus).
router.get('/history', async (req: Request, res: Response) => {
  try {
    const scope = await resolveScope(req);
    if (scope.err) { res.status(403).json({ success: false, error: scope.err }); return; }
    const recipientId = scope.targetId;
    if (!recipientId) { res.status(400).json({ success: false, error: 'recipient_id is required' }); return; }

    const countRaw = Number(req.query.months);
    const count = Number.isFinite(countRaw) ? countRaw : 12;
    const data = await getPartnerFacingHistory(recipientId, count);
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('[partner-payments] history error', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
