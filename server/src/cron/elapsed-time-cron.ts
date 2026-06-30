import { runElapsedCheckpoint } from '../services/elapsedTime';

// ============================================================
// Elapsed time cron.
// ============================================================
// Twice a working day (IST) it elapses idle design/video spaces' plan hours:
//   - 12:01 pm IST (06:31 UTC) → half the daily allotment   (stage 'midday')
//   - 03:00 pm IST (09:30 UTC) → the remaining half          (stage 'afternoon')
// Each checkpoint is independent (a space busy at noon but idle at 3 pm still
// elapses the afternoon half) and idempotent. Heavy lifting lives in
// services/elapsedTime.ts; this file is just the scheduler, mirroring the
// self-rescheduling setTimeout pattern in timer-cron.ts.

/** Schedule `fn` to run every day at the given IST hour:minute, forever. */
function scheduleDailyIST(hourIST: number, minuteIST: number, label: string, fn: () => Promise<void>) {
  // IST is UTC+5:30; convert the IST wall-clock to a UTC hour:minute.
  let utcMinutes = hourIST * 60 + minuteIST - 330; // 330 = 5h30m
  utcMinutes = ((utcMinutes % 1440) + 1440) % 1440;
  const utcHour = Math.floor(utcMinutes / 60);
  const utcMinute = utcMinutes % 60;

  function schedule() {
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(utcHour, utcMinute, 0, 0);
    if (now >= target) target.setUTCDate(target.getUTCDate() + 1);

    const delay = target.getTime() - now.getTime();
    console.log(`[Elapsed Cron] ${label} scheduled in ${Math.round(delay / 60000)} minutes`);

    setTimeout(async () => {
      try {
        await fn();
      } catch (err) {
        console.error(`[Elapsed Cron] ${label} error:`, err);
      }
      schedule();
    }, delay);
  }

  schedule();
}

export function startElapsedTimeCron(): void {
  scheduleDailyIST(12, 1, 'Midday (12:01 IST)', async () => {
    const r = await runElapsedCheckpoint('midday');
    console.log(
      `[Elapsed Cron] midday ${r.date}: +${r.inserted} elapsed, ${r.skippedActive} active, ${r.skippedExisting} existing${r.nonWorkingDay ? ' (non-working day)' : ''}`,
    );
  });

  scheduleDailyIST(15, 0, 'Afternoon (15:00 IST)', async () => {
    const r = await runElapsedCheckpoint('afternoon');
    console.log(
      `[Elapsed Cron] afternoon ${r.date}: +${r.inserted} elapsed, ${r.skippedActive} active, ${r.skippedExisting} existing${r.nonWorkingDay ? ' (non-working day)' : ''}`,
    );
  });

  console.log('[Elapsed Cron] Elapsed time cron jobs initialized');
}
