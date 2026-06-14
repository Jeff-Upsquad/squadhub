'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Plus_Jakarta_Sans, Inter } from 'next/font/google';
import { useAuthStore, useHasAuthHydrated } from '@/stores/authStore';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const hasHydrated = useHasAuthHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!isAuthenticated && pathname !== '/m/login') {
      router.push('/m/login');
    }
    if (isAuthenticated && pathname === '/m/login') {
      router.push('/m/published-cards');
    }
  }, [hasHydrated, isAuthenticated, pathname, router]);

  if (!hasHydrated) return null;

  if (!isAuthenticated && pathname !== '/m/login') return null;

  const showTopBar = isAuthenticated && pathname !== '/m/login';

  return (
    <div
      className={`${jakarta.variable} ${inter.variable} min-h-dvh sh-surface font-[family-name:var(--font-inter)]`}
    >
      {showTopBar && (
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-[var(--color-sh-warm-border)] bg-surface px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-sh-lime)] text-xs font-bold text-[var(--color-sh-ink)] ring-1 ring-[var(--color-sh-ink)]">
              SH
            </span>
            <h1 className="text-base font-semibold tracking-tight text-[var(--color-sh-ink)]">
              Published Cards
            </h1>
          </div>
          <button
            onClick={() => { logout(); router.push('/m/login'); }}
            className="sh-btn-ghost sh-btn-ghost-sm"
          >
            Logout
          </button>
        </header>
      )}
      {children}
    </div>
  );
}
