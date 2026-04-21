'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, useHasAuthHydrated } from '@/stores/authStore';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const hasHydrated = useHasAuthHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (hasHydrated && isAuthenticated) {
      router.push('/admin');
    }
  }, [hasHydrated, isAuthenticated, router]);

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-[#EEF2FF] via-white to-[#F5EEFF] px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: 'radial-gradient(circle, #CBD5E1 1px, transparent 1px)',
          backgroundSize: '16px 16px',
        }}
      />
      <div className="relative z-10 w-full max-w-md">{children}</div>
    </div>
  );
}
