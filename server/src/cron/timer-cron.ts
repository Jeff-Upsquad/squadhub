import { supabaseAdmin } from '../supabase';
import { todayIST, IST_OFFSET_MS } from '../utils/ist';

const AUTO_STOP_HOURS = 8;
const AUTO_STOP_MS = AUTO_STOP_HOURS * 60 * 60 * 1000;

/** Auto-stop stale timers (running > 8 hours) */
async function autoStopStaleTimers(): Promise<void> {
  const cutoff = new Date(Date.now() - AUTO_STOP_MS).toISOString();

  const { data: stale } = await supabaseAdmin
    .from('timer_sessions')
    .select('*')
    .is('end_time', null)
    .lt('start_time', cutoff);

  if (!stale || stale.length === 0) return;

  console.log(`[Timer Cron] Auto-stopping ${stale.length} stale timer(s)`);

  for (const session of stale) {
    const startTime = new Date(session.start_time);
    const endTime = new Date(startTime.getTime() + AUTO_STOP_MS);
    const durationSeconds = AUTO_STOP_HOURS * 3600;

    await supabaseAdmin
      .from('timer_sessions')
      .update({
        end_time: endTime.toISOString(),
        duration_seconds: durationSeconds,
        is_auto_stopped: true,
      })
      .eq('id', session.id);

    // Update daily summary
    let summaryQuery = supabaseAdmin
      .from('daily_time_summaries')
      .select('*')
      .eq('user_id', session.user_id)
      .eq('date', session.date);

    if (session.workspace_id) {
      summaryQuery = summaryQuery.eq('workspace_id', session.workspace_id);
    }
    summaryQuery = summaryQuery.eq('context', session.context || 'default');

    const { data: existing } = await summaryQuery.single();

    if (existing) {
      const col = session.timer_type === 'work'
        ? 'total_work_seconds'
        : session.timer_type === 'break'
        ? 'total_break_seconds'
        : 'total_no_work_seconds';

      await supabaseAdmin
        .from('daily_time_summaries')
        .update({
          [col]: (existing as any)[col] + durationSeconds,
          session_count: existing.session_count + 1,
          last_stop: endTime.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      const row: Record<string, any> = {
        user_id: session.user_id,
        workspace_id: session.workspace_id,
        context: session.context || 'default',
        date: session.date,
        total_work_seconds: 0,
        total_break_seconds: 0,
        total_no_work_seconds: 0,
        session_count: 1,
        first_start: session.start_time,
        last_stop: endTime.toISOString(),
      };
      const col = session.timer_type === 'work'
        ? 'total_work_seconds'
        : session.timer_type === 'break'
        ? 'total_break_seconds'
        : 'total_no_work_seconds';
      row[col] = durationSeconds;

      await supabaseAdmin.from('daily_time_summaries').insert(row);
    }
  }
}

/** Split active sessions at midnight IST boundary */
async function midnightSplit(): Promise<void> {
  const today = todayIST();

  // Find active sessions that started before today
  const { data: overnight } = await supabaseAdmin
    .from('timer_sessions')
    .select('*')
    .is('end_time', null)
    .lt('date', today);

  if (!overnight || overnight.length === 0) return;

  console.log(`[Timer Cron] Splitting ${overnight.length} overnight session(s)`);

  for (const session of overnight) {
    // End the old session at 23:59:59 IST of its date
    const oldDateEnd = new Date(session.date + 'T18:29:59.000Z'); // 23:59:59 IST = 18:29:59 UTC
    const startTime = new Date(session.start_time);
    const oldDuration = Math.round((oldDateEnd.getTime() - startTime.getTime()) / 1000);

    await supabaseAdmin
      .from('timer_sessions')
      .update({
        end_time: oldDateEnd.toISOString(),
        duration_seconds: Math.max(oldDuration, 0),
      })
      .eq('id', session.id);

    // Update old day summary
    let oldSummaryQuery = supabaseAdmin
      .from('daily_time_summaries')
      .select('*')
      .eq('user_id', session.user_id)
      .eq('date', session.date);

    if (session.workspace_id) {
      oldSummaryQuery = oldSummaryQuery.eq('workspace_id', session.workspace_id);
    }
    oldSummaryQuery = oldSummaryQuery.eq('context', session.context || 'default');

    const { data: oldSummary } = await oldSummaryQuery.single();

    if (oldSummary) {
      const col = session.timer_type === 'work'
        ? 'total_work_seconds'
        : session.timer_type === 'break'
        ? 'total_break_seconds'
        : 'total_no_work_seconds';

      await supabaseAdmin
        .from('daily_time_summaries')
        .update({
          [col]: (oldSummary as any)[col] + Math.max(oldDuration, 0),
          session_count: oldSummary.session_count + 1,
          last_stop: oldDateEnd.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', oldSummary.id);
    }

    // Create new session starting at 00:00:00 IST today
    const newStart = new Date(today + 'T18:30:00.000Z'); // 00:00:00 IST = 18:30:00 UTC (previous day)
    // Actually midnight IST = 18:30 UTC of the previous day, but for today's date:
    // today in IST starts at (today - 1 day) 18:30 UTC
    // For simplicity, use the current time as the new session start
    await supabaseAdmin.from('timer_sessions').insert({
      user_id: session.user_id,
      workspace_id: session.workspace_id,
      context: session.context || 'default',
      date: today,
      timer_type: session.timer_type,
      start_time: new Date().toISOString(),
    });
  }
}

/**
 * Start the timer cron jobs:
 * - Hourly: auto-stop stale timers
 * - Midnight IST (18:30 UTC): split overnight sessions
 */
export function startTimerCron(): void {
  // Hourly auto-stop check
  setInterval(async () => {
    try {
      await autoStopStaleTimers();
    } catch (err) {
      console.error('[Timer Cron] Auto-stop error:', err);
    }
  }, 60 * 60 * 1000); // Every hour

  // Midnight IST split
  function scheduleMidnight() {
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(18, 30, 0, 0); // 00:00 IST = 18:30 UTC

    if (now >= target) {
      target.setUTCDate(target.getUTCDate() + 1);
    }

    const delay = target.getTime() - now.getTime();
    console.log(`[Timer Cron] Midnight split scheduled in ${Math.round(delay / 60000)} minutes`);

    setTimeout(async () => {
      try {
        await midnightSplit();
      } catch (err) {
        console.error('[Timer Cron] Midnight split error:', err);
      }
      scheduleMidnight();
    }, delay);
  }

  scheduleMidnight();

  // Run auto-stop once on startup
  autoStopStaleTimers().catch((err) => console.error('[Timer Cron] Initial auto-stop error:', err));

  console.log('[Timer Cron] Timer cron jobs initialized');
}
