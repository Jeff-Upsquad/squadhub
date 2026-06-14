'use client';

import { useEffect, useState } from 'react';
import { useThemeStore } from '../stores/themeStore';

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
