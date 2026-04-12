import { create } from 'zustand';

export type ViewMode = 'list' | 'board';

interface PMState {
  activeSpaceId: string | null;
  activeListId: string | null;
  activeTaskId: string | null;
  viewMode: ViewMode;
  collapsedGroups: Record<string, boolean>;
  selectedTasks: string[];
  setActiveSpace: (id: string | null) => void;
  setActiveList: (id: string | null) => void;
  setActiveTask: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleGroupCollapse: (statusId: string) => void;
  toggleTaskSelection: (taskId: string) => void;
  selectAllTasks: (taskIds: string[]) => void;
  clearSelection: () => void;
  reset: () => void;
}

export const usePMStore = create<PMState>((set) => ({
  activeSpaceId: null,
  activeListId: null,
  activeTaskId: null,
  viewMode: 'list',
  collapsedGroups: {},
  selectedTasks: [],

  setActiveSpace: (id) => set({ activeSpaceId: id }),
  setActiveList: (id) => set({ activeListId: id, selectedTasks: [] }),
  setActiveTask: (id) => set({ activeTaskId: id }),
  setViewMode: (mode) => set({ viewMode: mode }),
  toggleGroupCollapse: (statusId) =>
    set((state) => ({
      collapsedGroups: {
        ...state.collapsedGroups,
        [statusId]: !state.collapsedGroups[statusId],
      },
    })),
  toggleTaskSelection: (taskId) =>
    set((state) => ({
      selectedTasks: state.selectedTasks.includes(taskId)
        ? state.selectedTasks.filter((id) => id !== taskId)
        : [...state.selectedTasks, taskId],
    })),
  selectAllTasks: (taskIds) => set({ selectedTasks: taskIds }),
  clearSelection: () => set({ selectedTasks: [] }),
  reset: () => set({ activeSpaceId: null, activeListId: null, activeTaskId: null, viewMode: 'list', collapsedGroups: {}, selectedTasks: [] }),
}));
