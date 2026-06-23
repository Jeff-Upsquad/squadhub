'use client';

import { useEffect, useState } from 'react';

const DISMISS_KEY = 'squadhub-pwa-install-dismissed';

// The `beforeinstallprompt` event isn't in the DOM lib types.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Dismissible "Install app" banner. Chrome/Edge fire `beforeinstallprompt` when
 * the PWA is installable; we capture it and offer an in-app button (the browser's
 * own install affordance is easy to miss). Hidden once installed or dismissed.
 * Safari/iOS don't fire the event (install is a manual Share → Add to Home Screen
 * / File → Add to Dock), so this simply stays hidden there.
 */
export default function InstallPwaPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      /* ignore */
    }
    // Already installed (running standalone) — nothing to offer.
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => setVisible(false);

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!visible) return null;

  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* ignore */
    }
    setDeferred(null);
    setVisible(false);
  };

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  return (
    <div
      className="mx-3 mt-2 mb-1 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--sh-hair)] bg-[var(--sh-hair-3)] px-3 py-2.5 text-[12px]"
      role="status"
    >
      <span className="flex-1 min-w-[200px] text-[var(--foreground)]">
        Install SquadHub as an app — opens in its own window and gets notifications even when your browser is closed.
      </span>
      <button
        type="button"
        onClick={install}
        className="rounded-md bg-[var(--sh-ink)] px-3 py-1.5 text-[12px] font-medium text-[var(--sidebar)] hover:opacity-90"
      >
        Install app
      </button>
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
