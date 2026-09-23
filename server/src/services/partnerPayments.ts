// ============================================================
// partnerPayments (service)
//
// THE Partner Payments calculator. Every surface that shows a partner payout
// figure goes through here:
//   - admin module            routes/subscription-assignments-admin.ts
//   - partner mini app        routes/partner-payments-miniapp.ts
//   - SquadBooks (books.*)    routes/squadbooks-integration.ts
//
// SquadBooks used to carry a hand-ported COPY of this math in its own repo,
// which silently drifted from here between syncs. It now calls the integration
// endpoints instead, so there is exactly one implementation of the numbers.
// If you change the math, every surface changes with it — that is the point.
//
// Everything is computed live from `subscription_assignment_terms` +
// `subscription_cards`. Nothing here is stored or cached; payout figures are
// never persisted.
// ============================================================
import { supabaseAdmin } from '../supabase';
import { prorateMonthly, activeDaysInMonth } from '../utils/assignmentBilling';
import { fetchTalentAvailability } from '../utils/squadhireTalent';
import { loadCardBilling, resolveTermBilling, type CardBilling } from '../utils/cardBilling';
import { loadCardHoursCompletions } from '../utils/cardHoursCompletion';

export type AssignmentTermRow = {
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

export function parseMonth(raw: unknown): { year: number; month: number; key: string } {
  const s = typeof raw === 'string' && /^\d{4}-\d{2}$/.test(raw) ? raw : null;
  const now = new Date();
  const year = s ? Number(s.slice(0, 4)) : now.getUTCFullYear();
  const month = s ? Number(s.slice(5, 7)) : now.getUTCMonth() + 1;
  return { year, month, key: `${year}-${String(month).padStart(2, '0')}` };
}

function recipientKey(t: { recipient_type: string; recipient_id: string }) {
  return `${t.recipient_type}:${t.recipient_id}`;
}

/** Map card_id -> linked_folder_id (the linked space) for hours-completion. */
async function fetchLinkedFolders(cardIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!cardIds.length) return out;
  const { data } = await supabaseAdmin
    .from('subscription_cards')
    .select('id, linked_folder_id')
    .in('id', cardIds);
  (data || []).forEach((c: any) => out.set(c.id, c.linked_folder_id ?? null));
  return out;
}

/** Build the loadCardHoursCompletions input, dropping cards with no resolved billing. */
function completionInput(
  cardIds: string[],
  folderByCard: Map<string, string | null>,
  billing: Map<string, CardBilling>,
): { cardId: string; linkedFolderId: string | null; billing: CardBilling }[] {
  return cardIds
    .map((id) => ({ cardId: id, linkedFolderId: folderByCard.get(id) ?? null, billing: billing.get(id) }))
    .filter((c): c is { cardId: string; linkedFolderId: string | null; billing: CardBilling } => !!c.billing);
}

/** Apply the shared recipient/client/subscription name search to a terms query. */
function applySearch<T>(query: T, search: string): T {
  if (!search) return query;
  const safe = search.replace(/[%,]/g, ' ');
  return (query as any).or(
    `recipient_name.ilike.%${safe}%,business_name.ilike.%${safe}%,subscription_name.ilike.%${safe}%`,
  );
}

// ------------------------------------------------------------
// Terms list
// ------------------------------------------------------------

export interface ListTermsInput {
  status?: string;
  search?: string;
  month?: unknown;
}

/**
 * Assignment terms, optionally scoped to a month.
 *
 * Without a valid `month`: raw terms + card lifecycle (legacy shape), and
 * `status` filters the term's own status column.
 * With `month`: each term is enriched with that month's active-days, prorated
 * pay and frozen billing, and filtered to terms active in the month. The client
 * folds multiple periods on one card·talent (pause/resume, plan change) into a
 * single row.
 */
export async function listAssignmentTerms(
  input: ListTermsInput,
): Promise<{ data: any[]; month?: string }> {
  const status = input.status || 'all';
  const search = (input.search || '').trim();
  const monthRaw = input.month;
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
  query = applySearch(query, search);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data || []) as AssignmentTermRow[];

  // Attach the card lifecycle so the view can badge paused / cancelled
  // engagements (billing already reflects them via the ended terms).
  const cardIds = [...new Set(rows.map((t) => t.card_id).filter(Boolean))];
  const cardById = new Map<
    string,
    { state: string; paused_at: string | null; cancelled_at: string | null; linked_folder_id: string | null }
  >();
  if (cardIds.length) {
    const { data: cards } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, paused_at, cancelled_at, linked_folder_id')
      .in('id', cardIds);
    (cards || []).forEach((c: any) =>
      cardById.set(c.id, {
        state: c.state,
        paused_at: c.paused_at ?? null,
        cancelled_at: c.cancelled_at ?? null,
        linked_folder_id: c.linked_folder_id ?? null,
      }),
    );
  }
  const lifecycle = (t: AssignmentTermRow) => ({
    card_state: cardById.get(t.card_id)?.state ?? null,
    card_paused_at: cardById.get(t.card_id)?.paused_at ?? null,
    card_cancelled_at: cardById.get(t.card_id)?.cancelled_at ?? null,
  });

  if (!monthScoped) {
    return { data: rows.map((t) => ({ ...t, ...lifecycle(t) })) };
  }

  const billing = await loadCardBilling(cardIds);
  // Per-card hours completion (plan target vs. tracked+elapsed actual → signed
  // additional hours + payment) for the scoped month. Attached identically to
  // every term of a card; the client folds it once per card row.
  const folderByCard = new Map<string, string | null>(
    cardIds.map((id) => [id, cardById.get(id)?.linked_folder_id ?? null]),
  );
  const completions = await loadCardHoursCompletions(
    completionInput(cardIds, folderByCard, billing),
    year,
    month,
  );

  const enriched = rows
    .map((t) => {
      const b = resolveTermBilling(t, billing.get(t.card_id));
      const comp = completions.get(t.card_id);
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
        currency: b?.currency ?? 'INR',
        missing_partner_price: b?.missing_partner_price ?? true,
        committed_hours: {
          daily: b?.daily_hours ?? null,
          weekly: b?.weekly_hours ?? null,
          monthly: b?.monthly_hours ?? null,
        },
        // Monthly hours completion (per card; identical on every term of the
        // card, so the client adds it once per folded row). month_payment above
        // stays the prorated base — additional_payment is added on top.
        additional_hours: comp?.additional_hours ?? 0,
        additional_payment: comp?.additional_partner_payment ?? 0,
        actual_hours: comp?.actual_hours ?? 0,
        target_hours_this_month: comp?.target_monthly_hours ?? 0,
        plan_name: b?.plan_name ?? null,
        // Plan band + tier frozen on the term, so a multi-period breakdown can
        // name what each slice was on (e.g. "Basic" then "Plus" after a change).
        plan_label: b?.plan_snapshot?.plan?.plan ?? null,
        plan_tier: b?.plan_snapshot?.plan?.tier ?? null,
      };
    })
    .filter((t) => t.month_active_days > 0)
    .filter((t) => (status === 'active' ? t.status === 'active' : true));

  return { data: enriched, month: `${year}-${String(month).padStart(2, '0')}` };
}

// ------------------------------------------------------------
// Per-user rollup
// ------------------------------------------------------------

export interface ListUserPaymentsInput {
  status?: string;
  search?: string;
  month?: unknown;
}

/**
 * One row per recipient with the selected month's payment (per currency),
 * committed weekly hours, and (talent) self-declared available hours.
 */
export async function listUserPayments(
  input: ListUserPaymentsInput,
): Promise<{ month: string; users: any[] }> {
  const status = input.status || 'active';
  const search = (input.search || '').trim();
  const { year, month } = parseMonth(input.month);
  const todayIso = new Date().toISOString().slice(0, 10);

  let query = supabaseAdmin.from('subscription_assignment_terms').select('*');
  query = applySearch(query, search);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const terms = (data || []) as AssignmentTermRow[];

  const cardIds = [...new Set(terms.map((t) => t.card_id))];
  const billing = await loadCardBilling(cardIds);
  const folderByCard = await fetchLinkedFolders(cardIds);
  const completions = await loadCardHoursCompletions(
    completionInput(cardIds, folderByCard, billing),
    year,
    month,
  );

  type Group = {
    recipient_type: 'talent' | 'partner';
    recipient_id: string;
    recipient_name: string | null;
    card_count: number;
    active_card_count: number;
    committed_weekly_hours: number;
    payments: Map<string, number>; // currency -> prorated base + additional
    base_payments: Map<string, number>; // currency -> prorated base only
    additional_payment: number; // signed total of shortfall deductions (one-sided)
    missing_pricing: boolean;
    additional_hours: number; // net signed hours delta (once per card)
  };
  const groups = new Map<string, Group>();
  // Cards already counted toward a recipient's weekly commitment (dedupe
  // across multiple same-month terms on one card — pause/resume, plan change).
  const countedWeeklyCards = new Map<string, Set<string>>();
  // Additional hours + payment count once per CARD (folder-level completion),
  // not per term — a same-month pause/resume must not double the delta.
  const countedAdditionalCards = new Map<string, Set<string>>();

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
        base_payments: new Map(),
        additional_payment: 0,
        missing_pricing: false,
        additional_hours: 0,
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
        const cur = b.currency || 'INR';
        g.payments.set(cur, (g.payments.get(cur) || 0) + pay);
        g.base_payments.set(cur, (g.base_payments.get(cur) || 0) + pay);
      }
    }
    // Additional hours + payment: once per card, folded into the card's own
    // currency bucket so the recipient's total reflects base + overage/shortfall.
    const comp = completions.get(t.card_id);
    if (comp && !countedAdditionalCards.get(key)?.has(t.card_id)) {
      if (!countedAdditionalCards.has(key)) countedAdditionalCards.set(key, new Set());
      countedAdditionalCards.get(key)!.add(t.card_id);
      g.additional_hours += comp.additional_hours;
      if (comp.additional_partner_payment !== 0) {
        const cur = b?.currency || 'INR';
        g.payments.set(cur, (g.payments.get(cur) || 0) + comp.additional_partner_payment);
        g.additional_payment += comp.additional_partner_payment;
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
        base_payments: [...g.base_payments.entries()].map(([currency, amount]) => ({ currency, amount })),
        additional_payment: g.additional_payment,
        missing_pricing: g.missing_pricing,
        additional_hours: Math.round(g.additional_hours * 100) / 100,
      };
    })
    .sort((a, b) => {
      const ap = a.payments.reduce((s, p) => s + p.amount, 0);
      const bp = b.payments.reduce((s, p) => s + p.amount, 0);
      return bp - ap;
    });

  return { month: `${year}-${String(month).padStart(2, '0')}`, users: rows };
}

// ------------------------------------------------------------
// Per-user detail
// ------------------------------------------------------------

export interface UserDetailInput {
  recipientType: 'talent' | 'partner';
  recipientId: string;
  month?: unknown;
}

/**
 * Per-card breakdown for one recipient: start/stop, partner price, prorated
 * month payment, committed hours, plus the talent's available-hours summary.
 */
export async function getUserPaymentDetail(input: UserDetailInput): Promise<any> {
  const { recipientType, recipientId } = input;
  const { year, month } = parseMonth(input.month);
  const todayIso = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from('subscription_assignment_terms')
    .select('*')
    .eq('recipient_type', recipientType)
    .eq('recipient_id', recipientId)
    .order('assigned_date', { ascending: false });
  if (error) throw new Error(error.message);
  const terms = (data || []) as AssignmentTermRow[];

  const cardIds = [...new Set(terms.map((t) => t.card_id))];
  const billing = await loadCardBilling(cardIds);
  const folderByCard = await fetchLinkedFolders(cardIds);
  const completions = await loadCardHoursCompletions(
    completionInput(cardIds, folderByCard, billing),
    year,
    month,
  );

  const paymentByCurrency = new Map<string, number>();
  let committedWeekly = 0;
  let totalAdditionalHours = 0;
  // Weekly commitment counts once per CARD (multiple same-month terms on one
  // card — pause/resume, plan change — must not double the figure).
  const weeklyCounted = new Set<string>();
  // Additional hours + payment likewise count once per card.
  const additionalCounted = new Set<string>();

  const cards = terms
    .map((t) => {
      const b = resolveTermBilling(t, billing.get(t.card_id));
      const start = t.work_start_date ?? t.assigned_date;
      const end = t.work_end_date ?? t.unassigned_date ?? null;
      const activeDays = activeDaysInMonth(start, end, year, month, todayIso);
      const monthPayment = b ? prorateMonthly(b.partner_price, start, end, year, month, todayIso) : 0;
      if (monthPayment > 0) {
        const cur = b?.currency || 'INR';
        paymentByCurrency.set(cur, (paymentByCurrency.get(cur) || 0) + monthPayment);
      }
      if (activeDays > 0 && b?.weekly_hours != null && !weeklyCounted.has(t.card_id)) {
        committedWeekly += b.weekly_hours;
        weeklyCounted.add(t.card_id);
      }
      const comp = completions.get(t.card_id);
      if (activeDays > 0 && comp && !additionalCounted.has(t.card_id)) {
        additionalCounted.add(t.card_id);
        totalAdditionalHours += comp.additional_hours;
        if (comp.additional_partner_payment !== 0) {
          const cur = b?.currency || 'INR';
          paymentByCurrency.set(cur, (paymentByCurrency.get(cur) || 0) + comp.additional_partner_payment);
        }
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
        currency: b?.currency ?? 'INR',
        missing_partner_price: b?.missing_partner_price ?? true,
        month_active_days: activeDays,
        month_payment: monthPayment,
        committed_hours: {
          daily: b?.daily_hours ?? null,
          weekly: b?.weekly_hours ?? null,
          monthly: b?.monthly_hours ?? null,
        },
        // Monthly hours completion for this card (month_payment stays the base;
        // additional_payment is the signed overage/shortfall added on top).
        additional_hours: comp?.additional_hours ?? 0,
        additional_payment: comp?.additional_partner_payment ?? 0,
        actual_hours: comp?.actual_hours ?? 0,
        target_hours_this_month: comp?.target_monthly_hours ?? 0,
        plan_name: b?.plan_name ?? null,
        // Plan band + tier frozen on the term, so a multi-period breakdown can
        // name what each slice was on (e.g. "Basic" then "Plus" after a change).
        plan_label: b?.plan_snapshot?.plan?.plan ?? null,
        plan_tier: b?.plan_snapshot?.plan?.tier ?? null,
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

  return {
    recipient_type: recipientType,
    recipient_id: recipientId,
    recipient_name: terms[0]?.recipient_name ?? null,
    month: `${year}-${String(month).padStart(2, '0')}`,
    cards,
    totals: {
      month_payments: [...paymentByCurrency.entries()].map(([currency, amount]) => ({ currency, amount })),
      additional_hours: Math.round(totalAdditionalHours * 100) / 100,
      committed_weekly_hours: Math.round(committedWeekly * 100) / 100,
      available_weekly_hours: availableWeekly,
      available_hours_status: availableStatus,
      utilization_pct:
        availableWeekly && availableWeekly > 0
          ? Math.round((committedWeekly / availableWeekly) * 100)
          : null,
    },
  };
}
