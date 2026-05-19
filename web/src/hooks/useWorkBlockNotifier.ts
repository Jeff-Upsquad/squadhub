import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDayPlans } from './useDayPlanner';
import { showToast, showToastCard } from '../components/Toast';
import { dateKey, formatMinute } from '../utils/workBlockRecurrence';
import { usePMStore } from '../stores/pmStore';

interface VirtualWorkBlockPlan {
  task_id: string;
  start_minute: number;
  duration_minutes: number;
  virtual?: boolean;
  kind?: string;
  wb_notify_before_min?: number;
  wb_notify_on_start?: boolean;
  wb_notify_on_end?: boolean;
  task?: { id: string; title: string; task_type_key?: string | null } | null;
}

// Schedules in-app toasts for every work-block occurrence happening today,
// at the user's chosen lead time, at start, and at end. Mount once at the
// app shell so it survives page navigation inside the SPA.
//
// Reuses useDayPlans(today) so a single fetch powers both the calendar and
// the notifier. Re-runs the scheduling pass whenever:
//   - the day-plans data changes (a block was added/edited),
//   - the tab regains focus (clocks may have drifted after sleep),
//   - or the day rolls over.
export function useWorkBlockNotifier() {
  const today = dateKey();
  const { data: plans } = useDayPlans(today);
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const qc = useQueryClient();
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    // Clear any previously-scheduled timers — we always rebuild from the
    // latest plans payload to avoid duplicate firings.
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current = [];

    if (!plans || plans.length === 0) return;

    const todayParts = today.split('-').map((n) => parseInt(n, 10));
    const [y, m, d] = todayParts;

    const wbPlans = plans.filter((p) => {
      const planObj = p as VirtualWorkBlockPlan;
      return planObj.task?.task_type_key === 'work_block';
    }) as VirtualWorkBlockPlan[];

    const now = Date.now();
    for (const p of wbPlans) {
      const startMs = new Date(y, m - 1, d, 0, 0, 0, 0).getTime() + p.start_minute * 60_000;
      const endMs = startMs + p.duration_minutes * 60_000;
      const leadMin = p.wb_notify_before_min ?? 5;
      const notifyStart = p.wb_notify_on_start ?? true;
      const notifyEnd = p.wb_notify_on_end ?? true;
      const title = p.task?.title ?? 'Work block';

      // T - leadMin: "Starting soon" lead-time card (only if the user has
      // a lead time > 0 AND start toasts aren't muted).
      if (notifyStart && leadMin > 0) {
        const fireAt = startMs - leadMin * 60_000;
        if (fireAt > now) {
          const id = window.setTimeout(() => {
            showToastCard({
              title,
              subtitle: `Starts at ${formatMinute(p.start_minute)} — in ${leadMin} min`,
              onClick: () => {
                setActiveTask(p.task_id);
                qc.invalidateQueries({ queryKey: ['work-block', p.task_id] });
              },
            });
          }, fireAt - now);
          timersRef.current.push(id);
        }
      }

      // At start: clickable card.
      if (notifyStart && startMs > now) {
        const id = window.setTimeout(() => {
          showToastCard({
            title,
            subtitle: `Starting now · ${formatMinute(p.start_minute)}`,
            onClick: () => {
              setActiveTask(p.task_id);
              qc.invalidateQueries({ queryKey: ['work-block', p.task_id] });
            },
          });
        }, startMs - now);
        timersRef.current.push(id);
      }

      // At end: plain text toast.
      if (notifyEnd && endMs > now) {
        const id = window.setTimeout(() => {
          showToast(`Work block "${title}" has ended`);
        }, endMs - now);
        timersRef.current.push(id);
      }
    }

    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current = [];
    };
  }, [plans, today, qc, setActiveTask]);

  // Day-rollover: re-fetch tomorrow's plans when midnight passes.
  useEffect(() => {
    const checkRollover = () => {
      if (dateKey() !== today) {
        qc.invalidateQueries({ queryKey: ['day-plans'] });
      }
    };
    const id = window.setInterval(checkRollover, 60_000);
    return () => window.clearInterval(id);
  }, [today, qc]);
}
