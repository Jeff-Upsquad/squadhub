import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { usePMStore } from '../../../stores/pmStore';
import { useMeetingPanelStore } from '../../../stores/meetingPanelStore';
import { useIsAdmin } from '../../../hooks/usePermissions';
import { useTasks } from '../../../hooks/useTasks';
import { useListViews, useCreateView, useUpdateView, useDeleteView } from '../../../hooks/useListViews';
import { useAuthStore } from '../../../stores/authStore';
import { canAtLeast } from '../../../lib/access';
import type { SpaceStatus, AccessLevel, ListView as ListViewType, ListViewRow, ListViewConfig } from '@squadhub/shared';
import ListView from './ListView';
import BoardView from './BoardView';
import WhiteboardView from './WhiteboardView';
import ViewTabs from '../../../components/pm/ViewTabs';
import SettingsSlider from '../../../components/SettingsSlider';
import ManageMembersModal from './ManageMembersModal';
import TaskCreatePanel from './TaskCreatePanel';
import FilterBar from '../../../components/pm/FilterBar';
import GroupByDropdown from '../../../components/pm/GroupByDropdown';
import ViewSearchInput from '../../../components/pm/ViewSearchInput';
import ContainerChatButton from '../../../components/pm/ContainerChatButton';
import { LIST_GROUP_BY_OPTIONS, SORT_BY_OPTIONS, isTaskCompleted, type SortBy } from '../../../lib/taskGrouping';
import { type ListGroupBy } from '../../../stores/pmStore';
import { EMPTY_FILTER, deriveAssigneeOptions, deriveTagOptions, filterTasks, type TaskFilterState } from '../../../lib/filters';
import { useIsMobile } from '../../../hooks/useIsMobile';

const SORT_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h13M3 12h9M3 18h5M17 8v12m0 0l-3-3m3 3l3-3" />
  </svg>
);

export default function ListPage({
  listId: propListId,
  spaceId: propSpaceId,
  embedded = false,
  active = true,
}: { listId?: string; spaceId?: string; embedded?: boolean; active?: boolean } = {}) {
  const {
    activeSpaceId: storeSpaceId,
    activeListId: storeListId,
    setActiveTask,
    setActiveSpacePage,
    setActiveFolder,
    myTasksOnly,
    setMyTasksOnly,
  } = usePMStore();
  const activeViewIdByList = usePMStore((s) => s.activeViewIdByList);
  const setActiveView = usePMStore((s) => s.setActiveView);
  // When rendered embedded (the private My Tasks view), the target list/space is
  // passed as props and overrides global nav state, so opening it doesn't disturb
  // the sidebar/breadcrumb. Falls back to the store for normal list navigation.
  const activeSpaceId = propSpaceId ?? storeSpaceId;
  const activeListId = propListId ?? storeListId;
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [showSettings, setShowSettings] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const openMeetingPanel = useMeetingPanelStore((s) => s.openMeetingPanel);
  // "Focus today" and "My tasks" stay per-user ephemeral toggles (not part of a
  // saved view's config), so they keep using the existing list-scoped store.
  const focusTodayScope = usePMStore((s) => s.focusTodayScope);
  const setScopedFocusToday = usePMStore((s) => s.setScopedFocusToday);
  const listScopeKey = activeListId ? `list:${activeListId}` : '';
  const focusToday = !!(listScopeKey && focusTodayScope[listScopeKey]);

  // On mobile, force the list layout — kanban/whiteboard are unusable on touch.
  const isMobile = useIsMobile();

  // ── Named views for this list (dynamic List/Board/Whiteboard tabs) ───────
  const { data: views = [] } = useListViews(activeListId);
  const createView = useCreateView(activeListId);
  const updateView = useUpdateView(activeListId);
  const deleteView = useDeleteView(activeListId);

  // Active view = the last tab the user opened on this list, else its default.
  const activeView: ListViewRow | null = useMemo(() => {
    if (!views.length) return null;
    const savedId = activeListId ? activeViewIdByList[activeListId] : null;
    return views.find((v) => v.id === savedId) || views.find((v) => v.is_default) || views[0];
  }, [views, activeViewIdByList, activeListId]);

  const contentType: ListViewType = isMobile ? 'list' : (activeView?.view_type ?? 'list');

  // Working copy of the active view's saved config. Toolbar edits mutate this
  // locally; "Save" pushes it to the shared view. Reset whenever the tab changes.
  const [workingConfig, setWorkingConfig] = useState<ListViewConfig>({});
  useEffect(() => { setWorkingConfig(activeView?.config ?? {}); }, [activeView?.id]);

  const filters = (workingConfig.filters ?? EMPTY_FILTER) as TaskFilterState;
  const listGroupBy = (workingConfig.groupBy ?? 'status') as ListGroupBy;
  const sortBy = (workingConfig.sortBy ?? 'manual') as SortBy;
  const configDirty = useMemo(
    () => JSON.stringify(workingConfig ?? {}) !== JSON.stringify(activeView?.config ?? {}),
    [workingConfig, activeView?.config],
  );

  const { data: listData } = useQuery({
    queryKey: ['list', activeListId],
    queryFn: async () => {
      const res = await api.get(`/pm/lists/${activeListId}`);
      return res.data.data;
    },
    enabled: !!activeListId,
  });

  const { data: spaceData } = useQuery({
    queryKey: ['space', activeSpaceId],
    queryFn: async () => {
      const res = await api.get(`/pm/spaces/${activeSpaceId}`);
      return res.data.data;
    },
    enabled: !!activeSpaceId,
  });

  const folderId: string | null = listData?.folder_id || null;
  const { data: folderData } = useQuery({
    queryKey: ['folder', folderId],
    queryFn: async () => {
      const res = await api.get(`/pm/folders/${folderId}`);
      return res.data.data;
    },
    enabled: !!folderId,
  });

  const statuses: SpaceStatus[] = useMemo(
    () => spaceData?.space_statuses || spaceData?.statuses || listData?.space_statuses || [],
    [spaceData, listData],
  );

  const myAccess: AccessLevel | undefined = spaceData?.my_access_level || listData?.my_access_level;
  const isManager = canAtLeast(myAccess, 'manager');
  const isAdmin = useIsAdmin();
  const canAccessSettings = isManager || isAdmin;
  const canEdit = canAtLeast(myAccess, 'member');

  // Cached fetch of the same task set used by ListView/BoardView (React Query dedupes).
  // Used purely to derive filter dropdown options from the un-filtered set.
  const { data: tasksForOptions } = useTasks(activeListId, undefined);
  const assigneeOptions = useMemo(() => deriveAssigneeOptions(tasksForOptions ?? []), [tasksForOptions]);
  const tagOptions = useMemo(() => deriveTagOptions(tasksForOptions ?? []), [tasksForOptions]);

  // ── Phone scope chips (the Partner app's TaskFilter: All / Today / Overdue).
  // They drive the same working-config filters the desktop toolbar edits; on
  // the phone this row replaces that toolbar entirely.
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const overdueCount = useMemo(
    () => filterTasks(tasksForOptions ?? [], { dueDate: ['overdue'] }, tz).length,
    [tasksForOptions, tz],
  );
  const todayScoped = filters.dueDate?.length === 1 && filters.dueDate?.[0] === 'today';
  const overdueScoped = filters.dueDate?.length === 1 && filters.dueDate?.[0] === 'overdue';
  const allScoped = !todayScoped && !overdueScoped;
  const scopeTo = (preset: 'today' | 'overdue' | null) =>
    setWorkingConfig((c) => ({ ...c, filters: preset ? { dueDate: [preset] } : {} }));


  // ── View actions (tab strip + save) ─────────────────────────────────────
  const selectView = (viewId: string) => { if (activeListId) setActiveView(activeListId, viewId); };
  const defaultViewName = (type: ListViewType) => {
    const base = type === 'board' ? 'Board' : type === 'whiteboard' ? 'Whiteboard' : 'List';
    const n = views.filter((v) => v.view_type === type).length;
    return n === 0 ? base : `${base} ${n + 1}`;
  };
  const handleCreateView = (type: ListViewType) =>
    createView.mutate({ view_type: type, name: defaultViewName(type) }, { onSuccess: (v) => selectView(v.id) });
  const handleRenameView = (view: ListViewRow, name: string) => updateView.mutate({ id: view.id, name });
  const handleDuplicateView = (view: ListViewRow) =>
    createView.mutate(
      { view_type: view.view_type, name: `${view.name} (copy)`, is_private: view.is_private, config: view.config },
      { onSuccess: (v) => selectView(v.id) },
    );
  const handleSetDefaultView = (view: ListViewRow) => updateView.mutate({ id: view.id, is_default: true });
  const handleTogglePrivate = (view: ListViewRow) => updateView.mutate({ id: view.id, is_private: !view.is_private });
  const handleDeleteView = (view: ListViewRow) => {
    if (!window.confirm(`Delete the "${view.name}" view?`)) return;
    deleteView.mutate(view.id);
  };
  const saveView = () => { if (activeView) updateView.mutate({ id: activeView.id, config: workingConfig }); };
  const saveAsNewView = () =>
    createView.mutate(
      { view_type: contentType, name: defaultViewName(contentType), config: workingConfig },
      { onSuccess: (v) => selectView(v.id) },
    );

  // Tell the global top-bar "+" to step aside while this view shows its own
  // floating "New task" button (rendered below, gated on the same condition),
  // so the two create affordances don't both appear at once.
  const showNewTaskFab = !!activeListId && canEdit;
  const setNewTaskFabVisible = usePMStore((s) => s.setNewTaskFabVisible);
  // Only the active tab drives the global FAB flag — otherwise a background list
  // tab (now kept mounted by the tab strip) would clobber it for the active view.
  useEffect(() => {
    if (!active) return;
    setNewTaskFabVisible(showNewTaskFab);
    return () => setNewTaskFabVisible(false);
  }, [active, showNewTaskFab, setNewTaskFabVisible]);

  if (!activeListId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <svg className="mx-auto mb-3 h-12 w-12 text-[var(--sh-ink-4)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-sm text-[var(--sh-ink-3)]">Select a list to view tasks</p>
        </div>
      </div>
    );
  }

  const listTaskTotal = (tasksForOptions ?? []).length;
  const listTaskDone = (tasksForOptions ?? []).filter(isTaskCompleted).length;

  return (
    // min-h-0 is load-bearing: without it this flex child's automatic minimum
    // is its content height, so the .lv-canvas scroll area below gets clipped.
    <div className="relative flex min-h-0 flex-1 flex-col">
      {isMobile && !embedded && (
        <div className="mtk-phone-head">
          <h1>{listData?.name || 'List'}</h1>
          <p>{listTaskTotal === 0 ? 'No tasks' : `${listTaskDone} of ${listTaskTotal} done`}</p>
          {listTaskTotal > 0 && (
            <div className="lv-phone-track" aria-hidden>
              <i style={{ width: `${Math.round((listTaskDone / listTaskTotal) * 100)}%` }} />
            </div>
          )}
        </div>
      )}
      {/* Row 1: Breadcrumb + global actions */}
      <div className="lv-breadcrumb-row">
        {/* Left: breadcrumb (hidden when embedded — the host view renders its own header) */}
        {!embedded ? (
        <div className="lv-breadcrumb">
          {spaceData?.name && activeSpaceId && (
            <>
              <button
                type="button"
                className="lv-bc-link"
                onClick={() => setActiveSpacePage(activeSpaceId)}
                title={`Go to ${spaceData.name}`}
              >
                {spaceData.name}
              </button>
              <span className="lv-bc-sep">/</span>
            </>
          )}
          {folderData?.name && folderId && (
            <>
              <button
                type="button"
                className="lv-bc-link"
                onClick={() => setActiveFolder(folderId)}
                title={`Go to ${folderData.name}`}
              >
                {folderData.name}
              </button>
              <span className="lv-bc-sep">/</span>
            </>
          )}
          <span className="lv-bc-current">{listData?.name || 'List'}</span>
        </div>
        ) : <div />}

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          {/* Search input */}
          <ViewSearchInput value={searchQuery} onChange={setSearchQuery} />

          {/* Settings button */}
          {canAccessSettings && (
            <button
              onClick={() => {
                const next = !showSettings;
                setShowSettings(next);
                if (next) setActiveTask(null);
              }}
              className="lv-icon-btn"
              data-active={showSettings}
              title="List settings"
              aria-label="List settings"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          )}

        </div>
      </div>

      {/* Row 2: Named view tabs (List / Board / Whiteboard views + "+") */}
      <div className="lv-tabs-row">
        <ViewTabs
          views={views}
          activeViewId={activeView?.id ?? null}
          currentUserId={currentUserId}
          canEdit={canEdit && !isMobile}
          onSelect={selectView}
          onCreate={handleCreateView}
          onRename={handleRenameView}
          onDuplicate={handleDuplicateView}
          onSetDefault={handleSetDefaultView}
          onTogglePrivate={handleTogglePrivate}
          onDelete={handleDeleteView}
        />
        {activeListId && (
          <ContainerChatButton
            resourceType="list"
            resourceId={activeListId}
            name={listData?.name || 'List'}
            accessLevel={myAccess}
            style={{ marginLeft: 'auto' }}
          />
        )}
      </div>

      {/* Group by dropdown + Filter + Sort + Focus today + My tasks toggle (List view only) */}
      {contentType === 'list' && (
        <div className="lv-subtoolbar shrink-0">
          <span className="st-label">Group by</span>
          <GroupByDropdown
            options={LIST_GROUP_BY_OPTIONS}
            value={listGroupBy}
            onChange={(v) => setWorkingConfig((c) => ({ ...c, groupBy: v }))}
          />
          <div className="st-divider" />
          <FilterBar
            filters={filters}
            onChange={(next) => setWorkingConfig((c) => ({ ...c, filters: next }))}
            statuses={statuses}
            assigneeOptions={assigneeOptions}
            tagOptions={tagOptions}
          />
          <GroupByDropdown
            options={SORT_BY_OPTIONS}
            value={sortBy}
            onChange={(v) => setWorkingConfig((c) => ({ ...c, sortBy: v }))}
            icon={SORT_ICON}
            menuTitle="Sort tasks by"
          />
          {canEdit && configDirty && (
            <div className="vt-saverow">
              <button type="button" className="lv-toolbtn vt-save" onClick={saveView} title="Save these settings to this view">Save view</button>
              <button type="button" className="lv-toolbtn lv-toolbtn--outline" onClick={saveAsNewView} title="Save as a new view">Save as new</button>
            </div>
          )}
          <button
            type="button"
            onClick={() => listScopeKey && setScopedFocusToday(listScopeKey, !focusToday)}
            className="lv-toolbtn lv-toolbtn--outline"
            data-active={focusToday}
            aria-pressed={focusToday}
            title="Show only tasks scheduled for today"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            Focus today
          </button>
          <div className="st-spacer" />
          <button
            type="button"
            onClick={() => setMyTasksOnly(!myTasksOnly)}
            className="lv-toolbtn lv-toolbtn--outline"
            data-active={myTasksOnly}
            aria-pressed={myTasksOnly}
            title="Show only tasks assigned to me"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            My tasks
          </button>
        </div>
      )}

      {/* Phone scope chips — TaskFilter.kt's All / Today / Overdue pills with
          counts; replaces the desktop toolbar above on narrow screens. */}
      {contentType === 'list' && isMobile && (
        <div className="lv-scope-row">
          <button
            type="button"
            className="lv-scope-chip"
            data-on={allScoped || undefined}
            onClick={() => scopeTo(null)}
          >
            All
            <span className="n">{(tasksForOptions ?? []).length}</span>
          </button>
          <button
            type="button"
            className="lv-scope-chip"
            data-on={todayScoped || undefined}
            onClick={() => scopeTo(todayScoped ? null : 'today')}
          >
            Today
          </button>
          <button
            type="button"
            className="lv-scope-chip"
            data-on={overdueScoped || undefined}
            data-overdue={overdueCount > 0 ? '' : undefined}
            onClick={() => scopeTo(overdueScoped ? null : 'overdue')}
          >
            Overdue
            {overdueCount > 0 && <span className="n">{overdueCount}</span>}
          </button>
        </div>
      )}

      {/* For board view: filter row (+ save) above content */}
      {contentType === 'board' && (
        <div className="sh-view dl-groupby shrink-0" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FilterBar
            filters={filters}
            onChange={(next) => setWorkingConfig((c) => ({ ...c, filters: next }))}
            statuses={statuses}
            assigneeOptions={assigneeOptions}
            tagOptions={tagOptions}
          />
          {canEdit && configDirty && (
            <div className="vt-saverow">
              <button type="button" className="lv-toolbtn vt-save" onClick={saveView} title="Save this filter to this view">Save view</button>
              <button type="button" className="lv-toolbtn lv-toolbtn--outline" onClick={saveAsNewView} title="Save as a new view">Save as new</button>
            </div>
          )}
        </div>
      )}

      {/* Content area + task detail panel */}
      <div className="flex flex-1 overflow-hidden">
        {contentType === 'list' ? (
          <ListView
            listId={activeListId}
            statuses={statuses}
            filters={filters}
            onClearFilters={() => setWorkingConfig((c) => ({ ...c, filters: {} }))}
            groupBy={listGroupBy}
            myTasksOnly={myTasksOnly}
            searchQuery={searchQuery}
            canEdit={canEdit}
            sortBy={sortBy}
            focusToday={focusToday}
          />
        ) : contentType === 'board' ? (
          <BoardView
            listId={activeListId}
            statuses={statuses}
            filters={filters}
            listName={listData?.name || ''}
            searchQuery={searchQuery}
            canEdit={canEdit}
          />
        ) : (
          <WhiteboardView
            viewId={activeView?.id ?? ''}
            listId={activeListId}
            statuses={statuses}
            canEdit={canEdit}
          />
        )}

        {showSettings && activeListId && (
          <SettingsSlider
            type="list"
            id={activeListId}
            name={listData?.name || ''}
            spaceId={activeSpaceId}
            groupTasks={listData?.group_tasks}
            autoAssigneeIds={listData?.auto_assignee_ids}
            myAccess={myAccess}
            onClose={() => setShowSettings(false)}
            onDeleted={() => {
              setShowSettings(false);
            }}
          />
        )}
      </div>

      {showShare && activeListId && (
        <ManageMembersModal
          resourceType="list"
          resourceId={activeListId}
          resourceName={listData?.name || 'List'}
          onClose={() => setShowShare(false)}
        />
      )}

      {/* Floating "New task" action — anchored bottom-right of the list view.
          While this shows, the global top-bar "+" hides (see showNewTaskFab). */}
      {showNewTaskFab && (
        <div className="lv-newtask-fab-wrap" style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 40 }}>
          {showNewMenu && (
            <>
              <div className="fixed inset-0 z-[1]" onClick={() => setShowNewMenu(false)} />
              <div
                className="absolute bottom-[calc(100%+8px)] right-0 z-[2] w-52 overflow-hidden rounded-xl border shadow-lg"
                style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface)' }}
              >
                <button
                  onClick={() => { setShowNewMenu(false); setShowCreatePanel(true); }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-[color:var(--sh-ink)] hover:bg-[color:var(--sh-hair-3)]"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M9 11l3 3 8-8M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9" /></svg>
                  New Task
                </button>
                <button
                  onClick={() => { setShowNewMenu(false); openMeetingPanel({ listId: activeListId }); }}
                  className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-left text-[13px] text-[color:var(--sh-ink)] hover:bg-[color:var(--sh-hair-3)]"
                  style={{ borderColor: 'var(--sh-hair)' }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0a7d55" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                  Create New Meeting
                </button>
              </div>
            </>
          )}
          <div className="flex items-stretch">
            <button
              onClick={() => setShowCreatePanel(true)}
              className="lv-newtask-fab"
              style={{ position: 'static', borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
              aria-label="New task"
              title="New task"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New task
            </button>
            <button
              onClick={() => setShowNewMenu((v) => !v)}
              className="lv-newtask-fab"
              style={{ position: 'static', borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: '1px solid rgba(255,255,255,0.25)', paddingLeft: 8, paddingRight: 8 }}
              aria-label="More create options"
              title="More options"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {showCreatePanel && activeListId && canEdit && (
        <TaskCreatePanel
          listId={activeListId}
          statuses={statuses}
          defaultStatus={statuses[0]?.name}
          spaceName={spaceData?.name}
          spaceColor={spaceData?.color || null}
          folderName={folderData?.name || null}
          listName={listData?.name || null}
          onClose={() => setShowCreatePanel(false)}
        />
      )}
    </div>
  );
}
