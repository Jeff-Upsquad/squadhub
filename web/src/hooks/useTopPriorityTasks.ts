import { useEffect, useMemo, useState } from 'react';
import type { Task } from '@squadhub/shared';
import { usePMStore } from '../stores/pmStore';
import { resolveTopPriorityBucket, topPriorityVisibility } from '../lib/topPriority';

// Longest single wait between re-checks. setTimeout overflows past ~24.8 days,
// and a work date can sit months out — so cap the wait and re-arm.
const MAX_WAIT_MS = 60 * 60 * 1000;

/**
 * Top Priority tasks on My Home are time-gated: a task whose work date is in
 * the future waits for that day, and a task parked in the Evening / Night
 * section waits for that time of day. This hook applies the gate and re-runs
 * itself the moment a held-back task becomes due, so the task reappears in the
 * Top Priority card on its own.
 */
export function useTopPriorityTasks(candidates: Task[], inProgressIds: Set<string>): Task[] {
  const focusBuckets = usePMStore((s) => s.focusBuckets);
  const recurringFocusBuckets = usePMStore((s) => s.recurringFocusBuckets);
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  // Bumped whenever the gate needs re-evaluating; the memo reads the current
  // clock on every run so a stale render can't mis-gate a task.
  const [tick, setTick] = useState(0);

  const { visible, nextWake } = useMemo(() => {
    const now = new Date();
    const visible: Task[] = [];
    let nextWake: number | null = null;
    for (const task of candidates) {
      const { bucket, isTemplate } = resolveTopPriorityBucket(
        task,
        focusBuckets,
        recurringFocusBuckets,
        inProgressIds.has(task.id),
      );
      const result = topPriorityVisibility({
        task,
        bucket,
        bucketIsTemplate: isTemplate,
        now,
        timeZone: tz,
      });
      if (result.visible) {
        visible.push(task);
        continue;
      }
      if (result.visibleFrom != null && (nextWake == null || result.visibleFrom < nextWake)) {
        nextWake = result.visibleFrom;
      }
    }
    return { visible, nextWake };
  }, [candidates, focusBuckets, recurringFocusBuckets, inProgressIds, tick, tz]);

  // Wake up the moment the earliest held-back task becomes due, so it drops
  // back into the Top Priority card without the user touching anything.
  useEffect(() => {
    if (nextWake == null) return;
    let id: ReturnType<typeof setTimeout>;
    const arm = () => {
      const delay = Math.max(500, Math.min(nextWake! - Date.now(), MAX_WAIT_MS));
      id = setTimeout(() => {
        if (Date.now() >= nextWake! - 250) setTick((t) => t + 1);
        else arm();
      }, delay);
    };
    arm();
    return () => clearTimeout(id);
  }, [nextWake, tick]);

  return visible;
}
