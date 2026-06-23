'use client';

import { useEffect } from 'react';
import {
  isWebPushSupported,
  registerServiceWorker,
  subscribeToWebPush,
} from '../services/pushSubscription';
import { isDesktopNotificationsReady } from '../services/browserNotifications';

/**
 * Registers the web-push service worker on load and, if the user already enabled
 * notifications, reconciles the push subscription (re-registers it / refreshes a
 * rotated endpoint). Renders nothing.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!isWebPushSupported()) return;
    registerServiceWorker().then(() => {
      if (isDesktopNotificationsReady()) {
        void subscribeToWebPush();
      }
    });
  }, []);

  return null;
}
