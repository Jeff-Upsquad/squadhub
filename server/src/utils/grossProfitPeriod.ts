// ============================================================
// grossProfitPeriod
//
// Period-scoped gross-profit aggregation for the admin Gross Profit report.
//
// The billing ledger is `subscription_assignment_terms` (one row per talent
// engaged for one business over a date window, carrying the finalized
// subscription_price / partner_price / currency frozen at term open — migration
// 152). We resolve each term's effective billing with the SAME helpers the
// Active Subscriptions view uses (loadCardBilling + resolveTermBilling), then
// prorate revenue and partner cost by the days each term was active in every
// calendar month of the selected period and aggregate per business (client) and
// currency.
//
// "Actuals per period": a term contributes only for the months it was live, so
// a quarter is the sum of its three months and a partial month is day-prorated.
// Per-term day-proration also means a mid-month talent swap on one card (two
// sequential terms) sums to ~one month of revenue — no dedup needed.
// ============================================================
import {
  activeDaysInMonth,
  prorateMonthly,
  daysInMonth,
} from './assignmentBilling';
import { loadCardBilling, resolveTermBilling } from './cardBilling';
import { supabaseAdmin } from '../supabase';

export type Granularity = 'month' | 'quarter' | 'year';

export interface GrossProfitParams {
  granularity: Granularity;
  /** 'YYYY-MM' | 'YYYY-Q{1..4}' | 'YYYY'. Defaults to the current period. */
  anchor?: string;
  /** Filter to a single currency (e.g. 'INR'). */
  currency?: string | null;
  /** Filter to a subscription role slug (e.g. 'designer', 'video_editor'). */
  subscription?: string | null;
}

export interface PeriodSpec {
  granularity: Granularity;
  anchor: string;
  label: string;
  start: string; // YYYY-MM-DD (inclusive)
  end: string; // YYYY-MM-DD (inclusive)
  months: { year: number; month: number }[];
}

export interface GrossProfitLine {
  term_id: string;
  card_id: string | null;
  role: string | null;
  subscription_name: string | null;
  plan: string | null;
  tier: string | null;
  talent: string | null;
  work_start: string | null;
  work_end: string | null;
  active_days: number;
  status: 'active' | 'paused' | 'cancelled' | 'ended';
  revenue: number;
  partner_cost: number;
  gross_profit: number;
  missing_revenue: boolean;
  missing_partner_price: boolean;
  /** True only when the term itself carries a finalized price + partner + currency
   *  (migration 152). False => the figures are an estimate from card/catalog fallback. */
  finalized: boolean;
}

export interface GrossProfitClient {
  id: string;
  business_name: string;
  currency: string;
  active_subscription_count: number;
  revenue: number;
  partner_cost: number;
  gross_profit: number;
  margin_pct: number;
  has_missing_pricing: boolean;
  lines: GrossProfitLine[];
}

export interface CurrencySummary {
  currency: string;
  revenue: number;
  partner_cost: number;
  gross_profit: number;
  margin_pct: number;
  client_count: number;
}

export interface GrossProfitResult {
  period: Omit<PeriodSpec, 'months'>;
  summary_by_currency: CurrencySummary[];
  clients: GrossProfitClient[];
}

type TermRow = {
  id: string;
  card_id: string;
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

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Lowercase slug for loose role matching: "Video Editor" -> "video_editor". */
function slugifyRole(v: string | null | undefined): string {
  return (v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Expand a granularity + anchor into its concrete month list and bounds. */
export function resolvePeriod(
  granularity: Granularity,
  anchorRaw: string | undefined,
  now: Date,
): PeriodSpec {
  const nowYear = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;

  if (granularity === 'year') {
    const m = /^(\d{4})$/.exec(anchorRaw || '');
    const year = m ? Number(m[1]) : nowYear;
    const months = Array.from({ length: 12 }, (_, i) => ({ year, month: i + 1 }));
    return {
      granularity,
      anchor: String(year),
      label: String(year),
      start: `${year}-01-01`,
      end: `${year}-12-31`,
      months,
    };
  }

  if (granularity === 'quarter') {
    const m = /^(\d{4})-Q([1-4])$/.exec(anchorRaw || '');
    const year = m ? Number(m[1]) : nowYear;
    const quarter = m ? Number(m[2]) : Math.floor((nowMonth - 1) / 3) + 1;
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const months = [0, 1, 2].map((i) => ({ year, month: startMonth + i }));
    return {
      granularity,
      anchor: `${year}-Q${quarter}`,
      label: `Q${quarter} ${year}`,
      start: `${year}-${pad(startMonth)}-01`,
      end: `${year}-${pad(endMonth)}-${pad(daysInMonth(year, endMonth))}`,
      months,
    };
  }

  // month
  const m = /^(\d{4})-(\d{2})$/.exec(anchorRaw || '');
  const year = m ? Number(m[1]) : nowYear;
  const month = m ? Number(m[2]) : nowMonth;
  return {
    granularity,
    anchor: `${year}-${pad(month)}`,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`,
    months: [{ year, month }],
  };
}

export async function computeGrossProfit(
  params: GrossProfitParams,
): Promise<GrossProfitResult> {
  const now = new Date();
  // Bill the full CURRENT running month for still-active engagements (not just
  // days-so-far), but never project beyond it — so open-ended terms are capped
  // at the end of the current month. Ended/paused/cancelled terms use their real
  // end date instead, so they bill only the days they were actually active.
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth() + 1;
  const currentMonthEndIso = `${curY}-${pad(curM)}-${pad(daysInMonth(curY, curM))}`;
  const period = resolvePeriod(params.granularity, params.anchor, now);
  const currencyFilter = params.currency || null;
  const roleFilter = params.subscription ? slugifyRole(params.subscription) : null;

  // Ledger of engagements. Scale is small; fetch all and let activeDaysInMonth
  // decide membership (it correctly handles null work dates via the fallbacks).
  const { data, error } = await supabaseAdmin
    .from('subscription_assignment_terms')
    .select(
      'id, card_id, recipient_name, business_name, subscription_name, assigned_date, unassigned_date, work_start_date, work_end_date, status, plan_snapshot, partner_price, subscription_price, currency',
    );
  if (error) throw new Error(error.message);
  const terms = (data || []) as TermRow[];

  const cardIds = [...new Set(terms.map((t) => t.card_id).filter(Boolean))];

  // Card lifecycle drives per-engagement status + the effective billing end
  // (a paused/cancelled card stops billing). Soft-deleted cards (migration 155)
  // are dropped entirely — an admin removed them from the book.
  type CardLife = {
    paused_at: string | null;
    cancelled_at: string | null;
    closed_at: string | null;
    state: string | null;
  };
  const cardLife = new Map<string, CardLife>();
  const deleted = new Set<string>();
  if (cardIds.length) {
    const { data: cardMeta } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, deleted_at, paused_at, cancelled_at, closed_at, state')
      .in('id', cardIds);
    (cardMeta || []).forEach((c: any) => {
      cardLife.set(c.id, {
        paused_at: c.paused_at ?? null,
        cancelled_at: c.cancelled_at ?? null,
        closed_at: c.closed_at ?? null,
        state: c.state ?? null,
      });
      if (c.deleted_at) deleted.add(c.id);
    });
  }

  const billing = await loadCardBilling(cardIds);

  type ClientAgg = {
    id: string;
    business_name: string;
    currency: string;
    cardIds: Set<string>;
    revenue: number;
    partner_cost: number;
    gross_profit: number;
    has_missing_pricing: boolean;
    lines: GrossProfitLine[];
  };
  const clients = new Map<string, ClientAgg>();

  // Group terms by card — one card is one subscription the client pays for.
  // Client REVENUE is billed once per card (over the card's active window);
  // partner COST is summed per talent term (each talent is paid for their days).
  // This avoids double-counting revenue when a card swaps talent mid-period.
  const termsByCard = new Map<string, TermRow[]>();
  for (const t of terms) {
    if (!t.card_id || deleted.has(t.card_id)) continue;
    const arr = termsByCard.get(t.card_id);
    if (arr) arr.push(t);
    else termsByCard.set(t.card_id, [t]);
  }

  const startOf = (t: TermRow) => t.work_start_date ?? t.assigned_date ?? null;
  const endOf = (t: TermRow) => t.work_end_date ?? t.unassigned_date ?? null;

  for (const [cardId, cardTerms] of termsByCard) {
    const cb = billing.get(cardId);
    const life = cardLife.get(cardId);

    // Representative = the most recently started term: its talent is the current
    // one and its billing/role/currency represent the subscription now.
    const ordered = [...cardTerms].sort((a, b) =>
      String(startOf(a) ?? '').localeCompare(String(startOf(b) ?? '')),
    );
    const latest = ordered[ordered.length - 1];
    const repBilling = resolveTermBilling(latest, cb);

    const currency = repBilling.currency || 'UNKNOWN';
    if (currencyFilter && currency !== currencyFilter) continue;

    const role = repBilling.plan_name || latest.subscription_name || null;
    if (
      roleFilter &&
      slugifyRole(role) !== roleFilter &&
      slugifyRole(latest.subscription_name) !== roleFilter
    ) {
      continue;
    }

    // Card lifecycle → status + the date the whole subscription stopped billing.
    const cardStopped = life?.cancelled_at || life?.closed_at || life?.paused_at || null;
    const cardStoppedDate = cardStopped ? String(cardStopped).slice(0, 10) : null;

    let status: 'active' | 'paused' | 'cancelled' | 'ended';
    if (life?.cancelled_at) status = 'cancelled';
    else if (life?.closed_at) status = 'ended';
    else if (life?.paused_at) status = 'paused';
    else if (cardTerms.every((t) => endOf(t) != null || t.status === 'ended')) status = 'ended';
    else status = 'active';

    // Card active window = union of its terms. Start = earliest term start.
    // End: an ended/paused/cancelled card stops at its terms' latest real end; a
    // still-running card is open (null) → bills the full current month.
    const starts = cardTerms
      .map(startOf)
      .filter((v): v is string => !!v)
      .map((s) => s.slice(0, 10))
      .sort();
    const cardStart = starts[0] ?? null;
    const ends = cardTerms
      .map(endOf)
      .filter((v): v is string => !!v)
      .map((s) => s.slice(0, 10))
      .sort();
    const maxTermEnd = ends.length ? ends[ends.length - 1] : null;
    const anyOpen = cardTerms.some((t) => endOf(t) == null);
    let cardEnd: string | null;
    if (cardStoppedDate) cardEnd = maxTermEnd ?? cardStoppedDate;
    else if (!anyOpen) cardEnd = maxTermEnd;
    else cardEnd = null;

    // Revenue: the client price, prorated ONCE over the card's active window.
    let cardRevenue = 0;
    let cardDays = 0;
    for (const { year, month } of period.months) {
      const days = activeDaysInMonth(cardStart, cardEnd, year, month, currentMonthEndIso);
      if (days <= 0) continue;
      cardDays += days;
      cardRevenue += prorateMonthly(
        repBilling.subscription_price,
        cardStart,
        cardEnd,
        year,
        month,
        currentMonthEndIso,
      );
    }
    if (cardDays <= 0) continue; // subscription wasn't active in the period

    // Partner cost: summed per talent term over each term's own window.
    let cardCost = 0;
    let anyPartnerMissing = false;
    for (const t of cardTerms) {
      const tb = resolveTermBilling(t, cb);
      if (tb.missing_partner_price) anyPartnerMissing = true;
      const tStart = startOf(t);
      const tEnd = endOf(t) ?? cardStoppedDate ?? null;
      for (const { year, month } of period.months) {
        cardCost += prorateMonthly(tb.partner_price, tStart, tEnd, year, month, currentMonthEndIso);
      }
    }

    // Finalized when the current term froze its own price + partner + currency.
    const finalized =
      latest.subscription_price != null &&
      latest.partner_price != null &&
      latest.currency != null;
    const missingRevenue = repBilling.subscription_price == null;

    const business = latest.business_name || '(Unknown business)';
    const key = `${business}||${currency}`;
    let c = clients.get(key);
    if (!c) {
      c = {
        id: key,
        business_name: business,
        currency,
        cardIds: new Set(),
        revenue: 0,
        partner_cost: 0,
        gross_profit: 0,
        has_missing_pricing: false,
        lines: [],
      };
      clients.set(key, c);
    }

    c.revenue += cardRevenue;
    c.partner_cost += cardCost;
    c.gross_profit += cardRevenue - cardCost;
    c.cardIds.add(cardId);
    if (!finalized) c.has_missing_pricing = true;
    c.lines.push({
      term_id: cardId,
      card_id: cardId,
      role,
      subscription_name: latest.subscription_name,
      plan: repBilling.plan_snapshot?.plan?.plan ?? null,
      tier: repBilling.plan_snapshot?.plan?.tier ?? null,
      talent: latest.recipient_name,
      work_start: cardStart,
      work_end: cardEnd,
      active_days: cardDays,
      status,
      revenue: cardRevenue,
      partner_cost: cardCost,
      gross_profit: cardRevenue - cardCost,
      missing_revenue: missingRevenue,
      missing_partner_price: anyPartnerMissing,
      finalized,
    });
  }

  const clientsList: GrossProfitClient[] = [...clients.values()]
    .map((c) => ({
      id: c.id,
      business_name: c.business_name,
      currency: c.currency,
      active_subscription_count: c.cardIds.size,
      revenue: c.revenue,
      partner_cost: c.partner_cost,
      gross_profit: c.gross_profit,
      margin_pct: c.revenue > 0 ? (c.gross_profit / c.revenue) * 100 : 0,
      has_missing_pricing: c.has_missing_pricing,
      lines: c.lines.sort((a, b) => b.revenue - a.revenue),
    }))
    .sort((a, b) => b.gross_profit - a.gross_profit);

  const summaryByCurrency = new Map<string, CurrencySummary>();
  for (const c of clientsList) {
    let s = summaryByCurrency.get(c.currency);
    if (!s) {
      s = { currency: c.currency, revenue: 0, partner_cost: 0, gross_profit: 0, margin_pct: 0, client_count: 0 };
      summaryByCurrency.set(c.currency, s);
    }
    s.revenue += c.revenue;
    s.partner_cost += c.partner_cost;
    s.gross_profit += c.gross_profit;
    s.client_count += 1;
  }
  const summary = [...summaryByCurrency.values()]
    .map((s) => ({ ...s, margin_pct: s.revenue > 0 ? (s.gross_profit / s.revenue) * 100 : 0 }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    period: {
      granularity: period.granularity,
      anchor: period.anchor,
      label: period.label,
      start: period.start,
      end: period.end,
    },
    summary_by_currency: summary,
    clients: clientsList,
  };
}
