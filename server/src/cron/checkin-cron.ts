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
    // SaaS: check-ins are per workspace (account). Sweep every active
    // workspace that has a check-in mini app enabled, marking its members who
    // didn't check in there today.
    const { data: enabled } = await supabaseAdmin
      .from('workspace_mini_apps')
      .select('workspace_id, workspaces!inner(status)')
      .in('slug', ['check-ins', 'daily-checkin', 'daily-checkin-partners'])
      .eq('enabled', true)
      .eq('workspaces.status', 'active');
    const workspaceIds = [...new Set((enabled || []).map((r: any) => r.workspace_id as string))];

    let marked = 0;
    for (const workspaceId of workspaceIds) {
      const { data: members } = await supabaseAdmin
        .from('workspace_members')
        .select('user_id, role_id, users!inner(status)')
        .eq('workspace_id', workspaceId)
        .eq('users.status', 'active');
      if (!members?.length) continue;

      const { data: checkedIn } = await supabaseAdmin
        .from('checkins')
        .select('user_id')
        .eq('workspace_id', workspaceId)
        .eq('date', today);
      const done = new Set((checkedIn || []).map((c: any) => c.user_id));

      const records = (members as any[])
        .filter((m) => !done.has(m.user_id))
        .map((m) => ({
          workspace_id: workspaceId,
          user_id: m.user_id,
          date: today,
          status: 'no_checkin',
          completed_items: [],
          role_id: m.role_id || null,
        }));
      if (!records.length) continue;

      const { error } = await supabaseAdmin
        .from('checkins')
        .upsert(records, { onConflict: 'workspace_id,user_id,date', ignoreDuplicates: true });
      if (error) {
        console.error(`[CheckIn Cron] ${workspaceId}: error inserting missing check-ins:`, error);
        continue;
      }
      marked += records.length;
    }
    const missingUsers = { length: marked };

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
