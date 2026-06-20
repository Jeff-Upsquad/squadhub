import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  canonicalKey,
  buildHomeSnapshot,
  type TabSnapshot,
} from '../lib/tabSnapshots';

// ---- Chrome-style tab strip for the main content area ----
//
// A tab is a persisted, labeled `TabSnapshot`. The app's *live view*
// (MainLayout's section/homeView + pmStore/workspaceStore selections) stays the
// single source of truth for what's rendered; this store sits on top:
//   • The active tab always mirrors the live view (`onNavigate`).
//   • Navigating to a NEW destination replaces the active tab in place
//     (Chrome-like); navigating to one already open in another tab focuses it.
//   • Switching tabs restores that tab's snapshot into the live view (MainLayout
//     subscribes to `activeTabId` and re-applies the snapshot).
//
// This mirrors the existing `useNavHistory` snapshot/restore pattern, including
// the `navRestoringRef` guard MainLayout passes through as `isRestoring`.

export interface Tab {
  id: string;
  snapshot: TabSnapshot;
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

interface TabsState {
  /** Workspace these tabs belong to — switching workspaces resets the strip. */
  workspaceId: string | null;
  tabs: Tab[];
  activeTabId: string | null;

  /**
   * Called by MainLayout whenever the live view changes. Keeps the active tab in
   * sync; on a genuine navigation either focuses an existing tab for the same
   * destination or replaces the active tab's content in place.
   */
  onNavigate: (snapshot: TabSnapshot, key: string, isRestoring: boolean) => void;

  /** Open a destination in a new tab (⌘/middle-click, the + button). Dedupes. */
  openInNewTab: (snapshot: TabSnapshot, opts?: { background?: boolean }) => void;
  setActiveTab: (id: string) => void;
  closeTab: (id: string) => void;
  closeOthers: (id: string) => void;
  reorderTabs: (fromId: string, toId: string) => void;

  /** Ensure ≥1 tab exists (seed from the live view); record the workspace id. */
  ensureSeed: (seed: TabSnapshot, workspaceId: string | null) => void;
  /** Wipe to a single tab — used on a genuine workspace switch. */
  resetForWorkspace: (workspaceId: string, seed: TabSnapshot) => void;
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      workspaceId: null,
      tabs: [],
      activeTabId: null,

      onNavigate: (snapshot, key, isRestoring) =>
        set((state) => {
          const { tabs, activeTabId } = state;
          const active = tabs.find((t) => t.id === activeTabId) ?? null;

          // No tab yet (very first navigation, before the seed effect runs).
          if (!active) {
            const id = newId();
            return { tabs: [{ id, snapshot }], activeTabId: id };
          }

          // During a restore (tab switch / nav-history) just refresh the active
          // tab's snapshot — never create or focus, exactly like useNavHistory.
          if (isRestoring) {
            return { tabs: tabs.map((t) => (t.id === activeTabId ? { ...t, snapshot } : t)) };
          }

          // Same destination, only background fields changed → refresh.
          if (canonicalKey(active.snapshot) === key) {
            return { tabs: tabs.map((t) => (t.id === activeTabId ? { ...t, snapshot } : t)) };
          }

          // Navigated somewhere already open in another tab → focus it.
          const existing = tabs.find((t) => t.id !== activeTabId && canonicalKey(t.snapshot) === key);
          if (existing) {
            return {
              activeTabId: existing.id,
              tabs: tabs.map((t) => (t.id === existing.id ? { ...t, snapshot } : t)),
            };
          }

          // Otherwise replace the active tab's content in place (Chrome-like).
          return { tabs: tabs.map((t) => (t.id === activeTabId ? { ...t, snapshot } : t)) };
        }),

      openInNewTab: (snapshot, opts) =>
        set((state) => {
          const key = canonicalKey(snapshot);
          const existing = state.tabs.find((t) => canonicalKey(t.snapshot) === key);
          if (existing) {
            // No duplicates — focus the existing tab (unless opened in background).
            return opts?.background ? {} : { activeTabId: existing.id };
          }
          const id = newId();
          const idx = state.tabs.findIndex((t) => t.id === state.activeTabId);
          const tabs = [...state.tabs];
          tabs.splice(idx >= 0 ? idx + 1 : tabs.length, 0, { id, snapshot });
          return opts?.background ? { tabs } : { tabs, activeTabId: id };
        }),

      setActiveTab: (id) => set((state) => (state.activeTabId === id ? {} : { activeTabId: id })),

      closeTab: (id) =>
        set((state) => {
          const idx = state.tabs.findIndex((t) => t.id === id);
          if (idx === -1) return {};
          const tabs = state.tabs.filter((t) => t.id !== id);
          if (tabs.length === 0) {
            // Never drop below one tab — seed a fresh Home tab.
            const seed: Tab = { id: newId(), snapshot: buildHomeSnapshot('hub') };
            return { tabs: [seed], activeTabId: seed.id };
          }
          let activeTabId = state.activeTabId;
          if (state.activeTabId === id) {
            // Activate the right neighbor, else the left.
            const neighbor = state.tabs[idx + 1] ?? state.tabs[idx - 1];
            activeTabId = neighbor?.id ?? tabs[0].id;
          }
          return { tabs, activeTabId };
        }),

      closeOthers: (id) =>
        set((state) => {
          const keep = state.tabs.find((t) => t.id === id);
          if (!keep) return {};
          return { tabs: [keep], activeTabId: keep.id };
        }),

      reorderTabs: (fromId, toId) =>
        set((state) => {
          if (fromId === toId) return {};
          const from = state.tabs.findIndex((t) => t.id === fromId);
          const to = state.tabs.findIndex((t) => t.id === toId);
          if (from === -1 || to === -1) return {};
          const tabs = [...state.tabs];
          const [moved] = tabs.splice(from, 1);
          tabs.splice(to, 0, moved);
          return { tabs };
        }),

      ensureSeed: (seed, workspaceId) =>
        set((state) => {
          const patch: Partial<TabsState> = {};
          if (state.workspaceId == null && workspaceId) patch.workspaceId = workspaceId;
          if (state.tabs.length === 0) {
            const id = newId();
            patch.tabs = [{ id, snapshot: seed }];
            patch.activeTabId = id;
          }
          return patch;
        }),

      resetForWorkspace: (workspaceId, seed) => {
        const id = newId();
        set({ workspaceId, tabs: [{ id, snapshot: seed }], activeTabId: id });
      },
    }),
    {
      name: 'squadhub-tabs',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        workspaceId: state.workspaceId,
        tabs: state.tabs,
        activeTabId: state.activeTabId,
      }),
      version: 1,
    },
  ),
);
