'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getBrowserNotificationPermission,
  isBrowserNotificationsEnabled,
  isBrowserNotificationsSupported,
  requestBrowserNotificationPermission,
  setBrowserNotificationsEnabled,
} from '../services/browserNotifications';

export default function BrowserNotificationsToggle({
  onCloseMenu,
}: {
  onCloseMenu?: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setEnabled(isBrowserNotificationsEnabled());
    setPermission(getBrowserNotificationPermission());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!isBrowserNotificationsSupported()) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (enabled) {
        setBrowserNotificationsEnabled(false);
        setEnabled(false);
        onCloseMenu?.();
        return;
      }

      let perm = getBrowserNotificationPermission();
      if (perm === 'default') {
        perm = await requestBrowserNotificationPermission();
        setPermission(perm);
      }
      if (perm !== 'granted') {
        setBrowserNotificationsEnabled(false);
        setEnabled(false);
        return;
      }

      setBrowserNotificationsEnabled(true);
      setEnabled(true);
      onCloseMenu?.();
    } finally {
      setBusy(false);
    }
  };

  const statusLine =
    permission === 'denied'
      ? 'Blocked in browser settings'
      : enabled
        ? 'On when tab is in background'
        : 'Off';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={busy || permission === 'denied'}
      onClick={toggle}
      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-[13px] text-[var(--foreground)] hover:bg-[var(--sh-hair-3)] transition disabled:opacity-50"
    >
      <span className="flex flex-col items-start min-w-0">
        <span className="font-medium">Browser notifications</span>
        <span className="text-[11px] text-[var(--foreground-dim)] truncate w-full">{statusLine}</span>
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${
          enabled ? 'bg-[var(--sh-ink)]' : 'bg-[var(--sh-hair-2)]'
        }`}
        aria-hidden
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
            enabled ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}
