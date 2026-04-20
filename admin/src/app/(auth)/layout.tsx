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

  return <>{children}</>;
}
