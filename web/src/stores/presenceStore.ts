import { create } from 'zustand';

// Live presence fed by the socket: seeded with `online_users` on connect,
// then kept current via `user_online` / `user_offline` deltas.
interface PresenceState {
  onlineUserIds: Set<string>;
  seed: (ids: string[]) => void;
  setOnline: (id: string) => void;
  setOffline: (id: string) => void;
  clear: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  onlineUserIds: new Set(),
  seed: (ids) => set({ onlineUserIds: new Set(ids) }),
  setOnline: (id) =>
    set((s) => {
      if (s.onlineUserIds.has(id)) return s;
      const next = new Set(s.onlineUserIds);
      next.add(id);
      return { onlineUserIds: next };
    }),
  setOffline: (id) =>
    set((s) => {
      if (!s.onlineUserIds.has(id)) return s;
      const next = new Set(s.onlineUserIds);
      next.delete(id);
      return { onlineUserIds: next };
    }),
  clear: () => set({ onlineUserIds: new Set() }),
}));

export function useIsOnline(userId?: string | null): boolean {
  return usePresenceStore((s) => (userId ? s.onlineUserIds.has(userId) : false));
}
