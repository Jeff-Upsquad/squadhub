import { supabaseAdmin } from '../supabase';
import { todayIST, isNonWorkingDay } from '../utils/ist';

/**
 * End-of-day cron: marks missing daily timesheets as "no_submission".
 * Runs at 11:59 PM IST. Only users who have at least one active target are
 * expected to submit, so placeholders are limited to them (the feature is
 * opt-in via admin-set targets). Missed days remain backfillable later as late.
 */
export async function markMissingTimesheets(): Promise<void> {
  const today = todayIST();
  console.log(`[Timesheet Cron] Running end-of-day timesheet sweep for ${today}`);

  if (await isNonWorkingDay(today)) {
    console.log(`[Timesheet Cron] ${today} is a non-working day, skipping`);
    return;
  }

  try {
    // Users expected to submit = those with at least one active target.
    const { data: targets } = await supabaseAdmin
      .from('timesheet_targets')
      .select('user_id')
      .eq('is_active', true);

    const expectedIds = Array.from(new Set((targets || []).map((t: any) => t.user_id)));
    if (expectedIds.length === 0) {
      console.log('[Timesheet Cron] No users with active targets');
      return;
    }

    // Who already has a row (any status) for today?
    const { data: existing } = await supabaseAdmin
      .from('timesheets')
      .select('user_id')
      .eq('date', today)
      .in('user_id', expectedIds);
    const haveRow = new Set((existing || []).map((r: any) => r.user_id));

    const missing = expectedIds.filter((id) => !haveRow.has(id));
    if (missing.length === 0) {
      console.log('[Timesheet Cron] All expected users submitted today');
      return;
    }

    const records = missing.map((id) => ({
      user_id: id,
      date: today,
      status: 'no_submission',
    }));

    const { error } = await supabaseAdmin
      .from('timesheets')
      .upsert(records, { onConflict: 'user_id,date' });
    if (error) {
      console.error('[Timesheet Cron] Error inserting missing timesheets:', error);
      return;
    }

    console.log(`[Timesheet Cron] Marked ${missing.length} users as no_submission for ${today}`);
  } catch (err) {
    console.error('[Timesheet Cron] Error:', err);
  }
}

/** Schedule the sweep at 11:59 PM IST (18:29 UTC) daily. */
export function startTimesheetCron(): void {
  function scheduleNext() {
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(18, 29, 0, 0);
    if (now >= target) target.setUTCDate(target.getUTCDate() + 1);

    const delay = target.getTime() - now.getTime();
    console.log(`[Timesheet Cron] Next run scheduled in ${Math.round(delay / 60000)} minutes`);

    setTimeout(async () => {
      await markMissingTimesheets();
      scheduleNext();
    }, delay);
  }

  scheduleNext();
  console.log('[Timesheet Cron] Timesheet cron job initialized');
}
