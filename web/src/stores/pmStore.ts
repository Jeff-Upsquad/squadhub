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
// "Later today" triage buckets for the Home Focus list. A starred task can be
// moved into Evening (after 3 PM) or Night (after 7 PM). Per-instance
// assignments live in `focusBuckets` and fall back to the main Focus list at
// local midnight (see rolloverFocusBuckets); a recurring task's section is
// instead remembered per recurrence template in `recurringFocusBuckets`, so
// every freshly spawned copy reappears in the same section.
export type FocusBucket = 'evening' | 'night';

// Local-clock thresholds (hour-of-day, 24h) for the two buckets.
export const EVENING_START_HOUR = 15; // 3 PM
export const NIGHT_START_HOUR = 19;   // 7 PM

// Which bucket a minute-of-day falls into when a task is dropped onto the day
// planner grid: ≥7 PM → night, ≥3 PM → evening, earlier → none (main list).
export function focusBucketForMinute(minute: number): FocusBucket | null {
  if (minute >= NIGHT_START_HOUR * 60) return 'night';
  if (minute >= EVENING_START_HOUR * 60) return 'evening';
  return null;
}

// Resolve the section a task currently sits in: an explicit per-instance
// assignment wins; otherwise a recurring task inherits its template's sticky
// section so spawned copies reappear where the user last placed the routine.
export function effectiveFocusBucket(
  task: { id: string; recurring_parent_id?: string | null },
  focusBuckets: Record<string, FocusBucket>,
  recurringFocusBuckets: Record<string, FocusBucket>,
): FocusBucket | undefined {
  const own = focusBuckets[task.id];
  if (own) return own;
  const parent = task.recurring_parent_id;
  if (parent && recurringFocusBuckets[parent]) return recurringFocusBuckets[parent];
  return undefined;
}
export type HomeView = 'hub' | 'chat' | 'tasks' | 'inbox' | 'my-tasks' | 'mentions' | 'later' | 'checkin' | 'checkin-partners' | 'time-management' | 'sales-leads' | 'cashbook' | 'opportunities' | 'published-cards' | 'day-planner';

interface TimerState {
  taskId: string;
  taskTitle: string;
  listId: string;
  startedAt: number;
  baseTracked: number;
}

// Target for the grouped-task detail panel (the work-block-style view opened by
// clicking a "Grouped tasks under …" row's name). A group is virtual, so we
// carry its stable run key, label, a list-id hint for time attribution, and a
// lightweight snapshot of its child tasks for the "Tasks in this group" list.
export interface GroupRunPanelTarget {
  key: string;
  label: string;
  listId: string | null;
  tasks: { id: string; title: string }[];
}

interface PMState {
  activeSpaceId: string | null;
  activeListId: string | null;
  activeFolderId: string | null;
  activeSpacePageId: string | null;
  activeTaskId: string | null;
  activeDesignFolderId: string | null;
  activeDashboardTab: DashboardTab | null;
  // Which Home "disappearing card" (Urgent / Recordings / Meetings / Calls) has
  // its slide-in list panel open. Keyed by the card's config key; null = closed.
  // Not persisted — a panel shouldn't reopen on reload (mirrors newTasksOpen).
  activeSecondaryCard: string | null;
  // The full-page "New Tasks" review popup (My Home). Separate from
  // activeDashboardTab — that drives the right-sliding bucket panel; this is a
  // distinct full-screen overlay. Not persisted (a modal shouldn't reopen on reload).
  newTasksOpen: boolean;
  // True while a list/board view is showing its own floating "New task" button.
  // The global top-bar "+" create button hides itself when this is set, so the
  // two create affordances don't both show at once. Transient (not persisted) —
  // set by ListPage on mount/unmount, mirrors newTasksOpen.
  newTaskFabVisible: boolean;
  homeView: HomeView;
  contextListId: string | null;
  viewMode: ViewMode;
  // The active named view (tab) per list, keyed by list id. Persisted + synced so
  // the last-opened tab is restored across reloads and devices. Falls back to the
  // list's default view when absent.
  activeViewIdByList: Record<string, string>;
  listGroupBy: ListGroupBy;
  myTasksOnly: boolean;
  collapsedGroups: Record<string, boolean>;
  // Per-container expand state for Home's "Grouped tasks under {name}" rows
  // (keyed by container id). Default (absent) = collapsed.
  groupedExpanded: Record<string, boolean>;
  // Collapse state for Home's Evening / Night Focus-list buckets (keyed by
  // bucket). Default (absent) = expanded. Each bucket auto-expands once when its
  // time of day arrives; focusBucketAutoOpenedDate records the local date that
  // last happened, so the auto-open fires once per day and doesn't override a
  // user who deliberately re-collapses the section afterward.
  focusBucketCollapsed: Partial<Record<FocusBucket, boolean>>;
  focusBucketAutoOpenedDate: Partial<Record<FocusBucket, string>>;
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
  // The grouped-task ("Grouped tasks under …") detail panel target, opened by
  // clicking the grouped row's name. Mirrors the work-block task type view but
  // for a virtual group (no task row). Not persisted.
  groupRunPanel: GroupRunPanelTarget | null;
  timer: TimerState | null;
  filtersByScope: Record<string, TaskFilterState>;
  focusedTodayIds: string[];
  focusedTodayDate: string;
  focusBuckets: Record<string, FocusBucket>;
  // Sticky Evening/Night section per recurrence template id. Unlike
  // focusBuckets it survives the midnight rollover, so each day's freshly
  // spawned copy of a recurring task reappears in the same section.
  recurringFocusBuckets: Record<string, FocusBucket>;
  // Local date (todayKey) the per-instance focusBuckets were last rolled over.
  // When it goes stale, rolloverFocusBuckets clears focusBuckets back to the
  // main Focus list (recurringFocusBuckets is left untouched).
  focusBucketsRolloverDate: string;
  groupByScope: Record<string, GroupBy>;
  sortByScope: Record<string, SortBy>;
  focusTodayScope: Record<string, boolean>;
  // Group-by selection for each Home "disappearing card" panel, keyed by card
  // key ('urgent' | 'recordings' | 'meetings' | 'calls'). Persisted so it sticks
  // across refresh and syncs across devices.
  secondaryCardGroupBy: Record<string, GroupBy>;
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
  setGroupRunPanel: (target: GroupRunPanelTarget | null) => void;
  setActiveDesignFolder: (id: string | null) => void;
  setContextListId: (id: string | null) => void;
  setActiveDashboardTab: (tab: DashboardTab | null) => void;
  setActiveSecondaryCard: (key: string | null) => void;
  setNewTasksOpen: (open: boolean) => void;
  setNewTaskFabVisible: (visible: boolean) => void;
  setHomeView: (v: HomeView) => void;
  setViewMode: (mode: ViewMode) => void;
  setActiveView: (listId: string, viewId: string) => void;
  setListGroupBy: (g: ListGroupBy) => void;
  setMyTasksOnly: (v: boolean) => void;
  toggleGroupCollapse: (statusId: string) => void;
  setGroupCollapsed: (groupKey: string, collapsed: boolean) => void;
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
  setSecondaryCardGroupBy: (cardKey: string, value: GroupBy) => void;
  setTodayListGroupBy: (value: GroupBy) => void;
  setTodayListView: (value: TodayListView) => void;
  toggleGroupedExpanded: (containerId: string) => void;
  setFocusBucketCollapsed: (bucket: FocusBucket, collapsed: boolean) => void;
  autoOpenFocusBucket: (bucket: FocusBucket, dateKey: string) => void;
  setCalendarMode: (value: CalendarMode) => void;
  setCalendarWeekStart: (value: number) => void;
  setLastView: (section: string, homeView: string) => void;
  toggleFocusToday: (taskId: string) => void;
  setFocusBucket: (taskId: string, bucket: FocusBucket | null, recurringParentId?: string | null) => void;
  rolloverFocusBuckets: () => void;
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
      activeSecondaryCard: null,
      newTasksOpen: false,
      newTaskFabVisible: false,
      homeView: 'hub',
      contextListId: null,
      viewMode: 'list',
      activeViewIdByList: {},
      listGroupBy: 'status',
      myTasksOnly: false,
      collapsedGroups: {},
      groupedExpanded: {},
      focusBucketCollapsed: {},
      focusBucketAutoOpenedDate: {},
      selectedTasks: [],
      fadingTaskIds: new Map<string, string>(),
      peekTaskId: null,
      groupRunPanel: null,
      timer: null,
      filtersByScope: {},
      focusedTodayIds: [],
      focusedTodayDate: todayKey(),
      focusBuckets: {},
      recurringFocusBuckets: {},
      focusBucketsRolloverDate: todayKey(),
      groupByScope: {},
      sortByScope: {},
      focusTodayScope: {},
      secondaryCardGroupBy: {},
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
      setGroupRunPanel: (target) => set({ groupRunPanel: target }),
      setActiveDesignFolder: (id) => set({ activeDesignFolderId: id, activeListId: null, activeFolderId: null, activeSpacePageId: null, contextListId: null, selectedTasks: [] }),
      setContextListId: (id) => set({ contextListId: id }),
      setActiveDashboardTab: (tab) => set({ activeDashboardTab: tab }),
      setActiveSecondaryCard: (key) => set({ activeSecondaryCard: key }),
      setNewTasksOpen: (open) => set({ newTasksOpen: open }),
      setNewTaskFabVisible: (visible) => set({ newTaskFabVisible: visible }),
      setHomeView: (v) => set({ homeView: v }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setActiveView: (listId, viewId) => {
        set((s) => ({ activeViewIdByList: { ...s.activeViewIdByList, [listId]: viewId } }));
        triggerSave();
      },
      setListGroupBy: (g) => { set({ listGroupBy: g }); triggerSave(); },
      setMyTasksOnly: (v) => { set({ myTasksOnly: v }); triggerSave(); },
      toggleGroupCollapse: (statusId) =>
        set((state) => ({
          collapsedGroups: {
            ...state.collapsedGroups,
            [statusId]: !state.collapsedGroups[statusId],
          },
        })),
      // Explicitly set a group's collapsed state. Prefer this over
      // toggleGroupCollapse when the caller knows the effective state but the
      // stored value may be undefined (e.g. a group with defaultCollapsed) —
      // flipping `undefined` would make the first click a no-op.
      setGroupCollapsed: (groupKey, collapsed) =>
        set((state) => ({
          collapsedGroups: { ...state.collapsedGroups, [groupKey]: collapsed },
        })),
      toggleGroupedExpanded: (containerId) =>
        set((state) => ({
          groupedExpanded: {
            ...state.groupedExpanded,
            [containerId]: !state.groupedExpanded[containerId],
          },
        })),
      setFocusBucketCollapsed: (bucket, collapsed) =>
        set((state) => ({
          focusBucketCollapsed: { ...state.focusBucketCollapsed, [bucket]: collapsed },
        })),
      // Mark a bucket's time-of-day threshold as reached for `dateKey` and expand
      // it if collapsed. Stamping the date makes this a once-per-day event, so a
      // user re-collapsing the section afterward isn't overridden on the next tick.
      autoOpenFocusBucket: (bucket, dateKey) =>
        set((state) => ({
          focusBucketCollapsed: { ...state.focusBucketCollapsed, [bucket]: false },
          focusBucketAutoOpenedDate: { ...state.focusBucketAutoOpenedDate, [bucket]: dateKey },
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
      setSecondaryCardGroupBy: (cardKey, value) => {
        set((state) => ({
          secondaryCardGroupBy: { ...state.secondaryCardGroupBy, [cardKey]: value },
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
      setFocusBucket: (taskId, bucket, recurringParentId) => {
        set((state) => {
          const next = { ...state.focusBuckets };
          if (bucket === null) delete next[taskId];
          else next[taskId] = bucket;
          // Recurring tasks also record the section against their template so
          // future spawned copies inherit it — and it survives the midnight
          // rollover (see rolloverFocusBuckets / effectiveFocusBucket).
          let recurringFocusBuckets = state.recurringFocusBuckets;
          if (recurringParentId) {
            const r = { ...recurringFocusBuckets };
            if (bucket === null) delete r[recurringParentId];
            else r[recurringParentId] = bucket;
            recurringFocusBuckets = r;
          }
          return { focusBuckets: next, recurringFocusBuckets };
        });
        triggerSave();
      },
      // Roll the per-instance Evening/Night buckets back to the main Focus list
      // once the local day flips: non-recurring tasks lose their section, while
      // recurring tasks keep theirs via recurringFocusBuckets. A no-op until the
      // stored date is stale, so the mount call + once-a-minute tick fire it
      // exactly once when midnight passes, even with the app left open.
      rolloverFocusBuckets: () => {
        const today = todayKey();
        let changed = false;
        set((state) => {
          if (state.focusBucketsRolloverDate === today) return state;
          changed = true;
          return { focusBuckets: {}, focusBucketsRolloverDate: today };
        });
        if (changed) triggerSave();
      },
      isFocusedToday: (taskId) => get().focusedTodayIds.includes(taskId),
      _hydrateFromServer: (prefs) => {
        const patch: Partial<PMState> = {};
        if (prefs.activeViewIdByList && typeof prefs.activeViewIdByList === 'object') patch.activeViewIdByList = prefs.activeViewIdByList as Record<string, string>;
        if (prefs.listGroupBy !== undefined) patch.listGroupBy = prefs.listGroupBy as ListGroupBy;
        if (prefs.myTasksOnly !== undefined) patch.myTasksOnly = prefs.myTasksOnly as boolean;
        if (prefs.filtersByScope !== undefined) patch.filtersByScope = prefs.filtersByScope as Record<string, TaskFilterState>;
        if (prefs.groupByScope !== undefined) patch.groupByScope = prefs.groupByScope as Record<string, GroupBy>;
        if (prefs.sortByScope !== undefined) patch.sortByScope = prefs.sortByScope as Record<string, SortBy>;
        if (prefs.focusTodayScope !== undefined) patch.focusTodayScope = prefs.focusTodayScope as Record<string, boolean>;
        if (prefs.secondaryCardGroupBy !== undefined) patch.secondaryCardGroupBy = prefs.secondaryCardGroupBy as Record<string, GroupBy>;
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
        if (prefs.recurringFocusBuckets && typeof prefs.recurringFocusBuckets === 'object') {
          patch.recurringFocusBuckets = prefs.recurringFocusBuckets as Record<string, FocusBucket>;
        }
        if (typeof prefs.focusBucketsRolloverDate === 'string') {
          patch.focusBucketsRolloverDate = prefs.focusBucketsRolloverDate as string;
        }
        if (Object.keys(patch).length > 0) set(patch);
      },
      _getServerPayload: () => {
        const s = get();
        return {
          activeViewIdByList: s.activeViewIdByList,
          listGroupBy: s.listGroupBy,
          myTasksOnly: s.myTasksOnly,
          filtersByScope: s.filtersByScope,
          groupByScope: s.groupByScope,
          sortByScope: s.sortByScope,
          focusTodayScope: s.focusTodayScope,
          secondaryCardGroupBy: s.secondaryCardGroupBy,
          todayListGroupBy: s.todayListGroupBy,
          todayListView: s.todayListView,
          calendarMode: s.calendarMode,
          calendarWeekStart: s.calendarWeekStart,
          focusedTodayIds: s.focusedTodayIds,
          focusedTodayDate: s.focusedTodayDate,
          focusBuckets: s.focusBuckets,
          recurringFocusBuckets: s.recurringFocusBuckets,
          focusBucketsRolloverDate: s.focusBucketsRolloverDate,
        };
      },
      reset: () => set({ activeSpaceId: null, activeListId: null, activeFolderId: null, activeSpacePageId: null, activeTaskId: null, activeDesignFolderId: null, activeDashboardTab: null, activeSecondaryCard: null, newTasksOpen: false, newTaskFabVisible: false, homeView: 'hub', contextListId: null, viewMode: 'list', activeViewIdByList: {}, listGroupBy: 'status', myTasksOnly: false, collapsedGroups: {}, groupedExpanded: {}, focusBucketCollapsed: {}, focusBucketAutoOpenedDate: {}, selectedTasks: [], fadingTaskIds: new Map<string, string>(), peekTaskId: null, groupRunPanel: null, timer: null, filtersByScope: {}, focusedTodayIds: [], focusedTodayDate: todayKey(), focusBuckets: {}, recurringFocusBuckets: {}, focusBucketsRolloverDate: todayKey(), groupByScope: {}, sortByScope: {}, focusTodayScope: {}, secondaryCardGroupBy: {}, todayListGroupBy: 'none', todayListView: 'list', lastActiveSection: 'home', lastHomeView: 'hub' }),
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
        homeView: state.homeView,
        contextListId: state.contextListId,
        timer: state.timer,
        activeViewIdByList: state.activeViewIdByList,
        listGroupBy: state.listGroupBy,
        myTasksOnly: state.myTasksOnly,
        filtersByScope: state.filtersByScope,
        focusedTodayIds: state.focusedTodayIds,
        focusedTodayDate: state.focusedTodayDate,
        focusBuckets: state.focusBuckets,
        recurringFocusBuckets: state.recurringFocusBuckets,
        focusBucketsRolloverDate: state.focusBucketsRolloverDate,
        groupByScope: state.groupByScope,
        sortByScope: state.sortByScope,
        focusTodayScope: state.focusTodayScope,
        secondaryCardGroupBy: state.secondaryCardGroupBy,
        todayListGroupBy: state.todayListGroupBy,
        todayListView: state.todayListView,
        groupedExpanded: state.groupedExpanded,
        focusBucketCollapsed: state.focusBucketCollapsed,
        focusBucketAutoOpenedDate: state.focusBucketAutoOpenedDate,
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
