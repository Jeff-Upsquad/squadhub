'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getBrowserNotificationPermission,
  isBrowserNotificationsSupported,
  isDesktopNotificationsReady,
  requestBrowserNotificationPermission,
  setBrowserNotificationsEnabled,
  showTestBrowserNotification,
} from '../services/browserNotifications';
import { subscribeToWebPush } from '../services/pushSubscription';

const DISMISS_KEY = 'squadhub-desktop-notif-banner-dismissed';

export default function DesktopNotificationsBanner() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');

  const refresh = useCallback(() => {
    if (!isBrowserNotificationsSupported()) {
      setVisible(false);
      return;
    }
    setPermission(getBrowserNotificationPermission());
    if (isDesktopNotificationsReady()) {
      setVisible(false);
      return;
    }
    if (sessionStorage.getItem(DISMISS_KEY) === '1') {
      setVisible(false);
      return;
    }
    setVisible(true);
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener('squadhub:desktop-notifications-changed', onChange);
    return () => window.removeEventListener('squadhub:desktop-notifications-changed', onChange);
  }, [refresh]);

  if (!visible) return null;

  const enable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let perm = getBrowserNotificationPermission();
      if (perm === 'default') {
        perm = await requestBrowserNotificationPermission();
      }
      if (perm !== 'granted') {
        setPermission(perm);
        return;
      }
      setBrowserNotificationsEnabled(true);
      void subscribeToWebPush();
      showTestBrowserNotification();
      window.dispatchEvent(new Event('squadhub:desktop-notifications-changed'));
      setVisible(false);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  return (
    <div
      className="mx-3 mt-2 mb-1 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--sh-hair)] bg-[var(--sh-hair-3)] px-3 py-2.5 text-[12px]"
      role="status"
    >
      <span className="flex-1 min-w-[200px] text-[var(--foreground)]">
        {permission === 'denied'
          ? 'Desktop alerts are blocked. Allow notifications for this site in your browser settings, then refresh.'
          : 'Get macOS alerts when you\u2019re assigned tasks or mentioned — not just inside Inbox.'}
      </span>
      {permission !== 'denied' && (
        <button
          type="button"
          disabled={busy}
          onClick={enable}
          className="rounded-md bg-[var(--sh-ink)] px-3 py-1.5 text-[12px] font-medium text-[var(--sidebar)] hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Enabling…' : 'Enable desktop alerts'}
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        className="rounded-md px-2 py-1.5 text-[var(--foreground-dim)] hover:bg-[var(--sh-hair-2)]"
      >
        Not now
      </button>
    </div>
  );
}
