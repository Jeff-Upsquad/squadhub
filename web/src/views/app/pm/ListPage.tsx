import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { usePMStore } from '../../../stores/pmStore';
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
import MinimalGroupFilterBar from '../../../components/pm/MinimalGroupFilterBar';
import ViewSearchInput from '../../../components/pm/ViewSearchInput';
import ContainerChatButton from '../../../components/pm/ContainerChatButton';
import { LIST_GROUP_BY_OPTIONS, SORT_BY_OPTIONS, isTaskCompleted, type SortBy } from '../../../lib/taskGrouping';
import { type ListGroupBy } from '../../../stores/pmStore';
import { EMPTY_FILTER, deriveAssigneeOptions, deriveTagOptions, filterTasks, type TaskFilterState } from '../../../lib/filters';
import { useIsMobile } from '../../../hooks/useIsMobile';

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

  // Creation now lives in the small global bottom-right quick-create FAB.
  // Keep reporting this flag so the mobile top-bar "+" stays hidden on list
  // views (mobile creation goes through MobileCreateSheet, and the desktop
  // per-view FAB was removed in favour of the global one).
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

      {/* Minimal Group + Filter bar (List view only) */}
      {contentType === 'list' && (
        <MinimalGroupFilterBar
          groupOptions={LIST_GROUP_BY_OPTIONS as { value: string; label: string }[]}
          groupBy={listGroupBy}
          onGroupChange={(v) => setWorkingConfig((c) => ({ ...c, groupBy: v }))}
          filters={filters}
          onFiltersChange={(next) => setWorkingConfig((c) => ({ ...c, filters: next }))}
          statuses={statuses}
          assigneeOptions={assigneeOptions}
          tagOptions={tagOptions}
          sortOptions={SORT_BY_OPTIONS as { value: string; label: string }[]}
          sortBy={sortBy}
          onSortChange={(v) => setWorkingConfig((c) => ({ ...c, sortBy: v }))}
          extraRight={
            <>
              {canEdit && configDirty && (
                <>
                  <button type="button" className="mgf-mini" data-active onClick={saveView} title="Save these settings to this view">Save view</button>
                  <button type="button" className="mgf-mini" onClick={saveAsNewView} title="Save as a new view">Save as new</button>
                </>
              )}
              <button
                type="button"
                onClick={() => listScopeKey && setScopedFocusToday(listScopeKey, !focusToday)}
                className="mgf-mini"
                data-active={focusToday || undefined}
                aria-pressed={focusToday}
                title="Show only tasks scheduled for today"
              >
                Focus today
              </button>
              <button
                type="button"
                onClick={() => setMyTasksOnly(!myTasksOnly)}
                className="mgf-mini"
                data-active={myTasksOnly || undefined}
                aria-pressed={myTasksOnly}
                title="Show only tasks assigned to me"
              >
                My tasks
              </button>
            </>
          }
        />
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

      {/* For board view: minimal filter row (+ save) above content */}
      {contentType === 'board' && (
        <MinimalGroupFilterBar
          hideGroup
          groupOptions={[]}
          groupBy="none"
          onGroupChange={() => {}}
          filters={filters}
          onFiltersChange={(next) => setWorkingConfig((c) => ({ ...c, filters: next }))}
          statuses={statuses}
          assigneeOptions={assigneeOptions}
          tagOptions={tagOptions}
          extraRight={
            canEdit && configDirty ? (
              <>
                <button type="button" className="mgf-mini" data-active onClick={saveView} title="Save this filter to this view">Save view</button>
                <button type="button" className="mgf-mini" onClick={saveAsNewView} title="Save as a new view">Save as new</button>
              </>
            ) : undefined
          }
        />
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

      {/* Creation now lives in the small global bottom-right quick-create FAB
          (see GlobalQuickCreateFab in MainLayout) — the old large per-view
          floating button was removed to keep the corner uncluttered. */}
    </div>
  );
}
