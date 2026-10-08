import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { usePMStore } from './pmStore';
import { useWorkspaceStore } from './workspaceStore';

// When each app / list / folder / area / channel was last opened, so the home
// sidebar can split "Recent apps" and Favorites into opened-in-the-last-N-days
// vs. older ("More"). Per-device (localStorage) — a recency hint, not a record.
// Keys: `app:<slug>` for apps, the bare item id for everything else.
interface RecentOpensState {
  openedAt: Record<string, number>;
  markOpened: (key: string) => void;
}

const MAX_ENTRIES = 300;

export const useRecentOpensStore = create<RecentOpensState>()(
  persist(
    (set) => ({
      openedAt: {},
      markOpened: (key) =>
        set((s) => {
          const next = { ...s.openedAt, [key]: Date.now() };
          const keys = Object.keys(next);
          if (keys.length > MAX_ENTRIES) {
            keys
              .sort((a, b) => next[a] - next[b])
              .slice(0, keys.length - MAX_ENTRIES)
              .forEach((k) => delete next[k]);
          }
          return { openedAt: next };
        }),
    }),
    { name: 'squadhub-recent-opens' },
  ),
);

export const markAppOpened = (slug: string) => useRecentOpensStore.getState().markOpened(`app:${slug}`);

// Track PM containers and chats no matter where they were opened from (tree,
// favorites, tabs, deep links) — not just clicks in the sidebar.
if (typeof window !== 'undefined') {
  usePMStore.subscribe((s, prev) => {
    const mark = useRecentOpensStore.getState().markOpened;
    if (s.activeListId && s.activeListId !== prev.activeListId) mark(s.activeListId);
    if (s.activeFolderId && s.activeFolderId !== prev.activeFolderId) mark(s.activeFolderId);
    if (s.activeDesignFolderId && s.activeDesignFolderId !== prev.activeDesignFolderId) mark(s.activeDesignFolderId);
    if (s.activeSpacePageId && s.activeSpacePageId !== prev.activeSpacePageId) mark(s.activeSpacePageId);
  });
  useWorkspaceStore.subscribe((s, prev) => {
    if (s.activeChannelId && s.activeChannelId !== prev.activeChannelId) {
      useRecentOpensStore.getState().markOpened(s.activeChannelId);
    }
  });
}
