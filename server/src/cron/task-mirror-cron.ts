import { reconcileAllMirrors } from '../services/taskMirror';

/**
 * Task-mirror cron: keeps mirrored Course/Meeting tasks in step with their
 * sources (lms_assignments / meetings). The inline write-path hooks cover the
 * common cases; this is the safety net for changes made outside those paths
 * (direct DB edits, due-dates set out-of-band, deleted rows) plus the one-time
 * backfill that runs on every deploy. Fully idempotent.
 */
export function startTaskMirrorCron(): void {
  // Boot backfill — delayed a few seconds so startup isn't blocked.
  setTimeout(() => {
    reconcileAllMirrors()
      .then((r) =>
        console.log(
          `[Task Mirror Cron] Boot reconcile: ${r.meetings} meeting(s), ${r.courses} course(s)`,
        ),
      )
      .catch((err) => console.error('[Task Mirror Cron] Boot reconcile failed:', err));
  }, 8000);

  // Daily drift sweep.
  const DAY_MS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    reconcileAllMirrors().catch((err) =>
      console.error('[Task Mirror Cron] Daily reconcile failed:', err),
    );
  }, DAY_MS);

  console.log('[Task Mirror Cron] Task mirror cron initialized');
}
