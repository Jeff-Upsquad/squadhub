import { supabaseAdmin } from '../supabase';
import { loadCardBilling } from '../utils/cardBilling';
import { loadCardHoursCompletions } from '../utils/cardHoursCompletion';
import { istTodayISO } from '../utils/folderCommittedHours';

// ============================================================
// Hours-completion cron (backstop).
// ============================================================
// The Partner Payments + Gross Profit modules recompute each card's monthly
// hours completion (plan target vs. tracked+elapsed actual) on view, so the
// numbers are always current for months an admin looks at. This cron is only a
// BACKSTOP: once a day it snapshots the current IST month for EVERY linked card
// (so a card nobody opened still has a persisted row), and on the 1st of the
// month also finalizes the just-closed month.
//
// It writes only card_hours_completion (no external sends), so it's safe to run
// alongside the modules — the upsert on (card_id, period_month) converges. Runs
// at 15:30 IST, just after the elapsed-time afternoon checkpoint (15:00) so the
// day's idle-hours are already written. Mirrors the self-rescheduling setTimeout
// pattern in elapsed-time-cron.ts.

/** Schedule `fn` to run every day at the given IST hour:minute, forever. */
function scheduleDailyIST(hourIST: number, minuteIST: number, label: string, fn: () => Promise<void>) {
  let utcMinutes = hourIST * 60 + minuteIST - 330; // 330 = 5h30m (IST offset)
  utcMinutes = ((utcMinutes % 1440) + 1440) % 1440;
  const utcHour = Math.floor(utcMinutes / 60);
  const utcMinute = utcMinutes % 60;

  function schedule() {
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(utcHour, utcMinute, 0, 0);
    if (now >= target) target.setUTCDate(target.getUTCDate() + 1);

    const delay = target.getTime() - now.getTime();
    console.log(`[HoursCompletion Cron] ${label} scheduled in ${Math.round(delay / 60000)} minutes`);

    setTimeout(async () => {
      try {
        await fn();
      } catch (err) {
        console.error(`[HoursCompletion Cron] ${label} error:`, err);
      }
      schedule();
    }, delay);
  }

  schedule();
}

/** Snapshot (upsert) every linked card's hours completion for one IST month. */
async function snapshotMonth(year: number, month: number): Promise<number> {
  const { data: cards } = await supabaseAdmin
    .from('subscription_cards')
    .select('id, linked_folder_id, state, deleted_at')
    .not('linked_folder_id', 'is', null);

  // Skip closed / soft-deleted cards — they've left the book (their completion is
  // whatever was last computed while active).
  const active = ((cards || []) as any[]).filter(
    (c) => c.state !== 'closed' && !c.deleted_at && c.linked_folder_id,
  );
  if (active.length === 0) return 0;

  const cardIds = active.map((c) => c.id as string);
  const billing = await loadCardBilling(cardIds);
  const inputs = active
    .map((c) => ({ cardId: c.id as string, linkedFolderId: c.linked_folder_id as string, billing: billing.get(c.id) }))
    .filter((c): c is { cardId: string; linkedFolderId: string; billing: NonNullable<typeof c.billing> } => !!c.billing);

  const map = await loadCardHoursCompletions(inputs, year, month);
  return map.size;
}

/** Previous IST month for a given (year, month). */
function prevMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function startHoursCompletionCron(): void {
  scheduleDailyIST(15, 30, 'Daily snapshot (15:30 IST)', async () => {
    const today = istTodayISO(); // 'YYYY-MM-DD'
    const [y, m, d] = today.split('-').map(Number);

    const cur = await snapshotMonth(y, m);
    console.log(`[HoursCompletion Cron] ${y}-${String(m).padStart(2, '0')}: ${cur} cards snapshotted`);

    // On the 1st, finalize the month that just closed for any card nobody reopened.
    if (d === 1) {
      const p = prevMonth(y, m);
      const prevCount = await snapshotMonth(p.year, p.month);
      console.log(
        `[HoursCompletion Cron] ${p.year}-${String(p.month).padStart(2, '0')} (finalize): ${prevCount} cards`,
      );
    }
  });

  console.log('[HoursCompletion Cron] Hours completion cron job initialized');
}
