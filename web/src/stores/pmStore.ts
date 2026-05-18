import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GroupBy, SortBy } from '../lib/taskGrouping';
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
  // Map of task IDs currently animating out → their pre-fade raw status string.
  // The snapshot lets grouping functions (groupTasksByStatus, groupByStatus) keep
  // the row in its original status bucket while the CSS slide plays, instead of
  // re-bucketing it the same render tick the optimistic status patch lands.
  fadingTaskIds: Map<string, string>;
  timer: TimerState | null;
  filtersByScope: Record<string, TaskFilterState>;
  focusedTodayIds: string[];
  focusedTodayDate: string;
  groupByScope: Record<string, GroupBy>;
  sortByScope: Record<string, SortBy>;
  focusTodayScope: Record<string, boolean>;
  todayListGroupBy: GroupBy;
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
  markFading: (taskId: string, prevStatus: string) => void;
  unmarkFading: (taskId: string) => void;
  startTimer: (taskId: string, taskTitle: string, listId: string, baseTracked: number) => TimerState | null;
  stopTimer: () => TimerState | null;
  setScopeFilters: (scopeKey: string, next: TaskFilterState) => void;
  clearScopeFilters: (scopeKey: string) => void;
  setScopedGroupBy: (scopeKey: string, value: GroupBy) => void;
  setScopedSortBy: (scopeKey: string, value: SortBy) => void;
  setScopedFocusToday: (scopeKey: string, value: boolean) => void;
  setTodayListGroupBy: (value: GroupBy) => void;
  toggleFocusToday: (taskId: string) => void;
  isFocusedToday: (taskId: string) => boolean;
  resetFocusTodayIfStale: () => void;
  _hydrateFromServer: (prefs: Record<string, unknown>) => void;
  _getServerPayload: () => Record<string, unknown>;
  reset: () => void;
}

const todayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let _debouncedSave: (() => void) | null = null;
export function _setDebouncedSave(fn: () => void) {
  _debouncedSave = fn;
}
function triggerSave() {
  _debouncedSave?.();
}

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
      fadingTaskIds: new Map<string, string>(),
      timer: null,
      filtersByScope: {},
      focusedTodayIds: [],
      focusedTodayDate: todayKey(),
      groupByScope: {},
      sortByScope: {},
      focusTodayScope: {},
      todayListGroupBy: 'none',

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
      setListGroupBy: (g) => { set({ listGroupBy: g }); triggerSave(); },
      setMyTasksOnly: (v) => { set({ myTasksOnly: v }); triggerSave(); },
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
      markFading: (taskId, prevStatus) =>
        set((state) => {
          // Existing-key short-circuit: re-clicks (e.g. user toggles done off
          // and on again before the first animation finishes) must NOT overwrite
          // the pre-fade snapshot — keep the first remembered status so the row
          // stays in its original bucket through the whole animation.
          if (state.fadingTaskIds.has(taskId)) return state;
          const next = new Map(state.fadingTaskIds);
          next.set(taskId, prevStatus);
          return { fadingTaskIds: next };
        }),
      unmarkFading: (taskId) =>
        set((state) => {
          if (!state.fadingTaskIds.has(taskId)) return state;
          const next = new Map(state.fadingTaskIds);
          next.delete(taskId);
          return { fadingTaskIds: next };
        }),
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
      setScopeFilters: (scopeKey, next) => {
        set((state) => {
          if (isFilterEmpty(next)) {
            if (!(scopeKey in state.filtersByScope)) return state;
            const { [scopeKey]: _removed, ...rest } = state.filtersByScope;
            return { filtersByScope: rest };
          }
          return { filtersByScope: { ...state.filtersByScope, [scopeKey]: next } };
        });
        triggerSave();
      },
      clearScopeFilters: (scopeKey) => {
        set((state) => {
          if (!(scopeKey in state.filtersByScope)) return state;
          const { [scopeKey]: _removed, ...rest } = state.filtersByScope;
          return { filtersByScope: rest };
        });
        triggerSave();
      },
      setScopedGroupBy: (scopeKey, value) => {
        set((state) => ({
          groupByScope: { ...state.groupByScope, [scopeKey]: value },
        }));
        triggerSave();
      },
      setScopedSortBy: (scopeKey, value) => {
        set((state) => ({
          sortByScope: { ...state.sortByScope, [scopeKey]: value },
        }));
        triggerSave();
      },
      setScopedFocusToday: (scopeKey, value) => {
        set((state) => ({
          focusTodayScope: { ...state.focusTodayScope, [scopeKey]: value },
        }));
        triggerSave();
      },
      setTodayListGroupBy: (value) => {
        set({ todayListGroupBy: value });
        triggerSave();
      },
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
        triggerSave();
      },
      isFocusedToday: (taskId) => {
        const state = get();
        if (state.focusedTodayDate !== todayKey()) return false;
        return state.focusedTodayIds.includes(taskId);
      },
      _hydrateFromServer: (prefs) => {
        const patch: Partial<PMState> = {};
        if (prefs.listGroupBy !== undefined) patch.listGroupBy = prefs.listGroupBy as ListGroupBy;
        if (prefs.myTasksOnly !== undefined) patch.myTasksOnly = prefs.myTasksOnly as boolean;
        if (prefs.filtersByScope !== undefined) patch.filtersByScope = prefs.filtersByScope as Record<string, TaskFilterState>;
        if (prefs.groupByScope !== undefined) patch.groupByScope = prefs.groupByScope as Record<string, GroupBy>;
        if (prefs.sortByScope !== undefined) patch.sortByScope = prefs.sortByScope as Record<string, SortBy>;
        if (prefs.focusTodayScope !== undefined) patch.focusTodayScope = prefs.focusTodayScope as Record<string, boolean>;
        if (prefs.todayListGroupBy !== undefined) patch.todayListGroupBy = prefs.todayListGroupBy as GroupBy;
        // Stars only carry over if the server's date matches today locally —
        // otherwise they're stale and we let the existing reset behavior win.
        if (Array.isArray(prefs.focusedTodayIds) && typeof prefs.focusedTodayDate === 'string') {
          if (prefs.focusedTodayDate === todayKey()) {
            patch.focusedTodayIds = prefs.focusedTodayIds as string[];
            patch.focusedTodayDate = prefs.focusedTodayDate as string;
          }
        }
        if (Object.keys(patch).length > 0) set(patch);
      },
      _getServerPayload: () => {
        const s = get();
        return {
          listGroupBy: s.listGroupBy,
          myTasksOnly: s.myTasksOnly,
          filtersByScope: s.filtersByScope,
          groupByScope: s.groupByScope,
          sortByScope: s.sortByScope,
          focusTodayScope: s.focusTodayScope,
          todayListGroupBy: s.todayListGroupBy,
          focusedTodayIds: s.focusedTodayIds,
          focusedTodayDate: s.focusedTodayDate,
        };
      },
      reset: () => set({ activeSpaceId: null, activeListId: null, activeFolderId: null, activeSpacePageId: null, activeTaskId: null, activeDesignFolderId: null, activeClientId: null, activeDashboardTab: null, contextListId: null, viewMode: 'list', listGroupBy: 'status', myTasksOnly: false, collapsedGroups: {}, selectedTasks: [], fadingTaskIds: new Map<string, string>(), timer: null, filtersByScope: {}, focusedTodayIds: [], focusedTodayDate: todayKey(), groupByScope: {}, sortByScope: {}, focusTodayScope: {}, todayListGroupBy: 'none' }),
    }),
    {
      name: 'squadhub-pm',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeSpaceId: state.activeSpaceId,
        activeListId: state.activeListId,
        activeFolderId: state.activeFolderId,
        activeSpacePageId: state.activeSpacePageId,
        activeDesignFolderId: state.activeDesignFolderId,
        activeClientId: state.activeClientId,
        contextListId: state.contextListId,
        timer: state.timer,
        listGroupBy: state.listGroupBy,
        myTasksOnly: state.myTasksOnly,
        filtersByScope: state.filtersByScope,
        focusedTodayIds: state.focusedTodayIds,
        focusedTodayDate: state.focusedTodayDate,
        groupByScope: state.groupByScope,
        sortByScope: state.sortByScope,
        focusTodayScope: state.focusTodayScope,
        todayListGroupBy: state.todayListGroupBy,
      }),
      version: 3,
      migrate: (persisted: unknown, fromVersion: number) => {
        const p = (persisted ?? {}) as Partial<PMState>;
        if (fromVersion < 2) {
          return { ...p, filtersByScope: {}, groupByScope: {}, sortByScope: {}, focusTodayScope: {}, todayListGroupBy: 'none' };
        }
        if (fromVersion < 3) {
          return { ...p, groupByScope: {}, sortByScope: {}, focusTodayScope: {}, todayListGroupBy: 'none' };
        }
        return p;
      },
    }
  )
);
