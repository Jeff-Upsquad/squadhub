'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    // Redirect authenticated users away from auth pages
    if (isAuthenticated) {
      router.push('/app');
    }
  }, [isAuthenticated, router]);

  return <>{children}</>;
}
