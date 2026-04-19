import { supabaseAdmin } from '../supabase';
import { todayIST, isNonWorkingDay } from '../utils/ist';

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
    // Get all active users
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('status', 'active');

    if (!users || users.length === 0) {
      console.log('[CheckIn Cron] No active users found');
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
