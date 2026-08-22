import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAnyMiniAppOrAdmin } from '../middleware/miniApp';
import { supabaseAdmin } from '../supabase';
import { prorateMonthly, activeDaysInMonth } from '../utils/assignmentBilling';
import { loadCardBilling, resolveTermBilling, type CardBilling } from '../utils/cardBilling';
import { loadCardHoursCompletions } from '../utils/cardHoursCompletion';

// Partner Payments mini app. Partner-facing view of subscription assignment
// terms: assigned clients (work dates), the month's prorated payout and a
// derived monthly payouts series with commission status.
//
// Scoping: partner callers always see only their own rows
// (recipient_type='partner' AND recipient_id = req.userId — terms are keyed by
// the partner's user id, same key subscription-cards-partner.ts uses).
// Internal admins pass the mini-app gate automatically and may preview any
// partner via ?recipient_id=; without it /me returns the full partner list so
// the UI can offer a picker.

const router = Router();
router.use(requireAuth);
router.use(requireAnyMiniAppOrAdmin(['partner-payments']));

type TermRow = {
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
  plan_snapshot: any | null;
  partner_price: number | null;
  subscription_price: number | null;
  currency: string | null;
};

async function isInternalAdmin(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('users').select('is_admin').eq('id', userId).single();
  return !!data?.is_admin;
}

function parseMonth(raw: unknown): { year: number; month: number; key: string } {
  const s = typeof raw === 'string' && /^\d{4}-\d{2}$/.test(raw) ? raw : null;
  const now = new Date();
  const year = s ? Number(s.slice(0, 4)) : now.getUTCFullYear();
  const month = s ? Number(s.slice(5, 7)) : now.getUTCMonth() + 1;
  return { year, month, key: `${year}-${String(month).padStart(2, '0')}` };
}

function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
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

async function fetchTerms(recipientId: string): Promise<TermRow[]> {
  const { data, error } = await supabaseAdmin
    .from('subscription_assignment_terms')
    .select('*')
    .eq('recipient_type', 'partner')
    .eq('recipient_id', recipientId)
    .order('assigned_date', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as TermRow[];
}

function lifecycle(t: TermRow, cardById: Map<string, any>) {
  const c = cardById.get(t.card_id);
  return {
    card_state: c?.state ?? null,
    card_paused_at: c?.paused_at ?? null,
    card_cancelled_at: c?.cancelled_at ?? null,
  };
}

async function cardLookup(cardIds: string[]) {
  const map = new Map<string, any>();
  if (!cardIds.length) return map;
  const { data } = await supabaseAdmin
    .from('subscription_cards')
    .select('id, state, paused_at, cancelled_at')
    .in('id', cardIds);
  (data || []).forEach((c: any) => map.set(c.id, c));
  return map;
}

// GET /partner-payments/me
// Caller context for the UI: partners get their own identity; internal admins
// get every partner that has ever held a term so they can preview each one.
router.get('/me', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const admin = await isInternalAdmin(userId);
    if (admin) {
      const { data, error } = await supabaseAdmin
        .from('subscription_assignment_terms')
        .select('recipient_id, recipient_name')
        .eq('recipient_type', 'partner');
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
// One month's detail for one partner: per-client cards (dates, plan, prorated
// pay incl. additional hours) + totals. Mirrors the admin module's math via
// the same shared utils.
router.get('/month', async (req: Request, res: Response) => {
  try {
    const scope = await resolveScope(req);
    if (scope.err) { res.status(403).json({ success: false, error: scope.err }); return; }
    const recipientId = scope.targetId;
    if (!recipientId) { res.status(400).json({ success: false, error: 'recipient_id is required' }); return; }

    const { year, month, key } = parseMonth(req.query.month);
    const todayIso = new Date().toISOString().slice(0, 10);

    const terms = await fetchTerms(recipientId);
    const cardIds = [...new Set(terms.map((t) => t.card_id))];
    const [billing, cards] = await Promise.all([
      loadCardBilling(cardIds),
      cardLookup(cardIds),
    ]);
    const completions = await loadCardHoursCompletions(
      cardIds
        .map((id) => ({ cardId: id, linkedFolderId: null, billing: billing.get(id) }))
        .filter((c): c is { cardId: string; linkedFolderId: null; billing: CardBilling } => !!c.billing),
      year,
      month,
    );

    const paymentByCurrency = new Map<string, number>();
    let committedWeekly = 0;
    let additionalHoursTotal = 0;
    const weeklyCounted = new Set<string>();
    const additionalCounted = new Set<string>();

    const clients = terms
      .map((t) => {
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
        const comp = completions.get(t.card_id);
        if (activeDays > 0 && comp && !additionalCounted.has(t.card_id)) {
          additionalCounted.add(t.card_id);
          additionalHoursTotal += comp.additional_hours;
          if (comp.additional_partner_payment !== 0) {
            const cur = b?.currency || 'UNKNOWN';
            paymentByCurrency.set(cur, (paymentByCurrency.get(cur) || 0) + comp.additional_partner_payment);
          }
        }
        return {
          term_id: t.id,
          business_name: t.business_name,
          subscription_name: t.subscription_name,
          status: t.status,
          ...lifecycle(t, cards),
          start_date: start ? start.slice(0, 10) : null,
          end_date: end ? end.slice(0, 10) : null,
          plan_label: b?.plan_snapshot?.plan?.plan ?? null,
          plan_tier: b?.plan_snapshot?.plan?.tier ?? null,
          currency: b?.currency ?? null,
          month_active_days: activeDays,
          month_payment: monthPayment,
          committed_weekly_hours: b?.weekly_hours ?? null,
          additional_hours: comp?.additional_hours ?? 0,
          additional_payment: comp?.additional_partner_payment ?? 0,
        };
      })
      .filter((c) => c.month_active_days > 0);

    res.json({
      success: true,
      data: {
        month: key,
        clients,
        totals: {
          month_payments: [...paymentByCurrency.entries()].map(([currency, amount]) => ({ currency, amount })),
          committed_weekly_hours: Math.round(committedWeekly * 100) / 100,
          additional_hours: Math.round(additionalHoursTotal * 100) / 100,
        },
      },
    });
  } catch (err: any) {
    console.error('[partner-payments] month error', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

// GET /partner-payments/history?months=12&recipient_id=
// Monthly payout series for the last N months (default 12). Commission status
// is DERIVED here, not stored upstream: a month counts as paid once it has
// passed, posted on the 1st of the following month; the running month stays
// pending until it closes.
router.get('/history', async (req: Request, res: Response) => {
  try {
    const scope = await resolveScope(req);
    if (scope.err) { res.status(403).json({ success: false, error: scope.err }); return; }
    const recipientId = scope.targetId;
    if (!recipientId) { res.status(400).json({ success: false, error: 'recipient_id is required' }); return; }

    const countRaw = Number(req.query.months);
    const count = Number.isFinite(countRaw) ? Math.min(Math.max(Math.trunc(countRaw), 1), 24) : 12;
    const currentKey = parseMonth(null).key;

    const terms = await fetchTerms(recipientId);
    const cardIds = [...new Set(terms.map((t) => t.card_id))];
    const billing = await loadCardBilling(cardIds);

    const months: { year: number; month: number; key: string }[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const k = shiftMonthKey(currentKey, -i);
      months.push({ year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)), key: k });
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const completionSets = await Promise.all(
      months.map(({ year, month }) =>
        loadCardHoursCompletions(
          cardIds
            .map((id) => ({ cardId: id, linkedFolderId: null, billing: billing.get(id) }))
            .filter((c): c is { cardId: string; linkedFolderId: null; billing: CardBilling } => !!c.billing),
          year,
          month,
        ),
      ),
    );

    const rows = months.map(({ year, month, key }, idx) => {
      const completions = completionSets[idx];
      const lines: { client: string | null; currency: string; amount: number; note?: string }[] = [];
      const totals = new Map<string, number>();
      const weeklyCounted = new Set<string>();
      const additionalCounted = new Set<string>();
      let committedWeekly = 0;

      for (const t of terms) {
        const b = resolveTermBilling(t, billing.get(t.card_id));
        const start = t.work_start_date ?? t.assigned_date;
        const end = t.work_end_date ?? t.unassigned_date ?? null;
        const activeDays = activeDaysInMonth(start, end, year, month, todayIso);
        if (activeDays <= 0) continue;
        if (b?.weekly_hours != null && !weeklyCounted.has(t.card_id)) {
          committedWeekly += b.weekly_hours;
          weeklyCounted.add(t.card_id);
        }
        const cur = b?.currency || 'UNKNOWN';
        const base = b ? prorateMonthly(b.partner_price, start, end, year, month, todayIso) : 0;
        let amount = base;
        const notes: string[] = [];
        if (base > 0 && activeDays < new Date(Date.UTC(year, month, 0)).getUTCDate()) {
          notes.push(`prorated · ${activeDays} active days`);
        }
        const comp = completions.get(t.card_id);
        if (comp && !additionalCounted.has(t.card_id)) {
          additionalCounted.add(t.card_id);
          if (comp.additional_partner_payment !== 0) {
            amount += comp.additional_partner_payment;
            notes.push(`${comp.additional_hours > 0 ? '+' : ''}${comp.additional_hours} add’l hrs`);
          }
        }
        if (amount !== 0) {
          totals.set(cur, (totals.get(cur) || 0) + amount);
          lines.push({ client: t.business_name, currency: cur, amount: Math.round(amount * 100) / 100, note: notes.join(' · ') || undefined });
        }
      }

      const isCurrent = key === currentKey;
      const nextMonth = shiftMonthKey(key, 1);
      return {
        month: key,
        payments: [...totals.entries()].map(([currency, amount]) => ({ currency, amount })),
        commission_status: isCurrent ? ('pending' as const) : ('paid' as const),
        post_date: isCurrent ? null : `${nextMonth}-01`,
        expected_post_date: `${nextMonth}-01`,
        committed_weekly_hours: Math.round(committedWeekly * 100) / 100,
        lines,
      };
    });

    res.json({ success: true, data: { current_month: currentKey, payouts: rows } });
  } catch (err: any) {
    console.error('[partner-payments] history error', err);
    res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
});

export default router;
