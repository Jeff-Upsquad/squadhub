'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useHasHydrated } from '@/hooks/useHasHydrated';
import MainLayout from '@/layouts/MainLayout';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const hydrated = useHasHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!hydrated) return;
    if (!isAuthenticated) {
      const destination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      router.replace(`/login?redirect=${encodeURIComponent(destination)}`);
    }
  }, [hydrated, isAuthenticated, router]);

  if (!hydrated || !isAuthenticated) {
    return null;
  }

  return <MainLayout />;
}
