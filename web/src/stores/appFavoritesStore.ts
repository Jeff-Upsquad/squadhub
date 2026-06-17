import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// Personal pins for apps. Apps are identified by slug (not a UUID), so they
// live in their own client-persisted store rather than the server-backed
// `favorites` table used for channels/lists/folders/spaces. This makes the
// pin instant and offline-safe; it can be promoted to a synced table later.
interface AppFavoritesState {
  /** Pinned app slugs, newest last. */
  favorites: string[];
  toggle: (slug: string) => void;
  remove: (slug: string) => void;
}

export const useAppFavoritesStore = create<AppFavoritesState>()(
  persist(
    (set) => ({
      favorites: [],
      toggle: (slug) =>
        set((s) => ({
          favorites: s.favorites.includes(slug)
            ? s.favorites.filter((x) => x !== slug)
            : [...s.favorites, slug],
        })),
      remove: (slug) => set((s) => ({ favorites: s.favorites.filter((x) => x !== slug) })),
    }),
    {
      name: 'squadhub-app-favorites',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
