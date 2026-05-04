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
      className={`${jakarta.variable} ${inter.variable} min-h-dvh bg-[#F7F6F3] font-[family-name:var(--font-inter)]`}
    >
      {showTopBar && (
        <header className="sticky top-0 z-40 flex items-center justify-between border-b-2 border-black bg-white px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border-2 border-black bg-[#d4ff4d] text-xs font-bold text-black shadow-[2px_2px_0_0_#000]">
              SH
            </span>
            <h1 className="font-[family-name:var(--font-jakarta)] text-base font-bold tracking-tight text-[#0a0a0a]">
              Published Cards
            </h1>
          </div>
          <button
            onClick={() => { logout(); router.push('/m/login'); }}
            className="rounded-lg border-2 border-black bg-white px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] active:scale-[0.97] transition-transform"
          >
            Logout
          </button>
        </header>
      )}
      {children}
    </div>
  );
}
