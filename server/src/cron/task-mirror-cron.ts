import { reconcileAllMirrors } from '../services/taskMirror';

/**
 * Task-mirror cron: keeps mirrored Meeting tasks in step with their sources.
 * The inline write-path hooks cover the common cases; this is the safety net
 * for changes made outside those paths plus a boot backfill. Fully idempotent.
 */
export function startTaskMirrorCron(): void {
  setTimeout(() => {
    reconcileAllMirrors()
      .then((r) => console.log(`[Task Mirror Cron] Boot reconcile: ${r.meetings} meeting(s)`))
      .catch((err) => console.error('[Task Mirror Cron] Boot reconcile failed:', err));
  }, 8000);

  const DAY_MS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    reconcileAllMirrors().catch((err) =>
      console.error('[Task Mirror Cron] Daily reconcile failed:', err),
    );
  }, DAY_MS);

  console.log('[Task Mirror Cron] Task mirror cron initialized');
}
