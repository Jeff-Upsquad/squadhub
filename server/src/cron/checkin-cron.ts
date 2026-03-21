import { supabaseAdmin } from '../supabase';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function todayIST(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.toISOString().split('T')[0];
}

async function isNonWorkingDay(dateStr: string): Promise<boolean> {
  const date = new Date(dateStr + 'T00:00:00Z');
  const dayOfWeek = date.getUTCDay();

  const { data: wdConfig } = await supabaseAdmin
    .from('working_days_config')
    .select('working_days')
    .limit(1)
    .single();

  const workingDays: number[] = wdConfig?.working_days || [1, 2, 3, 4, 5, 6];
  if (!workingDays.includes(dayOfWeek)) return true;

  const { data: specificHoliday } = await supabaseAdmin
    .from('holidays')
    .select('id')
    .eq('date', dateStr)
    .eq('is_recurring', false)
    .limit(1);

  if (specificHoliday && specificHoliday.length > 0) return true;

  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const { data: recurringHoliday } = await supabaseAdmin
    .from('holidays')
    .select('id')
    .eq('is_recurring', true)
    .eq('recurring_month', month)
    .eq('recurring_day', day)
    .limit(1);

  if (recurringHoliday && recurringHoliday.length > 0) return true;

  return false;
}

/**
 * End-of-day cron job: marks missing check-ins as "no_checkin"
 * Should run at 11:59 PM IST daily
 */
export async function markMissingCheckIns(): Promise<void> {
  const today = todayIST();

  console.log(`[CheckIn Cron] Running end-of-day check-in sweep for ${today}`);

  // Skip non-working days
  if (await isNonWorkingDay(today)) {
    console.log(`[CheckIn Cron] ${today} is a non-working day, skipping`);
    return;
  }

  try {
    // Get all approved users
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('status', 'approved');

    if (!users || users.length === 0) {
      console.log('[CheckIn Cron] No approved users found');
      return;
    }

    // Get users who already checked in today
    const { data: checkedIn } = await supabaseAdmin
      .from('checkins')
      .select('user_id')
      .eq('date', today);

    const checkedInIds = new Set((checkedIn || []).map((c: any) => c.user_id));

    // Find users who haven't checked in
    const missingUsers = users.filter((u: any) => !checkedInIds.has(u.id));

    if (missingUsers.length === 0) {
      console.log('[CheckIn Cron] All users checked in today');
      return;
    }

    // Get role_ids for missing users
    const missingIds = missingUsers.map((u: any) => u.id);
    const { data: members } = await supabaseAdmin
      .from('workspace_members')
      .select('user_id, role_id')
      .in('user_id', missingIds);

    const roleMap = new Map((members || []).map((m: any) => [m.user_id, m.role_id]));

    // Insert no_checkin records
    const records = missingUsers.map((u: any) => ({
      user_id: u.id,
      date: today,
      status: 'no_checkin',
      completed_items: [],
      role_id: roleMap.get(u.id) || null,
    }));

    const { error } = await supabaseAdmin
      .from('checkins')
      .upsert(records, { onConflict: 'user_id,date' });

    if (error) {
      console.error('[CheckIn Cron] Error inserting missing check-ins:', error);
      return;
    }

    console.log(`[CheckIn Cron] Marked ${missingUsers.length} users as no_checkin for ${today}`);
  } catch (err) {
    console.error('[CheckIn Cron] Error:', err);
  }
}

/**
 * Schedule the cron job to run at 11:59 PM IST (18:29 UTC) daily
 */
export function startCheckInCron(): void {
  function scheduleNext() {
    const now = new Date();
    // Target: 18:29 UTC (11:59 PM IST)
    const target = new Date(now);
    target.setUTCHours(18, 29, 0, 0);

    // If we've passed today's target, schedule for tomorrow
    if (now >= target) {
      target.setUTCDate(target.getUTCDate() + 1);
    }

    const delay = target.getTime() - now.getTime();
    console.log(`[CheckIn Cron] Next run scheduled in ${Math.round(delay / 60000)} minutes`);

    setTimeout(async () => {
      await markMissingCheckIns();
      scheduleNext();
    }, delay);
  }

  scheduleNext();
  console.log('[CheckIn Cron] Check-in cron job initialized');
}
