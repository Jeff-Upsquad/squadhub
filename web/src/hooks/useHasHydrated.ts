'use client';

import { useSyncExternalStore } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { usePMStore } from '@/stores/pmStore';

export function useHasHydrated() {
  return useSyncExternalStore(
    (cb) => {
      const unsub1 = useAuthStore.persist.onFinishHydration(cb);
      const unsub2 = usePMStore.persist.onFinishHydration(cb);
      return () => {
        unsub1();
        unsub2();
      };
    },
    () => useAuthStore.persist.hasHydrated() && usePMStore.persist.hasHydrated(),
    () => false,
  );
}
