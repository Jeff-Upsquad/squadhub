import { useEffect, useRef, useState } from 'react';

// Pulse (expanding ring) plays for the first 20s after a new notification.
const PULSE_MS = 20_000;
// The badge stays red for 30 min, then reverts to the normal (ink) tone.
const ALERT_MS = 30 * 60_000;
// Persisted so a page refresh inside the window keeps the badge red.
const LS_KEY = 'sh-notif-alert-at';

export interface NotificationFreshness {
  /** A notification arrived within the last 30 min — render the badge red. */
  alert: boolean;
  /** It arrived within the last 20s — play the pulsing ring. */
  pulse: boolean;
}

const IDLE: NotificationFreshness = { alert: false, pulse: false };

function readStored(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = Number(window.localStorage.getItem(LS_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function deriveFrom(alertAt: number | null, now: number): NotificationFreshness {
  if (alertAt == null) return IDLE;
  const elapsed = now - alertAt;
  if (elapsed >= ALERT_MS) return IDLE;
  return { alert: true, pulse: elapsed < PULSE_MS };
}

/**
 * Derives the inbox notification badge's "freshness" from the unread count.
 *
 * When `count` increases (a new notification arrives) the badge turns red and
 * pulses; the pulse stops after 20s and the red reverts to the normal tone
 * after 30 min. Each new notification restarts both timers. The very first
 * observed count is treated as a baseline so notifications already unread on
 * load don't trigger the alert.
 *
 * Pass the raw query value (`number | undefined`) so the initial load — before
 * the count has resolved — is ignored.
 */
export function useNotificationFreshness(count: number | undefined): NotificationFreshness {
  const [state, setState] = useState<NotificationFreshness>(() => deriveFrom(readStored(), Date.now()));
  const prevCount = useRef<number | null>(null);
  const timers = useRef<number[]>([]);

  // Apply an alert window starting at `alertAt`: set the current state and
  // schedule the pulse-off (20s) and alert-off (30 min) transitions.
  const apply = (alertAt: number) => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    const now = Date.now();
    setState(deriveFrom(alertAt, now));

    const toPulseEnd = alertAt + PULSE_MS - now;
    if (toPulseEnd > 0) {
      timers.current.push(
        window.setTimeout(() => setState((s) => (s.alert ? { alert: true, pulse: false } : s)), toPulseEnd),
      );
    }

    const toAlertEnd = alertAt + ALERT_MS - now;
    if (toAlertEnd > 0) {
      timers.current.push(
        window.setTimeout(() => {
          setState(IDLE);
          window.localStorage.removeItem(LS_KEY);
        }, toAlertEnd),
      );
    } else {
      window.localStorage.removeItem(LS_KEY);
    }
  };

  // Resume a persisted alert window on mount; clear timers on unmount.
  useEffect(() => {
    const stored = readStored();
    if (stored != null) apply(stored);
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect new notifications: the unread count rising above its previous value.
  useEffect(() => {
    if (count == null) return; // still loading — no baseline yet
    const prev = prevCount.current;
    prevCount.current = count;
    if (prev == null) return; // first resolved value is the baseline, not an alert
    if (count > prev) {
      const now = Date.now();
      window.localStorage.setItem(LS_KEY, String(now));
      apply(now);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  return state;
}
