'use client';

import { useSyncExternalStore } from 'react';
import { useAuthStore } from '@/stores/authStore';

export function useHasHydrated() {
  return useSyncExternalStore(
    (cb) => {
      const unsub = useAuthStore.persist.onFinishHydration(cb);
      return () => unsub();
    },
    () => useAuthStore.persist.hasHydrated(),
    () => false,
  );
}
