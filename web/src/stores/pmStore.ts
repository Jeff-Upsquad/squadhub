import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GroupBy } from '../lib/taskGrouping';
import type { TaskFilterState } from '../lib/filters';
import { isFilterEmpty } from '../lib/filters';

export type ViewMode = 'list' | 'board';
export type DashboardTab = 'today' | 'overdue' | 'tomorrow' | 'all';
export type ListGroupBy = Extract<GroupBy, 'status' | 'none' | 'work_date' | 'due_date' | 'priority'>;

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
  activeSpacePageId: string | null;
  activeTaskId: string | null;
  activeDesignFolderId: string | null;
  activeClientId: string | null;
  activeDashboardTab: DashboardTab | null;
  contextListId: string | null;
  viewMode: ViewMode;
  listGroupBy: ListGroupBy;
  myTasksOnly: boolean;
  collapsedGroups: Record<string, boolean>;
  selectedTasks: string[];
  timer: TimerState | null;
  filtersByScope: Record<string, TaskFilterState>;
  focusedTodayIds: string[];
  focusedTodayDate: string;
  setActiveSpace: (id: string | null) => void;
  setActiveList: (id: string | null) => void;
  setActiveFolder: (id: string | null) => void;
  setActiveSpacePage: (id: string | null) => void;
  setActiveTask: (id: string | null) => void;
  setActiveDesignFolder: (id: string | null) => void;
  setContextListId: (id: string | null) => void;
  setActiveClient: (id: string | null) => void;
  setActiveDashboardTab: (tab: DashboardTab | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setListGroupBy: (g: ListGroupBy) => void;
  setMyTasksOnly: (v: boolean) => void;
  toggleGroupCollapse: (statusId: string) => void;
  toggleTaskSelection: (taskId: string) => void;
  selectAllTasks: (taskIds: string[]) => void;
  clearSelection: () => void;
  startTimer: (taskId: string, taskTitle: string, listId: string, baseTracked: number) => TimerState | null;
  stopTimer: () => TimerState | null;
  setScopeFilters: (scopeKey: string, next: TaskFilterState) => void;
  clearScopeFilters: (scopeKey: string) => void;
  toggleFocusToday: (taskId: string) => void;
  isFocusedToday: (taskId: string) => boolean;
  resetFocusTodayIfStale: () => void;
  reset: () => void;
}

const todayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const usePMStore = create<PMState>()(
  persist(
    (set, get) => ({
      activeSpaceId: null,
      activeListId: null,
      activeFolderId: null,
      activeSpacePageId: null,
      activeTaskId: null,
      activeDesignFolderId: null,
      activeClientId: null,
      activeDashboardTab: null,
      contextListId: null,
      viewMode: 'list',
      listGroupBy: 'status',
      myTasksOnly: false,
      collapsedGroups: {},
      selectedTasks: [],
      timer: null,
      filtersByScope: {},
      focusedTodayIds: [],
      focusedTodayDate: todayKey(),

      setActiveSpace: (id) => set({ activeSpaceId: id }),
      setActiveList: (id) => set({ activeListId: id, contextListId: id, selectedTasks: [], activeDesignFolderId: null, activeFolderId: null, activeSpacePageId: null }),
      setActiveFolder: (id) => set({ activeFolderId: id, activeListId: null, activeDesignFolderId: null, activeSpacePageId: null, contextListId: null, selectedTasks: [] }),
      setActiveSpacePage: (id) => set({ activeSpacePageId: id, activeListId: null, activeFolderId: null, activeDesignFolderId: null, contextListId: null, selectedTasks: [] }),
      setActiveTask: (id) => set({ activeTaskId: id }),
      setActiveDesignFolder: (id) => set({ activeDesignFolderId: id, activeListId: null, activeFolderId: null, activeSpacePageId: null, contextListId: null, selectedTasks: [] }),
      setContextListId: (id) => set({ contextListId: id }),
      setActiveClient: (id) => set({ activeClientId: id }),
      setActiveDashboardTab: (tab) => set({ activeDashboardTab: tab }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setListGroupBy: (g) => set({ listGroupBy: g }),
      setMyTasksOnly: (v) => set({ myTasksOnly: v }),
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
      setScopeFilters: (scopeKey, next) =>
        set((state) => {
          if (isFilterEmpty(next)) {
            if (!(scopeKey in state.filtersByScope)) return state;
            const { [scopeKey]: _removed, ...rest } = state.filtersByScope;
            return { filtersByScope: rest };
          }
          return { filtersByScope: { ...state.filtersByScope, [scopeKey]: next } };
        }),
      clearScopeFilters: (scopeKey) =>
        set((state) => {
          if (!(scopeKey in state.filtersByScope)) return state;
          const { [scopeKey]: _removed, ...rest } = state.filtersByScope;
          return { filtersByScope: rest };
        }),
      resetFocusTodayIfStale: () => {
        const today = todayKey();
        const state = get();
        if (state.focusedTodayDate !== today) {
          set({ focusedTodayIds: [], focusedTodayDate: today });
        }
      },
      toggleFocusToday: (taskId) => {
        const today = todayKey();
        set((state) => {
          const sameDay = state.focusedTodayDate === today;
          const current = sameDay ? state.focusedTodayIds : [];
          const next = current.includes(taskId)
            ? current.filter((id) => id !== taskId)
            : [...current, taskId];
          return { focusedTodayIds: next, focusedTodayDate: today };
        });
      },
      isFocusedToday: (taskId) => {
        const state = get();
        if (state.focusedTodayDate !== todayKey()) return false;
        return state.focusedTodayIds.includes(taskId);
      },
      reset: () => set({ activeSpaceId: null, activeListId: null, activeFolderId: null, activeSpacePageId: null, activeTaskId: null, activeDesignFolderId: null, activeClientId: null, activeDashboardTab: null, contextListId: null, viewMode: 'list', listGroupBy: 'status', myTasksOnly: false, collapsedGroups: {}, selectedTasks: [], timer: null, filtersByScope: {}, focusedTodayIds: [], focusedTodayDate: todayKey() }),
    }),
    {
      name: 'squadhub-pm',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        timer: state.timer,
        listGroupBy: state.listGroupBy,
        myTasksOnly: state.myTasksOnly,
        filtersByScope: state.filtersByScope,
        focusedTodayIds: state.focusedTodayIds,
        focusedTodayDate: state.focusedTodayDate,
      }),
      version: 2,
      migrate: (persisted: unknown, fromVersion: number) => {
        const p = (persisted ?? {}) as Partial<PMState>;
        if (fromVersion < 2) {
          return { ...p, filtersByScope: {} };
        }
        return p;
      },
    }
  )
);
