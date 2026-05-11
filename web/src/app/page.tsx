'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useHasHydrated } from '@/hooks/useHasHydrated';

export default function Home() {
  const router = useRouter();
  const hydrated = useHasHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!hydrated) return;
    if (isAuthenticated) {
      router.push('/app');
    } else {
      router.push('/login');
    }
  }, [hydrated, isAuthenticated, router]);

  return null;
}
