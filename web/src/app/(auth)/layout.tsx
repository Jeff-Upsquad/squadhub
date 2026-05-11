'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useHasHydrated } from '@/hooks/useHasHydrated';
import ThemeToggleAuth from '@/components/ThemeToggleAuth';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const hydrated = useHasHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!hydrated) return;
    if (isAuthenticated) {
      router.push('/app');
    }
  }, [hydrated, isAuthenticated, router]);

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-[#F8FAFC] px-4 py-12 dark:bg-canvas">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#2962FF]/[0.12] via-transparent to-[#8B5CF6]/[0.16] dark:from-[#2962FF]/[0.18] dark:to-[#8B5CF6]/[0.22]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 text-[#0F172B]/[0.08] dark:text-[#e2e8f0]/[0.08]"
        style={{
          backgroundImage: 'radial-gradient(currentColor 1.25px, transparent 1.25px)',
          backgroundSize: '16px 16px',
        }}
      />
      <div className="absolute right-4 top-4 z-20">
        <ThemeToggleAuth />
      </div>
      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-8">{children}</div>
    </div>
  );
}
