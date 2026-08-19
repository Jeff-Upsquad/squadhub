'use client';

import { useEffect, useState } from 'react';
import { useThemeStore } from '../stores/themeStore';

/**
 * `?theme=dark|light` forces the theme, overriding the user's own preference.
 *
 * This is for embedded surfaces (/embed/*): Squad CRM frames SquadHub modules,
 * and a light module inside a dark CRM reads as a broken page. The host passes
 * its resolved theme down. Deliberately NOT written to the theme store — the
 * embed shares an origin with the real app, so persisting it would change the
 * user's SquadHub theme from inside an iframe.
 */
function forcedTheme(): 'dark' | 'light' | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('theme');
  return value === 'dark' || value === 'light' ? value : null;
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((s) => s.theme);
  const [hydrated, setHydrated] = useState(false);

  // Mark hydrated after first client mount. By this point zustand persist
  // has rehydrated from localStorage (sync storage). Before this, we do
  // NOT touch <html>.classList, so the anti-flicker script in layout.tsx
  // remains authoritative for the initial paint.
  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;

    const forced = forcedTheme();
    if (forced) {
      root.classList.toggle('dark', forced === 'dark');
      return;
    }

    if (theme === 'dark') {
      root.classList.add('dark');
      return;
    }

    if (theme === 'light') {
      root.classList.remove('dark');
      return;
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (e: MediaQueryList | MediaQueryListEvent) => {
      root.classList.toggle('dark', e.matches);
    };
    apply(mq);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, hydrated]);

  return <>{children}</>;
}
