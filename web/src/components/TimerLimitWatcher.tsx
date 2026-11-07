import { useEffect, useRef } from 'react';
import { useParallelTimers } from '../hooks/useParallelTimers';
import { showToastCard } from './Toast';

const CHECK_INTERVAL_MS = 30_000;

/** Stops task timers that reach the session limit and tells the user. Renders nothing. */
export default function TimerLimitWatcher() {
  const { stopExpiredTimers } = useParallelTimers();
  const latest = useRef(stopExpiredTimers);
  latest.current = stopExpiredTimers;

  useEffect(() => {
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const stopped = await latest.current();
        for (const t of stopped) {
          showToastCard({ subtitle: 'Timer stopped after 6 hours', title: t.taskTitle, durationMs: 15_000 });
        }
      } catch (err) {
        console.error('Could not stop timers at the 6-hour limit:', err);
      } finally {
        checking = false;
      }
    };
    // A sleeping laptop pauses the interval, so also check on wake and on focus.
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    void check();
    const interval = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return null;
}
