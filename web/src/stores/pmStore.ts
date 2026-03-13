import { create } from 'zustand';

export type ViewMode = 'list' | 'board';

interface PMState {
  activeSpaceId: string | null;
  activeListId: string | null;
  activeTaskId: string | null;
  viewMode: ViewMode;
  setActiveSpace: (id: string | null) => void;
  setActiveList: (id: string | null) => void;
  setActiveTask: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  reset: () => void;
}

export const usePMStore = create<PMState>((set) => ({
  activeSpaceId: null,
  activeListId: null,
  activeTaskId: null,
  viewMode: 'list',

  setActiveSpace: (id) => set({ activeSpaceId: id }),
  setActiveList: (id) => set({ activeListId: id }),
  setActiveTask: (id) => set({ activeTaskId: id }),
  setViewMode: (mode) => set({ viewMode: mode }),
  reset: () => set({ activeSpaceId: null, activeListId: null, activeTaskId: null, viewMode: 'list' }),
}));
