'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, useHasAuthHydrated } from '@/stores/authStore';

export default function Home() {
  const router = useRouter();
  const hasHydrated = useHasAuthHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!hasHydrated) return;
    if (isAuthenticated) {
      router.push('/admin');
    } else {
      router.push('/login');
    }
  }, [hasHydrated, isAuthenticated, router]);

  return null;
}
