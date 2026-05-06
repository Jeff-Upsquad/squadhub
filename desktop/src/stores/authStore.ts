import { create } from 'zustand';
import { load, type Store } from '@tauri-apps/plugin-store';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  userEmail: string | null;
  displayName: string | null;
  userId: string | null;
  isAuthenticated: boolean;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setAuth: (data: {
    accessToken: string;
    refreshToken: string;
    userEmail: string;
    displayName: string;
    userId: string;
  }) => Promise<void>;
  updateTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await load('auth.json');
  }
  return store;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  userEmail: null,
  displayName: null,
  userId: null,
  isAuthenticated: false,
  hydrated: false,

  hydrate: async () => {
    try {
      const s = await getStore();
      const accessToken = await s.get<string>('accessToken');
      const refreshToken = await s.get<string>('refreshToken');
      const userEmail = await s.get<string>('userEmail');
      const displayName = await s.get<string>('displayName');
      const userId = await s.get<string>('userId');

      if (accessToken && refreshToken) {
        set({
          accessToken,
          refreshToken,
          userEmail: userEmail ?? null,
          displayName: displayName ?? null,
          userId: userId ?? null,
          isAuthenticated: true,
          hydrated: true,
        });
      } else {
        set({ hydrated: true });
      }
    } catch {
      set({ hydrated: true });
    }
  },

  setAuth: async (data) => {
    const s = await getStore();
    await s.set('accessToken', data.accessToken);
    await s.set('refreshToken', data.refreshToken);
    await s.set('userEmail', data.userEmail);
    await s.set('displayName', data.displayName);
    await s.set('userId', data.userId);

    set({
      ...data,
      isAuthenticated: true,
    });
  },

  updateTokens: async (accessToken, refreshToken) => {
    const s = await getStore();
    await s.set('accessToken', accessToken);
    await s.set('refreshToken', refreshToken);
    set({ accessToken, refreshToken });
  },

  logout: async () => {
    const s = await getStore();
    await s.clear();
    set({
      accessToken: null,
      refreshToken: null,
      userEmail: null,
      displayName: null,
      userId: null,
      isAuthenticated: false,
    });
  },
}));
