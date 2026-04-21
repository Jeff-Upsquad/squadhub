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
    <div className="relative flex min-h-screen w-full items-center justify-center bg-[#F8FAFC] px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#2962FF]/[0.12] via-transparent to-[#8B5CF6]/[0.16]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage: 'radial-gradient(#0F172B 1.25px, transparent 1.25px)',
          backgroundSize: '16px 16px',
        }}
      />
      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-8">{children}</div>
    </div>
  );
}
