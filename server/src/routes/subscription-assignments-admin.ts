import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { supabaseAdmin } from '../supabase';
import { prorateMonthly, activeDaysInMonth } from '../utils/assignmentBilling';
import { fetchTalentAvailability } from '../utils/squadhireTalent';
import { loadCardBilling, resolveTermBilling } from '../utils/cardBilling';

// Admin module: view + manage subscription assignment terms. Rows are created /
// closed automatically by the finalize-selection / unassign flow (see
// subscription-cards-admin-select.ts). Here the admin can list them and edit the
// work start / end dates (assigned / unassigned timestamps stay read-only audit).

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
    const status = (req.query.status as string) || 'all';
    const search = ((req.query.search as string) || '').trim();
    const monthRaw = req.query.month;
    const monthScoped = typeof monthRaw === 'string' && /^\d{4}-\d{2}$/.test(monthRaw);
    const { year, month } = parseMonth(monthRaw);
    const todayIso = new Date().toISOString().slice(0, 10);

    let query = supabaseAdmin
      .from('subscription_assignment_terms')
      .select('*')
      .order('assigned_date', { ascending: false });

    // When month-scoped, filter by month activity below and read status=active as
    // "status column = active" (matches the By-user view); otherwise filter here.
    if (!monthScoped && (status === 'active' || status === 'ended')) {
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
    const rows = (data || []) as AssignmentTermRow[];

    // Attach the card lifecycle so the view can badge paused / cancelled
    // engagements (billing already reflects them via the ended terms).
    const cardIds = [...new Set(rows.map((t) => t.card_id).filter(Boolean))];
    const cardById = new Map<string, { state: string; paused_at: string | null; cancelled_at: string | null }>();
    if (cardIds.length) {
      const { data: cards } = await supabaseAdmin
        .from('subscription_cards')
        .select('id, state, paused_at, cancelled_at')
        .in('id', cardIds);
      (cards || []).forEach((c: any) =>
        cardById.set(c.id, { state: c.state, paused_at: c.paused_at ?? null, cancelled_at: c.cancelled_at ?? null }),
      );
    }
    const lifecycle = (t: AssignmentTermRow) => ({
      card_state: cardById.get(t.card_id)?.state ?? null,
      card_paused_at: cardById.get(t.card_id)?.paused_at ?? null,
      card_cancelled_at: cardById.get(t.card_id)?.cancelled_at ?? null,
    });

    if (!monthScoped) {
      res.json({ success: true, data: rows.map((t) => ({ ...t, ...lifecycle(t) })) });
      return;
    }

    const billing = await loadCardBilling(cardIds);
    const enriched = rows
      .map((t) => {
        const b = resolveTermBilling(t, billing.get(t.card_id));
        const start = t.work_start_date ?? t.assigned_date;
        const end = t.work_end_date ?? t.unassigned_date ?? null;
        const activeDays = activeDaysInMonth(start, end, year, month, todayIso);
        const monthPayment = b ? prorateMonthly(b.partner_price, start, end, year, month, todayIso) : 0;
        return {
          ...t,
          ...lifecycle(t),
          start_date: start ? start.slice(0, 10) : null,
          stop_date: end ? end.slice(0, 10) : null,
          month_active_days: activeDays,
          month_payment: monthPayment,
          partner_price: b?.partner_price ?? null,
          currency: b?.currency ?? null,
          missing_partner_price: b?.missing_partner_price ?? true,
          committed_hours: {
            daily: b?.daily_hours ?? null,
            weekly: b?.weekly_hours ?? null,
            monthly: b?.monthly_hours ?? null,
          },
          plan_name: b?.plan_name ?? null,
        };
      })
      .filter((t) => t.month_active_days > 0)
      .filter((t) => (status === 'active' ? t.status === 'active' : true));

    res.json({ success: true, data: enriched, month: `${year}-${String(month).padStart(2, '0')}` });
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
    // Cards already counted toward a recipient's weekly commitment (dedupe
    // across multiple same-month terms on one card — pause/resume, plan change).
    const countedWeeklyCards = new Map<string, Set<string>>();

    for (const t of terms) {
      const start = t.work_start_date ?? t.assigned_date;
      const end = t.work_end_date ?? t.unassigned_date ?? null;
      const activeDays = activeDaysInMonth(start, end, year, month, todayIso);
      // Scope to the selected month: skip terms with no active days in it, so a
      // recipient's row reflects only the subscriptions they were serving that
      // month (a term that started or ended in another month adds nothing).
      if (activeDays <= 0) continue;

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
      // Weekly commitment counts once per CARD, not per term — a same-month
      // pause+resume (or plan change) yields multiple terms on one card and
      // would otherwise double the recipient's committed hours/utilization.
      if (b?.weekly_hours != null && !countedWeeklyCards.get(key)?.has(t.card_id)) {
        g.committed_weekly_hours += b.weekly_hours;
        if (!countedWeeklyCards.has(key)) countedWeeklyCards.set(key, new Set());
        countedWeeklyCards.get(key)!.add(t.card_id);
      }
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
    // Weekly commitment counts once per CARD (multiple same-month terms on one
    // card — pause/resume, plan change — must not double the figure).
    const weeklyCounted = new Set<string>();

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
      if (activeDays > 0 && b?.weekly_hours != null && !weeklyCounted.has(t.card_id)) {
        committedWeekly += b.weekly_hours;
        weeklyCounted.add(t.card_id);
      }
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
        plan_name: b?.plan_name ?? null,
      };
    })
      // Scope the breakdown to the selected month: drop terms with no active
      // days in it (they'd render as a "0 days / — pay" row — pure noise). The
      // totals above already exclude them, so this only trims the display list.
      .filter((c) => c.month_active_days > 0);

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
