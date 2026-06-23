import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { usePMStore } from '../../../stores/pmStore';
import { useIsAdmin } from '../../../hooks/usePermissions';
import { useTasks } from '../../../hooks/useTasks';
import { canAtLeast } from '../../../lib/access';
import type { SpaceStatus, AccessLevel } from '@squadhub/shared';
import ListView from './ListView';
import BoardView from './BoardView';
import WhiteboardView from './WhiteboardView';
import SettingsSlider from '../../../components/SettingsSlider';
import ManageMembersModal from './ManageMembersModal';
import TaskCreatePanel from './TaskCreatePanel';
import FilterBar from '../../../components/pm/FilterBar';
import GroupByDropdown from '../../../components/pm/GroupByDropdown';
import ViewSearchInput from '../../../components/pm/ViewSearchInput';
import { LIST_GROUP_BY_OPTIONS, SORT_BY_OPTIONS, type SortBy } from '../../../lib/taskGrouping';
import { EMPTY_FILTER, deriveAssigneeOptions, deriveTagOptions } from '../../../lib/filters';
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
}: { listId?: string; spaceId?: string; embedded?: boolean } = {}) {
  const {
    activeSpaceId: storeSpaceId,
    activeListId: storeListId,
    viewMode,
    setViewMode,
    setActiveTask,
    setActiveSpacePage,
    setActiveFolder,
    listGroupBy,
    setListGroupBy,
    myTasksOnly,
    setMyTasksOnly,
    filtersByScope,
    setScopeFilters,
    clearScopeFilters,
  } = usePMStore();
  // When rendered embedded (the private My Tasks view), the target list/space is
  // passed as props and overrides global nav state, so opening it doesn't disturb
  // the sidebar/breadcrumb. Falls back to the store for normal list navigation.
  const activeSpaceId = propSpaceId ?? storeSpaceId;
  const activeListId = propListId ?? storeListId;
  const [showSettings, setShowSettings] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const sortByScope = usePMStore((s) => s.sortByScope);
  const setScopedSortBy = usePMStore((s) => s.setScopedSortBy);
  const focusTodayScope = usePMStore((s) => s.focusTodayScope);
  const setScopedFocusToday = usePMStore((s) => s.setScopedFocusToday);
  const listScopeKey = activeListId ? `list:${activeListId}` : '';
  const sortBy = (listScopeKey && sortByScope[listScopeKey]) || 'manual' as SortBy;
  const focusToday = !!(listScopeKey && focusTodayScope[listScopeKey]);

  const scopeKey = activeListId ? `list:${activeListId}` : '';
  const filters = (scopeKey && filtersByScope[scopeKey]) || EMPTY_FILTER;

  // On mobile, force the list view — kanban is unusable on touch and the
  // BoardView's drag-and-drop has no touch fallback. The stored desktop
  // preference is preserved (we read but don't write back).
  const isMobile = useIsMobile();
  const effectiveViewMode = isMobile ? 'list' : viewMode;

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

  // Tell the global top-bar "+" to step aside while this view shows its own
  // floating "New task" button (rendered below, gated on the same condition),
  // so the two create affordances don't both appear at once.
  const showNewTaskFab = !!activeListId && canEdit;
  const setNewTaskFabVisible = usePMStore((s) => s.setNewTaskFabVisible);
  useEffect(() => {
    setNewTaskFabVisible(showNewTaskFab);
    return () => setNewTaskFabVisible(false);
  }, [showNewTaskFab, setNewTaskFabVisible]);

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

  return (
    // min-h-0 is load-bearing: without it this flex child's automatic minimum
    // is its content height, so the .lv-canvas scroll area below grows past the
    // viewport and gets clipped by MainLayout's overflow-hidden instead of
    // scrolling (same fix as the chat view in MainLayout).
    <div className="relative flex min-h-0 flex-1 flex-col">
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

      {/* Row 2: View Tabs */}
      <div className="lv-tabs-row">
        <button
          onClick={() => setViewMode('list')}
          className="lv-tab"
          data-active={effectiveViewMode === 'list'}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
          List
        </button>
        <button
          onClick={() => setViewMode('board')}
          className="lv-tab hidden md:inline-flex"
          data-active={effectiveViewMode === 'board'}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
          Board
        </button>
        <button
          onClick={() => setViewMode('whiteboard')}
          className="lv-tab hidden md:inline-flex"
          data-active={effectiveViewMode === 'whiteboard'}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v11a1 1 0 01-1 1h-5l-3 3-3-3H5a1 1 0 01-1-1V5z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9h8M8 12.5h5" />
          </svg>
          Whiteboard
        </button>
        <button
          className="lv-tab"
          data-active={false}
          disabled
          title="Timeline view (coming soon)"
          style={{ opacity: 0.5, cursor: 'not-allowed' }}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Timeline
        </button>
      </div>

      {/* Group by dropdown + Filter + Sort + Focus today + My tasks toggle (List view only) */}
      {effectiveViewMode === 'list' && (
        <div className="lv-subtoolbar shrink-0">
          <span className="st-label">Group by</span>
          <GroupByDropdown
            options={LIST_GROUP_BY_OPTIONS}
            value={listGroupBy}
            onChange={(v) => setListGroupBy(v as typeof listGroupBy)}
          />
          <div className="st-divider" />
          <FilterBar
            filters={filters}
            onChange={(next) => scopeKey && setScopeFilters(scopeKey, next)}
            statuses={statuses}
            assigneeOptions={assigneeOptions}
            tagOptions={tagOptions}
          />
          <GroupByDropdown
            options={SORT_BY_OPTIONS}
            value={sortBy}
            onChange={(v) => listScopeKey && setScopedSortBy(listScopeKey, v as SortBy)}
            icon={SORT_ICON}
            menuTitle="Sort tasks by"
          />
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

      {/* For board view: filter row above content */}
      {effectiveViewMode === 'board' && (
        <div className="sh-view dl-groupby shrink-0">
          <FilterBar
            filters={filters}
            onChange={(next) => scopeKey && setScopeFilters(scopeKey, next)}
            statuses={statuses}
            assigneeOptions={assigneeOptions}
            tagOptions={tagOptions}
          />
        </div>
      )}

      {/* Content area + task detail panel */}
      <div className="flex flex-1 overflow-hidden">
        {effectiveViewMode === 'list' ? (
          <ListView
            listId={activeListId}
            statuses={statuses}
            filters={filters}
            onClearFilters={() => scopeKey && clearScopeFilters(scopeKey)}
            groupBy={listGroupBy}
            myTasksOnly={myTasksOnly}
            searchQuery={searchQuery}
            canEdit={canEdit}
            sortBy={sortBy}
            focusToday={focusToday}
          />
        ) : effectiveViewMode === 'board' ? (
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
        <button
          onClick={() => setShowCreatePanel(true)}
          className="lv-newtask-fab"
          aria-label="New task"
          title="New task"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New task
        </button>
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
