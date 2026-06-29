import { useEffect } from 'react';

/**
 * Mirrors a count onto the installed-PWA app icon badge (macOS Dock /
 * Windows taskbar) via the W3C Badging API.
 *
 * - count > 0  → shows the number on the Dock icon
 * - count === 0 → clears the badge
 *
 * No-ops when the API is unavailable (not an installed PWA, or unsupported
 * browser). The service worker also sets the badge from incoming pushes so it
 * updates while the window is closed; this hook keeps it in sync while the app
 * is open and is the path that clears it once the Inbox is read.
 */
export function useAppBadge(count: number | undefined): void {
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!nav.setAppBadge) return;

    const n = count ?? 0;
    // setAppBadge() with 0 clears on most engines, but clearAppBadge is the
    // documented way and avoids a stray dot on some platforms.
    const p = n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge?.();
    // Rejections (e.g. permission/feature gating) are non-fatal — swallow them.
    p?.catch(() => {});
  }, [count]);
}
