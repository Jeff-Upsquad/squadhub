import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { prorateMonthly, activeDaysInMonth } from '../utils/assignmentBilling';
import { fetchTalentAvailability } from '../utils/squadhireTalent';
import { loadCardBilling, CardBilling } from '../utils/cardBilling';

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

// ============================================================
// Per-user view: group assignment terms by recipient, with the monthly
// payment owed (partner price prorated by active days) and an hours insight
// (committed hours from the card vs. the talent's self-declared availability).
// ============================================================

type AssignmentTermRow = {
  id: string;
  card_id: string;
  recipient_type: 'talent' | 'partner';
  recipient_id: string;
  recipient_name: string | null;
  business_name: string | null;
  subscription_name: string | null;
  assigned_date: string;
  unassigned_date: string | null;
  work_start_date: string | null;
  work_end_date: string | null;
  status: 'active' | 'ended';
  // Term-level frozen billing (migration 152). Null on legacy terms → fall back
  // to the card's live plan_snapshot via resolveTermBilling().
  plan_snapshot: any | null;
  partner_price: number | null;
  subscription_price: number | null;
  currency: string | null;
};

// Effective billing for one term: prefer the values frozen on the term when it
// opened; fall back to the card's current plan_snapshot for legacy terms (which
// map 1:1 to their card's single plan, so the card value is still correct).
function resolveTermBilling(term: AssignmentTermRow, card: CardBilling | undefined): CardBilling {
  const snap = term.plan_snapshot ?? card?.plan_snapshot ?? null;
  const daily = snap?.plan?.daily_hours != null ? Number(snap.plan.daily_hours) : card?.daily_hours ?? null;
  const weekly = snap?.plan?.weekly_hours != null ? Number(snap.plan.weekly_hours) : card?.weekly_hours ?? null;
  const monthly =
    term.plan_snapshot != null
      ? weekly != null
        ? weekly * 4
        : card?.monthly_hours ?? null
      : card?.monthly_hours ?? null;
  const partnerPrice = term.partner_price != null ? term.partner_price : card?.partner_price ?? null;
  return {
    partner_price: partnerPrice,
    currency: term.currency ?? card?.currency ?? null,
    daily_hours: daily,
    weekly_hours: weekly,
    monthly_hours: monthly,
    missing_partner_price: partnerPrice == null,
    subscription_price: term.subscription_price ?? card?.subscription_price ?? null,
    plan_snapshot: snap,
  };
}

function parseMonth(raw: unknown): { year: number; month: number; key: string } {
  const s = typeof raw === 'string' && /^\d{4}-\d{2}$/.test(raw) ? raw : null;
  const now = new Date();
  const year = s ? Number(s.slice(0, 4)) : now.getUTCFullYear();
  const month = s ? Number(s.slice(5, 7)) : now.getUTCMonth() + 1;
  return { year, month, key: `${year}-${String(month).padStart(2, '0')}` };
}

function recipientKey(t: { recipient_type: string; recipient_id: string }) {
  return `${t.recipient_type}:${t.recipient_id}`;
}

// GET /admin/subscription-assignments/users?month=YYYY-MM&status=active|all&search=
// One row per recipient with the selected month's payment (per currency),
// committed weekly hours, and (talent) self-declared available hours.
router.get('/users', async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string) || 'active';
    const search = ((req.query.search as string) || '').trim();
    const { year, month } = parseMonth(req.query.month);
    const todayIso = new Date().toISOString().slice(0, 10);

    let query = supabaseAdmin.from('subscription_assignment_terms').select('*');
    if (search) {
      const safe = search.replace(/[%,]/g, ' ');
      query = query.or(
        `recipient_name.ilike.%${safe}%,business_name.ilike.%${safe}%,subscription_name.ilike.%${safe}%`,
      );
    }
    const { data, error } = await query;
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    const terms = (data || []) as AssignmentTermRow[];

    const billing = await loadCardBilling([...new Set(terms.map((t) => t.card_id))]);

    type Group = {
      recipient_type: 'talent' | 'partner';
      recipient_id: string;
      recipient_name: string | null;
      card_count: number;
      active_card_count: number;
      committed_weekly_hours: number;
      payments: Map<string, number>; // currency -> prorated total
      missing_pricing: boolean;
    };
    const groups = new Map<string, Group>();

    for (const t of terms) {
      const key = recipientKey(t);
      let g = groups.get(key);
      if (!g) {
        g = {
          recipient_type: t.recipient_type,
          recipient_id: t.recipient_id,
          recipient_name: t.recipient_name,
          card_count: 0,
          active_card_count: 0,
          committed_weekly_hours: 0,
          payments: new Map(),
          missing_pricing: false,
        };
        groups.set(key, g);
      }
      g.card_count += 1;
      if (t.status === 'active') g.active_card_count += 1;
      if (!g.recipient_name && t.recipient_name) g.recipient_name = t.recipient_name;

      const b = resolveTermBilling(t, billing.get(t.card_id));
      const start = t.work_start_date ?? t.assigned_date;
      const end = t.work_end_date ?? t.unassigned_date ?? null;
      const activeDays = activeDaysInMonth(start, end, year, month, todayIso);
      if (activeDays > 0 && b?.weekly_hours != null) g.committed_weekly_hours += b.weekly_hours;
      if (b) {
        if (b.missing_partner_price) g.missing_pricing = true;
        const pay = prorateMonthly(b.partner_price, start, end, year, month, todayIso);
        if (pay > 0) {
          const cur = b.currency || 'UNKNOWN';
          g.payments.set(cur, (g.payments.get(cur) || 0) + pay);
        }
      }
    }

    let list = [...groups.values()];
    if (status === 'active') list = list.filter((g) => g.active_card_count > 0);

    // Self-declared availability for talent recipients (graceful if SquadHire is down).
    const talentIds = list
      .filter((g) => g.recipient_type === 'talent')
      .map((g) => g.recipient_id);
    const availability = await fetchTalentAvailability(talentIds);

    const rows = list
      .map((g) => {
        const avail = g.recipient_type === 'talent' ? availability.get(g.recipient_id) : undefined;
        const available_weekly_hours =
          g.recipient_type === 'talent' ? avail?.weekly_hours ?? null : null;
        return {
          recipient_type: g.recipient_type,
          recipient_id: g.recipient_id,
          recipient_name: g.recipient_name,
          card_count: g.card_count,
          active_card_count: g.active_card_count,
          committed_weekly_hours: Math.round(g.committed_weekly_hours * 100) / 100,
          available_weekly_hours,
          utilization_pct:
            available_weekly_hours && available_weekly_hours > 0
              ? Math.round((g.committed_weekly_hours / available_weekly_hours) * 100)
              : null,
          payments: [...g.payments.entries()].map(([currency, amount]) => ({ currency, amount })),
          missing_pricing: g.missing_pricing,
        };
      })
      .sort((a, b) => {
        const ap = a.payments.reduce((s, p) => s + p.amount, 0);
        const bp = b.payments.reduce((s, p) => s + p.amount, 0);
        return bp - ap;
      });

    res.json({ success: true, data: { month: `${year}-${String(month).padStart(2, '0')}`, users: rows } });
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
    const recipientId = req.params.recipientId as string;
    if (recipientType !== 'talent' && recipientType !== 'partner') {
      res.status(400).json({ success: false, error: 'Invalid recipient type' });
      return;
    }
    const { year, month } = parseMonth(req.query.month);
    const todayIso = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabaseAdmin
      .from('subscription_assignment_terms')
      .select('*')
      .eq('recipient_type', recipientType)
      .eq('recipient_id', recipientId)
      .order('assigned_date', { ascending: false });
    if (error) { res.status(500).json({ success: false, error: error.message }); return; }
    const terms = (data || []) as AssignmentTermRow[];

    const billing = await loadCardBilling([...new Set(terms.map((t) => t.card_id))]);

    const paymentByCurrency = new Map<string, number>();
    let committedWeekly = 0;

    const cards = terms.map((t) => {
      const b = resolveTermBilling(t, billing.get(t.card_id));
      const start = t.work_start_date ?? t.assigned_date;
      const end = t.work_end_date ?? t.unassigned_date ?? null;
      const activeDays = activeDaysInMonth(start, end, year, month, todayIso);
      const monthPayment = b ? prorateMonthly(b.partner_price, start, end, year, month, todayIso) : 0;
      if (monthPayment > 0) {
        const cur = b?.currency || 'UNKNOWN';
        paymentByCurrency.set(cur, (paymentByCurrency.get(cur) || 0) + monthPayment);
      }
      if (activeDays > 0 && b?.weekly_hours != null) committedWeekly += b.weekly_hours;
      return {
        term_id: t.id,
        card_id: t.card_id,
        business_name: t.business_name,
        subscription_name: t.subscription_name,
        status: t.status,
        start_date: start ? start.slice(0, 10) : null,
        stop_date: end ? end.slice(0, 10) : null,
        assigned_date: t.assigned_date,
        unassigned_date: t.unassigned_date,
        work_start_date: t.work_start_date,
        work_end_date: t.work_end_date,
        partner_price: b?.partner_price ?? null,
        currency: b?.currency ?? null,
        missing_partner_price: b?.missing_partner_price ?? true,
        month_active_days: activeDays,
        month_payment: monthPayment,
        committed_hours: {
          daily: b?.daily_hours ?? null,
          weekly: b?.weekly_hours ?? null,
          monthly: b?.monthly_hours ?? null,
        },
      };
    });

    // Talent's self-declared available hours (graceful if SquadHire is down).
    let availableWeekly: number | null = null;
    let availableStatus: 'ok' | 'unavailable' | 'not_applicable' = 'not_applicable';
    if (recipientType === 'talent') {
      const availability = await fetchTalentAvailability([recipientId]);
      const a = availability.get(recipientId);
      if (a) {
        availableWeekly = a.weekly_hours;
        availableStatus = 'ok';
      } else {
        availableStatus = 'unavailable';
      }
    }

    res.json({
      success: true,
      data: {
        recipient_type: recipientType,
        recipient_id: recipientId,
        recipient_name: terms[0]?.recipient_name ?? null,
        month: `${year}-${String(month).padStart(2, '0')}`,
        cards,
        totals: {
          month_payments: [...paymentByCurrency.entries()].map(([currency, amount]) => ({ currency, amount })),
          committed_weekly_hours: Math.round(committedWeekly * 100) / 100,
          available_weekly_hours: availableWeekly,
          available_hours_status: availableStatus,
          utilization_pct:
            availableWeekly && availableWeekly > 0
              ? Math.round((committedWeekly / availableWeekly) * 100)
              : null,
        },
      },
    });
  } catch (err: any) {
    console.error('[subscription-assignments] user detail error', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
