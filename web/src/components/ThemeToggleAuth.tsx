'use client';

import { useEffect, useState } from 'react';
import { useThemeStore, type ThemePreference } from '../stores/themeStore';

const OPTIONS: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  {
    value: 'auto',
    label: 'System',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 5a2 2 0 012-2h14a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM8 21h8m-4-5v5" />
      </svg>
    ),
  },
  {
    value: 'light',
    label: 'Light',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
      </svg>
    ),
  },
];

export default function ThemeToggleAuth() {
  const { theme, setTheme } = useThemeStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const active: ThemePreference = mounted ? theme : 'auto';

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-full border border-[#E2E8F0] bg-white/80 p-1 shadow-sm backdrop-blur dark:border-divider dark:bg-surface/80"
    >
      {OPTIONS.map((opt) => {
        const isActive = active === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => setTheme(opt.value)}
            title={opt.label}
            className={`flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition ${
              isActive
                ? 'bg-[#2962FF] text-white shadow-sm'
                : 'text-[#62748E] hover:text-[#0F172B] dark:text-foreground-muted dark:hover:text-foreground'
            }`}
          >
            {opt.icon}
            <span className="hidden sm:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
