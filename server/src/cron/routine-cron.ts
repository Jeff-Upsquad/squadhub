import { spawnDueRoutineInstances } from '../services/routineSpawner';

/**
 * Routine spawner cron: materialises recurring-task instances for the new
 * IST day. Runs at 00:05 IST (18:35 UTC) daily, plus a catch-up sweep
 * shortly after boot so a deploy that crosses midnight doesn't skip a day.
 * Both paths are idempotent (unique index on template+date).
 */
export function startRoutineCron(): void {
  // Boot catch-up — delayed a few seconds so startup isn't blocked.
  setTimeout(() => {
    spawnDueRoutineInstances().catch((err) =>
      console.error('[Routine Cron] Boot catch-up sweep failed:', err),
    );
  }, 5000);

  function scheduleNext() {
    const now = new Date();
    // Target: 18:35 UTC (00:05 IST next calendar day in IST)
    const target = new Date(now);
    target.setUTCHours(18, 35, 0, 0);

    if (now >= target) {
      target.setUTCDate(target.getUTCDate() + 1);
    }

    const delay = target.getTime() - now.getTime();
    console.log(`[Routine Cron] Next run scheduled in ${Math.round(delay / 60000)} minutes`);

    setTimeout(async () => {
      try {
        await spawnDueRoutineInstances();
      } catch (err) {
        console.error('[Routine Cron] Sweep failed:', err);
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();
  console.log('[Routine Cron] Routine spawner cron initialized');
}
