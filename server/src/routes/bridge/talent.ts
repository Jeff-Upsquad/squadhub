// ============================================================
// Bridge — talent endpoints (called by Squad Hub SaaS).
//
//   GET /bridge/v1/talent/:hubPartnerUserId/assignments[?include_ended=1]
//   GET /bridge/v1/talent/:hubPartnerUserId/opportunities
//   GET /bridge/v1/talent/:hubPartnerUserId/payouts?month=YYYY-MM
//   GET /bridge/v1/talent/:hubPartnerUserId/payouts/history[?months=12]
//
// Payouts go through THE partner-facing calculator the partner-payments mini
// app uses (services/partnerPayments.ts getPartnerFacingMonth/History), keyed
// by recipient_id = hubPartnerUserId exactly like the mini app keys a partner
// caller by their own user id. Opportunities reuse the Discover feed
// (listDiscoverOpportunities). Assignments read the assignment-terms ledger.
// ============================================================
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../supabase';
import { listDiscoverOpportunities } from '../discover-partner';
import { getPartnerFacingHistory, getPartnerFacingMonth } from '../../services/partnerPayments';

const router = Router();

async function loadTalentUser(req: Request, res: Response): Promise<any | null> {
  const parsed = z.string().uuid().safeParse(req.params.hubPartnerUserId);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'hubPartnerUserId must be a uuid' });
    return null;
  }
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, email, display_name, user_type, status')
    .eq('id', parsed.data)
    .maybeSingle();
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return null;
  }
  if (!user) {
    res.status(404).json({ success: false, error: 'User not found' });
    return null;
  }
  return user;
}

router.get('/talent/:hubPartnerUserId/assignments', async (req: Request, res: Response) => {
  try {
    const user = await loadTalentUser(req, res);
    if (!user) return;
    const includeEnded = req.query.include_ended === '1' || req.query.include_ended === 'true';

    // A migrated SquadHire talent's terms are keyed by their SquadHire id; link
    // them through the email on their card recipient rows (same resolution the
    // Discover inbox and space hand-off use).
    const recipientIds = new Set<string>([user.id]);
    if (user.email) {
      const { data: ext } = await supabaseAdmin
        .from('subscription_card_external_recipients')
        .select('external_user_id')
        .ilike('email', String(user.email).trim());
      for (const r of (ext || []) as any[]) if (r.external_user_id) recipientIds.add(String(r.external_user_id));
    }

    let q = supabaseAdmin
      .from('subscription_assignment_terms')
      .select('id, card_id, recipient_type, recipient_id, business_name, subscription_name, assigned_date, unassigned_date, work_start_date, work_end_date, status')
      .in('recipient_id', [...recipientIds])
      .order('assigned_date', { ascending: false });
    if (!includeEnded) q = q.eq('status', 'active');
    const { data: terms, error } = await q;
    if (error) {
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    const cardIds = [...new Set(((terms || []) as any[]).map((t) => t.card_id))];
    const [{ data: cards }, { data: wsRows }] = await Promise.all([
      cardIds.length
        ? supabaseAdmin
            .from('subscription_cards')
            .select('id, card_code, card_type, service_type, plan_name, brand_name, state, paused_at, cancelled_at, deleted_at, linked_folder_id, plan_snapshot')
            .in('id', cardIds)
        : Promise.resolve({ data: [] as any[] }),
      cardIds.length
        ? supabaseAdmin.from('saas_card_workspaces').select('hub_card_id, shared_workspace_id, status').in('hub_card_id', cardIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const cardById = new Map<string, any>(((cards || []) as any[]).map((c) => [c.id, c]));
    const wsByCard = new Map<string, any>(((wsRows || []) as any[]).map((w) => [w.hub_card_id, w]));

    const data = ((terms || []) as any[])
      .filter((t) => !cardById.get(t.card_id)?.deleted_at)
      .map((t) => {
        const c = cardById.get(t.card_id) || {};
        return {
          term_id: t.id,
          hub_card_id: t.card_id,
          card_code: c.card_code ?? null,
          card_type: c.card_type ?? 'subscription',
          service_type: c.service_type ?? null,
          plan_name: c.plan_name ?? null,
          weekly_hours: c.plan_snapshot?.plan?.weekly_hours ?? null,
          business_name: t.business_name ?? c.brand_name ?? null,
          subscription_name: t.subscription_name,
          term_status: t.status,
          card_state: c.state ?? null,
          paused: !!c.paused_at,
          cancelled: !!c.cancelled_at,
          work_start_date: (t.work_start_date || t.assigned_date || '').slice(0, 10) || null,
          work_end_date: (t.work_end_date || t.unassigned_date || '').slice(0, 10) || null,
          recipient_type: t.recipient_type,
          saas_shared_workspace_id: wsByCard.get(t.card_id)?.shared_workspace_id ?? null,
        };
      });
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('[bridge] talent assignments error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.get('/talent/:hubPartnerUserId/opportunities', async (req: Request, res: Response) => {
  try {
    const user = await loadTalentUser(req, res);
    if (!user) return;
    if (!user.email) {
      res.status(400).json({ success: false, error: 'User has no email address' });
      return;
    }
    const data = await listDiscoverOpportunities(user.id, user.email);
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('[bridge] talent opportunities error:', err?.message);
    res.status(err?.status || 502).json({ success: false, error: err?.message || 'Could not load opportunities' });
  }
});

router.get('/talent/:hubPartnerUserId/payouts/history', async (req: Request, res: Response) => {
  try {
    const user = await loadTalentUser(req, res);
    if (!user) return;
    const countRaw = Number(req.query.months);
    const data = await getPartnerFacingHistory(user.id, Number.isFinite(countRaw) ? countRaw : 12);
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('[bridge] talent payout history error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

router.get('/talent/:hubPartnerUserId/payouts', async (req: Request, res: Response) => {
  try {
    const user = await loadTalentUser(req, res);
    if (!user) return;
    const month = req.query.month;
    if (month !== undefined && !(typeof month === 'string' && /^\d{4}-\d{2}$/.test(month))) {
      res.status(400).json({ success: false, error: 'month must be YYYY-MM' });
      return;
    }
    const data = await getPartnerFacingMonth(user.id, month);
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('[bridge] talent payouts error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
