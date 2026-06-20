import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GroupBy, SortBy } from '../lib/taskGrouping';
import type { TaskFilterState } from '../lib/filters';
import { isFilterEmpty } from '../lib/filters';

export type ViewMode = 'list' | 'board' | 'whiteboard';
export type DashboardTab = 'today' | 'overdue' | 'tomorrow' | 'all';
export type ListGroupBy = Extract<GroupBy, 'status' | 'none' | 'work_date' | 'due_date' | 'priority'>;
export type TodayListView = 'list' | 'calendar';
// Calendar app view mode + which weekday the Week/Month grids start on (0=Sun…6=Sat).
// Synced cross-device via the view-preferences payload.
export type CalendarMode = 'month' | 'week' | '5day' | '4day' | 'day';
// Manual "later today" triage buckets for the Home Focus list. A starred task
// can be moved into Evening (after 3 PM) or Night (after 7 PM); these are labels
// only — no clock-driven behavior. Mirrors the focusedTodayIds persistence.
export type FocusBucket = 'evening' | 'night';

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
  activeDashboardTab: DashboardTab | null;
  // The full-page "New Tasks" review popup (My Home). Separate from
  // activeDashboardTab — that drives the right-sliding bucket panel; this is a
  // distinct full-screen overlay. Not persisted (a modal shouldn't reopen on reload).
  newTasksOpen: boolean;
  // True while a list/board view is showing its own floating "New task" button.
  // The global top-bar "+" create button hides itself when this is set, so the
  // two create affordances don't both show at once. Transient (not persisted) —
  // set by ListPage on mount/unmount, mirrors newTasksOpen.
  newTaskFabVisible: boolean;
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
  // Secondary task displayed in a side-peek next to the main detail panel.
  // Used when the user clicks a task reference inside another task's panel
  // (e.g. from the work-block "Activity during this run" section) and wants
  // to view it without losing the host panel's context.
  peekTaskId: string | null;
  timer: TimerState | null;
  filtersByScope: Record<string, TaskFilterState>;
  focusedTodayIds: string[];
  focusedTodayDate: string;
  focusBuckets: Record<string, FocusBucket>;
  groupByScope: Record<string, GroupBy>;
  sortByScope: Record<string, SortBy>;
  focusTodayScope: Record<string, boolean>;
  todayListGroupBy: GroupBy;
  todayListView: TodayListView;
  calendarMode: CalendarMode;
  calendarWeekStart: number;
  // Last in-app view (MainLayout's section + home sub-view), persisted so a
  // full-page refresh restores where the user was instead of resetting to My
  // Home. Stored as plain strings to avoid a store→layout import cycle;
  // MainLayout casts on read and its render switch falls back to My Home for
  // any unknown value.
  lastActiveSection: string;
  lastHomeView: string;
  setActiveSpace: (id: string | null) => void;
  setActiveList: (id: string | null) => void;
  setActiveFolder: (id: string | null) => void;
  setActiveSpacePage: (id: string | null) => void;
  setActiveTask: (id: string | null) => void;
  setPeekTask: (id: string | null) => void;
  setActiveDesignFolder: (id: string | null) => void;
  setContextListId: (id: string | null) => void;
  setActiveDashboardTab: (tab: DashboardTab | null) => void;
  setNewTasksOpen: (open: boolean) => void;
  setNewTaskFabVisible: (visible: boolean) => void;
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
  setTodayListView: (value: TodayListView) => void;
  setCalendarMode: (value: CalendarMode) => void;
  setCalendarWeekStart: (value: number) => void;
  setLastView: (section: string, homeView: string) => void;
  toggleFocusToday: (taskId: string) => void;
  setFocusBucket: (taskId: string, bucket: FocusBucket | null) => void;
  isFocusedToday: (taskId: string) => boolean;
  resetFocusTodayIfStale: () => void;
  _hydrateFromServer: (prefs: Record<string, unknown>) => void;
  _getServerPayload: () => Record<string, unknown>;
  reset: () => void;
}

export const todayKey = (): string => {
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
      activeDashboardTab: null,
      newTasksOpen: false,
      newTaskFabVisible: false,
      contextListId: null,
      viewMode: 'list',
      listGroupBy: 'status',
      myTasksOnly: false,
      collapsedGroups: {},
      selectedTasks: [],
      fadingTaskIds: new Map<string, string>(),
      peekTaskId: null,
      timer: null,
      filtersByScope: {},
      focusedTodayIds: [],
      focusedTodayDate: todayKey(),
      focusBuckets: {},
      groupByScope: {},
      sortByScope: {},
      focusTodayScope: {},
      todayListGroupBy: 'none',
      todayListView: 'list',
      calendarMode: 'month',
      calendarWeekStart: 0,
      lastActiveSection: 'home',
      lastHomeView: 'hub',

      setActiveSpace: (id) => set({ activeSpaceId: id }),
      setActiveList: (id) => set({ activeListId: id, contextListId: id, selectedTasks: [], activeDesignFolderId: null, activeFolderId: null, activeSpacePageId: null }),
      setActiveFolder: (id) => set({ activeFolderId: id, activeListId: null, activeDesignFolderId: null, activeSpacePageId: null, contextListId: null, selectedTasks: [] }),
      setActiveSpacePage: (id) => set({ activeSpacePageId: id, activeListId: null, activeFolderId: null, activeDesignFolderId: null, contextListId: null, selectedTasks: [] }),
      // Opening the main task clears any open peek so the user doesn't lose
      // track of which is which.
      setActiveTask: (id) => set({ activeTaskId: id, peekTaskId: null }),
      setPeekTask: (id) => set({ peekTaskId: id }),
      setActiveDesignFolder: (id) => set({ activeDesignFolderId: id, activeListId: null, activeFolderId: null, activeSpacePageId: null, contextListId: null, selectedTasks: [] }),
      setContextListId: (id) => set({ contextListId: id }),
      setActiveDashboardTab: (tab) => set({ activeDashboardTab: tab }),
      setNewTasksOpen: (open) => set({ newTasksOpen: open }),
      setNewTaskFabVisible: (visible) => set({ newTaskFabVisible: visible }),
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
      setTodayListView: (value) => {
        set({ todayListView: value });
        triggerSave();
      },
      setCalendarMode: (value) => {
        set({ calendarMode: value });
        triggerSave();
      },
      setCalendarWeekStart: (value) => {
        set({ calendarWeekStart: value });
        triggerSave();
      },
      setLastView: (section, homeView) => set({ lastActiveSection: section, lastHomeView: homeView }),
      // Focus stars are persistent now — they no longer clear overnight. Kept
      // as a no-op so existing callers (e.g. useDayPlanner) stay valid.
      resetFocusTodayIfStale: () => {},
      toggleFocusToday: (taskId) => {
        set((state) => {
          const removing = state.focusedTodayIds.includes(taskId);
          const next = removing
            ? state.focusedTodayIds.filter((id) => id !== taskId)
            : [...state.focusedTodayIds, taskId];
          // Unstarring a task drops it from the Focus list entirely, so clear
          // any Evening/Night bucket it had — otherwise a stale entry lingers.
          let focusBuckets = state.focusBuckets;
          if (removing && focusBuckets[taskId]) {
            const fb = { ...focusBuckets };
            delete fb[taskId];
            focusBuckets = fb;
          }
          // focusedTodayDate is no longer used for gating; keep it as a
          // "last changed" marker on the persisted payload.
          return { focusedTodayIds: next, focusedTodayDate: todayKey(), focusBuckets };
        });
        triggerSave();
      },
      setFocusBucket: (taskId, bucket) => {
        set((state) => {
          const next = { ...state.focusBuckets };
          if (bucket === null) delete next[taskId];
          else next[taskId] = bucket;
          return { focusBuckets: next };
        });
        triggerSave();
      },
      isFocusedToday: (taskId) => get().focusedTodayIds.includes(taskId),
      _hydrateFromServer: (prefs) => {
        const patch: Partial<PMState> = {};
        if (prefs.listGroupBy !== undefined) patch.listGroupBy = prefs.listGroupBy as ListGroupBy;
        if (prefs.myTasksOnly !== undefined) patch.myTasksOnly = prefs.myTasksOnly as boolean;
        if (prefs.filtersByScope !== undefined) patch.filtersByScope = prefs.filtersByScope as Record<string, TaskFilterState>;
        if (prefs.groupByScope !== undefined) patch.groupByScope = prefs.groupByScope as Record<string, GroupBy>;
        if (prefs.sortByScope !== undefined) patch.sortByScope = prefs.sortByScope as Record<string, SortBy>;
        if (prefs.focusTodayScope !== undefined) patch.focusTodayScope = prefs.focusTodayScope as Record<string, boolean>;
        if (prefs.todayListGroupBy !== undefined) patch.todayListGroupBy = prefs.todayListGroupBy as GroupBy;
        if (prefs.todayListView === 'list' || prefs.todayListView === 'calendar') {
          patch.todayListView = prefs.todayListView;
        }
        if (
          prefs.calendarMode === 'month' || prefs.calendarMode === 'week' ||
          prefs.calendarMode === '5day' || prefs.calendarMode === '4day' || prefs.calendarMode === 'day'
        ) {
          patch.calendarMode = prefs.calendarMode;
        }
        if (typeof prefs.calendarWeekStart === 'number' && prefs.calendarWeekStart >= 0 && prefs.calendarWeekStart <= 6) {
          patch.calendarWeekStart = prefs.calendarWeekStart;
        }
        // Focus is persistent — always restore the saved stars (no overnight
        // reset / staleness check).
        if (Array.isArray(prefs.focusedTodayIds)) {
          patch.focusedTodayIds = prefs.focusedTodayIds as string[];
        }
        if (typeof prefs.focusedTodayDate === 'string') {
          patch.focusedTodayDate = prefs.focusedTodayDate as string;
        }
        if (prefs.focusBuckets && typeof prefs.focusBuckets === 'object') {
          patch.focusBuckets = prefs.focusBuckets as Record<string, FocusBucket>;
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
          todayListView: s.todayListView,
          calendarMode: s.calendarMode,
          calendarWeekStart: s.calendarWeekStart,
          focusedTodayIds: s.focusedTodayIds,
          focusedTodayDate: s.focusedTodayDate,
          focusBuckets: s.focusBuckets,
        };
      },
      reset: () => set({ activeSpaceId: null, activeListId: null, activeFolderId: null, activeSpacePageId: null, activeTaskId: null, activeDesignFolderId: null, activeDashboardTab: null, newTasksOpen: false, newTaskFabVisible: false, contextListId: null, viewMode: 'list', listGroupBy: 'status', myTasksOnly: false, collapsedGroups: {}, selectedTasks: [], fadingTaskIds: new Map<string, string>(), peekTaskId: null, timer: null, filtersByScope: {}, focusedTodayIds: [], focusedTodayDate: todayKey(), focusBuckets: {}, groupByScope: {}, sortByScope: {}, focusTodayScope: {}, todayListGroupBy: 'none', todayListView: 'list', lastActiveSection: 'home', lastHomeView: 'hub' }),
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
        activeDashboardTab: state.activeDashboardTab,
        contextListId: state.contextListId,
        timer: state.timer,
        listGroupBy: state.listGroupBy,
        myTasksOnly: state.myTasksOnly,
        filtersByScope: state.filtersByScope,
        focusedTodayIds: state.focusedTodayIds,
        focusedTodayDate: state.focusedTodayDate,
        focusBuckets: state.focusBuckets,
        groupByScope: state.groupByScope,
        sortByScope: state.sortByScope,
        focusTodayScope: state.focusTodayScope,
        todayListGroupBy: state.todayListGroupBy,
        todayListView: state.todayListView,
        calendarMode: state.calendarMode,
        calendarWeekStart: state.calendarWeekStart,
        lastActiveSection: state.lastActiveSection,
        lastHomeView: state.lastHomeView,
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
