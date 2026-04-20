import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@squadhub/shared';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true }),

      logout: () =>
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false }),
    }),
    {
      name: 'squadhub-admin-auth', // separate localStorage key from main app
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);

// Returns true once the persisted auth has been loaded from localStorage.
// Use this to gate route guards so a refresh doesn't flash through the
// "not authenticated" state and kick the user back to the dashboard.
export function useHasAuthHydrated(): boolean {
  // Start false so SSR / first client render agree. useAuthStore.persist is
  // undefined on the server, so we must only touch it inside useEffect.
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(useAuthStore.persist.hasHydrated());
    const unsubFinish = useAuthStore.persist.onFinishHydration(() => setHasHydrated(true));
    return () => { unsubFinish(); };
  }, []);

  return hasHydrated;
}
