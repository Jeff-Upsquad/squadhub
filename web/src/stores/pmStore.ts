import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ViewMode = 'list' | 'board';
export type DashboardTab = 'today' | 'overdue' | 'tomorrow' | 'all';

interface TimerState {
  taskId: string;
  taskTitle: string;
  listId: string;
  startedAt: number;
  baseTracked: number;
}

interface PMState {
  activeSpaceId: string | null;
  activeListId: string | null;
  activeFolderId: string | null;
  activeTaskId: string | null;
  activeDesignFolderId: string | null;
  activeClientId: string | null;
  activeDashboardTab: DashboardTab | null;
  viewMode: ViewMode;
  collapsedGroups: Record<string, boolean>;
  selectedTasks: string[];
  timer: TimerState | null;
  setActiveSpace: (id: string | null) => void;
  setActiveList: (id: string | null) => void;
  setActiveFolder: (id: string | null) => void;
  setActiveTask: (id: string | null) => void;
  setActiveDesignFolder: (id: string | null) => void;
  setActiveClient: (id: string | null) => void;
  setActiveDashboardTab: (tab: DashboardTab | null) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleGroupCollapse: (statusId: string) => void;
  toggleTaskSelection: (taskId: string) => void;
  selectAllTasks: (taskIds: string[]) => void;
  clearSelection: () => void;
  startTimer: (taskId: string, taskTitle: string, listId: string, baseTracked: number) => TimerState | null;
  stopTimer: () => TimerState | null;
  reset: () => void;
}

export const usePMStore = create<PMState>()(
  persist(
    (set, get) => ({
      activeSpaceId: null,
      activeListId: null,
      activeFolderId: null,
      activeTaskId: null,
      activeDesignFolderId: null,
      activeClientId: null,
      activeDashboardTab: null,
      viewMode: 'list',
      collapsedGroups: {},
      selectedTasks: [],
      timer: null,

      setActiveSpace: (id) => set({ activeSpaceId: id }),
      setActiveList: (id) => set({ activeListId: id, selectedTasks: [], activeDesignFolderId: null, activeFolderId: null }),
      setActiveFolder: (id) => set({ activeFolderId: id, activeListId: null, activeDesignFolderId: null, selectedTasks: [] }),
      setActiveTask: (id) => set({ activeTaskId: id }),
      setActiveDesignFolder: (id) => set({ activeDesignFolderId: id, activeListId: null, activeFolderId: null, selectedTasks: [] }),
      setActiveClient: (id) => set({ activeClientId: id }),
      setActiveDashboardTab: (tab) => set({ activeDashboardTab: tab }),
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
      startTimer: (taskId, taskTitle, listId, baseTracked) => {
        const prev = get().timer;
        set({
          timer: { taskId, taskTitle, listId, startedAt: Date.now(), baseTracked },
        });
        return prev;
      },
      stopTimer: () => {
        const prev = get().timer;
        set({ timer: null });
        return prev;
      },
      reset: () => set({ activeSpaceId: null, activeListId: null, activeFolderId: null, activeTaskId: null, activeDesignFolderId: null, activeClientId: null, activeDashboardTab: null, viewMode: 'list', collapsedGroups: {}, selectedTasks: [], timer: null }),
    }),
    {
      name: 'squadhub-pm',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ timer: state.timer }),
      version: 1,
    }
  )
);
