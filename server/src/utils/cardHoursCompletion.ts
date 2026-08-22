// ============================================================
// cardHoursCompletion
//
// Per (card, IST month) reconciliation of the plan's committed monthly hours
// (the TARGET, mirrored read-only from the plan) against the hours actually
// spent in the card's linked space -- tracked task time (task_time_entries) plus
// elapsed idle-day time (elapsed_time_entries). Produces a signed "additional
// hours" delta (+ overage / - shortfall) and the money it moves:
//   - Partner Payments: payout += additional_hours * partner_hourly_rate
//   - Gross Profit:      revenue += additional_hours * client_hourly_rate AND
//                        partner cost += additional_hours * partner_hourly_rate
// where hourly rate = monthly price / standard_monthly_hours (month-length
// independent, since per-day-rate / daily-hours reduces to the same figure).
//
// PAUSED (Aug 2026): the delta + its money are switched off by
// ADDITIONAL_HOURS_EFFECTIVE_FROM below — see the comment there for how to
// re-enable from a chosen month without restating history.
//
// Compute-on-view: the Partner Payments + Gross Profit handlers already resolve
// each card's CardBilling for the chosen month, so they pass it in and we reuse
// it (never re-query prices). Results are upserted onto card_hours_completion
// (migration 157) so a daily cron backstop and later reads share the snapshot.
//
// Attribution note: target + actual are SPACE-level (the linked folder), so a
// card's completion measures its space's whole-month hours. Correct for the
// standard one-card-per-space engagement; a rare multi-card-per-folder history
// is attributed by the plan timeline's active windows within the month.
// ============================================================
import { supabaseAdmin } from '../supabase';
import type { CardBilling } from './cardBilling';
import { getFolderPlanTimeline, committedHoursForRange, istMonthBounds } from './folderCommittedHours';
import { aggregateFolderTimeSummary, aggregateFolderElapsedSummary } from '../services/folderShareMetrics';

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ------------------------------------------------------------
// Additional-hours PAUSE switch
//
// The signed additional-hours delta (+ overage / − shortfall) and the money it
// moves are currently PAUSED: payouts and revenue are computed on base price
// only, everywhere (Partner Payments admin/mini-app/portal + Gross Profit).
// To re-enable from a given IST month onward, set this to 'YYYY-MM' (e.g.
// '2027-01'). Months BEFORE that value stay permanently excluded — even when
// re-viewed or recomputed later — so historical months are never restated with
// the delta; that month and after include it again.
// ------------------------------------------------------------
export const ADDITIONAL_HOURS_EFFECTIVE_FROM: string | null = null;

/** True when the delta applies to an IST month ('YYYY-MM-01' or 'YYYY-MM'). */
export function additionalHoursActiveForMonth(periodMonth: string): boolean {
  if (!ADDITIONAL_HOURS_EFFECTIVE_FROM) return false;
  return periodMonth.slice(0, 7) >= ADDITIONAL_HOURS_EFFECTIVE_FROM;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export interface HoursCompletion {
  card_id: string;
  linked_folder_id: string | null;
  period_month: string; // 'YYYY-MM-01' (IST)
  target_daily_hours: number | null;
  target_weekly_hours: number | null;
  target_monthly_hours: number; // prorated to the card's active window -> delta baseline
  standard_monthly_hours: number | null; // full plan monthly hours -> rate divisor
  actual_hours: number; // tracked + elapsed
  additional_hours: number; // signed = actual - target
  /** True when the plan target was 0/unresolved but hours WERE logged — the delta
   *  is almost certainly a missing target, so we surface the hours but move NO
   *  money (both adjustments forced to 0) and flag it for the UI to tag. */
  target_unresolved: boolean;
  partner_hourly_rate: number | null;
  client_hourly_rate: number | null;
  additional_partner_payment: number; // round(additional_hours * partner_hourly_rate); 0 when no rate
  additional_revenue: number; // round(additional_hours * client_hourly_rate); 0 when no rate
}

/** Zero-delta completion for a card with no linked space (nothing to measure). */
function emptyCompletion(
  cardId: string,
  linkedFolderId: string | null,
  periodMonth: string,
  billing: CardBilling,
): HoursCompletion {
  return {
    card_id: cardId,
    linked_folder_id: linkedFolderId,
    period_month: periodMonth,
    target_daily_hours: billing.daily_hours,
    target_weekly_hours: billing.weekly_hours,
    target_monthly_hours: 0,
    standard_monthly_hours: billing.monthly_hours,
    actual_hours: 0,
    additional_hours: 0,
    target_unresolved: false,
    partner_hourly_rate: null,
    client_hourly_rate: null,
    additional_partner_payment: 0,
    additional_revenue: 0,
  };
}

/**
 * Compute (and, by default, upsert) one card's hours-completion for an IST month.
 * `billing` is the CardBilling the caller already resolved (loadCardBilling /
 * resolveTermBilling) -- reused for the rate divisor + prices so we never
 * re-query them. `month` is 1-based. Returns the figures even when nothing is
 * persisted (e.g. no linked folder).
 */
export async function computeCardHoursCompletion(
  cardId: string,
  linkedFolderId: string | null,
  year: number,
  month: number,
  billing: CardBilling,
  opts?: { persist?: boolean },
): Promise<HoursCompletion> {
  const persist = opts?.persist !== false;
  const { start: from, end: to } = istMonthBounds(`${year}-${pad2(month)}-15`);
  const periodMonth = `${year}-${pad2(month)}-01`;

  // No linked space -> nothing to measure. Return zeros; don't persist a noise row.
  if (!linkedFolderId) return emptyCompletion(cardId, null, periodMonth, billing);

  const standardMonthly = billing.monthly_hours; // rate divisor (may be null)

  // Target: period-aware committed hours for the card's active window this month
  // (working-day aware, prorated for partial/paused windows). 0 when the folder
  // has no card / no daily plan hours.
  const tl = await getFolderPlanTimeline(linkedFolderId);
  const targetMonthly = tl.hasCard ? committedHoursForRange(tl, from, to) : 0;

  // Actual: tracked task time + elapsed idle-day time for the space this month.
  const [tracked, elapsed] = await Promise.all([
    aggregateFolderTimeSummary(linkedFolderId, from, to),
    aggregateFolderElapsedSummary(linkedFolderId, from, to),
  ]);
  const trackedSec = tracked.reduce((s, r) => s + Number(r.total_work_seconds || 0), 0);
  const elapsedSec = elapsed.reduce((s, r) => s + Number(r.elapsed_seconds || 0), 0);
  const actualHours = round2((trackedSec + elapsedSec) / 3600);

  const additionalHours = additionalHoursActiveForMonth(periodMonth)
    ? round2(actualHours - targetMonthly)
    : 0;

  // Guard: a 0/unresolved target with hours logged is almost certainly a MISSING
  // target (legacy/hand-made card with no assignment terms, or a space whose
  // live-card plan timeline can't be read) — NOT real over-delivery. Surface the
  // hours but move NO money, and flag it so the UI can tag the issue.
  const targetUnresolved = targetMonthly <= 0 && actualHours > 0;

  // Hourly rates. Undefined when the plan carries no monthly hours -> no money
  // moves (but the hours delta is still reported).
  const hasRate = standardMonthly != null && standardMonthly > 0;
  const partnerHourly = hasRate && billing.partner_price != null ? billing.partner_price / standardMonthly! : null;
  const clientHourly = hasRate && billing.subscription_price != null ? billing.subscription_price / standardMonthly! : null;
  const additionalPartnerPayment =
    !targetUnresolved && partnerHourly != null ? Math.round(additionalHours * partnerHourly) : 0;
  const additionalRevenue =
    !targetUnresolved && clientHourly != null ? Math.round(additionalHours * clientHourly) : 0;

  const result: HoursCompletion = {
    card_id: cardId,
    linked_folder_id: linkedFolderId,
    period_month: periodMonth,
    target_daily_hours: billing.daily_hours,
    target_weekly_hours: billing.weekly_hours,
    target_monthly_hours: targetMonthly,
    standard_monthly_hours: standardMonthly,
    actual_hours: actualHours,
    additional_hours: additionalHours,
    target_unresolved: targetUnresolved,
    partner_hourly_rate: partnerHourly,
    client_hourly_rate: clientHourly,
    additional_partner_payment: additionalPartnerPayment,
    additional_revenue: additionalRevenue,
  };

  if (persist) {
    // Real merge on the (card_id, period_month) unique index so a later same-day
    // load reflects newly accrued elapsed hours. computed_at / updated_at are
    // omitted: computed_at keeps its first-insert default; updated_at is refreshed
    // by the BEFORE UPDATE trigger on the conflict path.
    const { error } = await supabaseAdmin.from('card_hours_completion').upsert(
      {
        card_id: cardId,
        linked_folder_id: linkedFolderId,
        period_month: periodMonth,
        target_daily_hours: billing.daily_hours,
        target_weekly_hours: billing.weekly_hours,
        target_monthly_hours: targetMonthly,
        standard_monthly_hours: standardMonthly,
        actual_hours: actualHours,
        additional_hours: additionalHours,
      },
      { onConflict: 'card_id,period_month' },
    );
    if (error) throw new Error(error.message);
  }

  return result;
}

/**
 * Batch entry point for a module handler: compute every card's completion for
 * one IST month and upsert. De-dupes by cardId (callers pass per-term lists),
 * runs with bounded concurrency, and swallows per-card failures so one bad
 * folder never breaks the whole module load. Returns Map<cardId, HoursCompletion>.
 */
export async function loadCardHoursCompletions(
  cards: { cardId: string; linkedFolderId: string | null; billing: CardBilling }[],
  year: number,
  month: number,
  opts?: { persist?: boolean },
): Promise<Map<string, HoursCompletion>> {
  const out = new Map<string, HoursCompletion>();
  const seen = new Set<string>();
  const unique = cards.filter((c) => {
    if (seen.has(c.cardId)) return false;
    seen.add(c.cardId);
    return true;
  });

  const CONCURRENCY = 6;
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const batch = unique.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((c) =>
        computeCardHoursCompletion(c.cardId, c.linkedFolderId, year, month, c.billing, opts).catch(() => null),
      ),
    );
    results.forEach((r, idx) => {
      if (r) out.set(batch[idx].cardId, r);
    });
  }
  return out;
}
