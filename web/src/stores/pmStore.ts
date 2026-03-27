import { create } from 'zustand';

export type ViewMode = 'list' | 'board';

interface PMState {
  activeSpaceId: string | null;
  activeListId: string | null;
  activeTaskId: string | null;
  viewMode: ViewMode;
  collapsedGroups: Record<string, boolean>;
  setActiveSpace: (id: string | null) => void;
  setActiveList: (id: string | null) => void;
  setActiveTask: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleGroupCollapse: (statusId: string) => void;
  reset: () => void;
}

export const usePMStore = create<PMState>((set) => ({
  activeSpaceId: null,
  activeListId: null,
  activeTaskId: null,
  viewMode: 'list',
  collapsedGroups: {},

  setActiveSpace: (id) => set({ activeSpaceId: id }),
  setActiveList: (id) => set({ activeListId: id }),
  setActiveTask: (id) => set({ activeTaskId: id }),
  setViewMode: (mode) => set({ viewMode: mode }),
  toggleGroupCollapse: (statusId) =>
    set((state) => ({
      collapsedGroups: {
        ...state.collapsedGroups,
        [statusId]: !state.collapsedGroups[statusId],
      },
    })),
  reset: () => set({ activeSpaceId: null, activeListId: null, activeTaskId: null, viewMode: 'list', collapsedGroups: {} }),
}));
