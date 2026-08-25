import { useMemo } from 'react';
import type { SpaceStatus, Task } from '@squadhub/shared';
import { useTasks, useUpdateTask, groupTasksByStatus } from '../../../hooks/useTasks';
import { usePMStore, type ListGroupBy } from '../../../stores/pmStore';
import { useAuthStore } from '../../../stores/authStore';
import { groupTasks as groupTasksGeneric, partitionByCompletion, sortTasks, buildFocusTodayGroup, isTaskFocused, nestSubtasks, filterWithSubtasks, type SortBy } from '../../../lib/taskGrouping';
import { filterTasks, countActiveFilters, EMPTY_FILTER, type TaskFilterState } from '../../../lib/filters';
import { useIsMobile } from '../../../hooks/useIsMobile';
import TaskGroupCard from './TaskGroupCard';

export default function ListView({
  listId,
  statuses,
  filters,
  onClearFilters,
  groupBy = 'status',
  myTasksOnly = false,
  searchQuery = '',
  canEdit = true,
  sortBy = 'manual',
  focusToday = false,
}: {
  listId: string;
  statuses: SpaceStatus[];
  filters?: TaskFilterState;
  onClearFilters?: () => void;
  groupBy?: ListGroupBy;
  myTasksOnly?: boolean;
  searchQuery?: string;
  canEdit?: boolean;
  sortBy?: SortBy;
  focusToday?: boolean;
}) {
  // Include subtasks as flat rows, then nest them under their parents so each
  // parent row gets the expandable subtask dropdown (TaskRow's chevron) instead
  // of subtasks cluttering the top level.
  const { data: flatTasks, isLoading } = useTasks(listId, { includeSubtasks: true });
  const tasks = useMemo(() => nestSubtasks(flatTasks ?? []), [flatTasks]);
  const updateTask = useUpdateTask(listId);
  const { selectedTasks, clearSelection, fadingTaskIds } = usePMStore();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const isMobile = useIsMobile();

  // One predicate for filters + search + scoping, applied subtask-aware so a
  // match on a subtask keeps its parent visible (with just matching subtasks).
  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matches = (t: Task): boolean => {
      if (filterTasks([t], filters ?? EMPTY_FILTER, tz).length === 0) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      if (myTasksOnly) {
        if (!currentUserId) return false;
        const assignees = (t.assignees || []) as { id: string }[];
        if (!assignees.some((a) => a.id === currentUserId)) return false;
      }
      if (focusToday && !isTaskFocused(t)) return false;
      return true;
    };
    let arr = filterWithSubtasks(tasks, matches);
    if (sortBy !== 'manual') {
      arr = sortTasks(arr, sortBy);
    }
    return arr;
  }, [tasks, filters, searchQuery, myTasksOnly, currentUserId, tz, focusToday, sortBy]);

  const activeFilterCount = countActiveFilters(filters);

  const { open: openTasks, completed: completedTasks } = useMemo(
    () => partitionByCompletion(filteredTasks, fadingTaskIds),
    [filteredTasks, fadingTaskIds],
  );

  const focusGroup = useMemo(() => {
    if (isMobile || focusToday) return null;
    return buildFocusTodayGroup(openTasks, sortBy);
  }, [openTasks, focusToday, sortBy, isMobile]);

  const statusGroups = useMemo(() => {
    if (groupBy !== 'status') return null;
    return groupTasksByStatus(filteredTasks, statuses, fadingTaskIds);
  }, [filteredTasks, statuses, groupBy, fadingTaskIds]);

  const genericGroups = useMemo(() => {
    if (groupBy === 'status' || groupBy === 'none') return null;
    return groupTasksGeneric(openTasks, groupBy, tz, fadingTaskIds);
  }, [openTasks, groupBy, tz, fadingTaskIds]);

  const handleStatusChange = (taskId: string, statusId: string) => {
    updateTask.mutate({ id: taskId, status: statusId });
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-[color:var(--sh-ink-3)]">Loading tasks…</p>
      </div>
    );
  }

  const totalVisible = filteredTasks.length;
  const emptyMessage = searchQuery
    ? `No tasks match "${searchQuery}".`
    : activeFilterCount > 0
      ? 'No tasks match the current filters.'
      : myTasksOnly
        ? 'No tasks assigned to you in this list.'
        : 'No tasks yet. Press + to add one.';

  return (
    <div className="lv-canvas relative flex flex-1 flex-col overflow-auto">
      <div className="lv-card-canvas" style={{ flex: 1 }}>
        {focusGroup && (
          <TaskGroupCard
            groupKey="focus_today"
            label={focusGroup.label}
            dotColor="#f59e0b"
            variant="focus"
            tasks={focusGroup.tasks}
            allStatuses={statuses}
            listId={listId}
            onStatusChange={handleStatusChange}
            canEdit={canEdit}
            showAddRow={false}
          />
        )}
        {totalVisible === 0 ? (
          <div className="lv-empty">
            {emptyMessage}
            {activeFilterCount > 0 && onClearFilters && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={onClearFilters}
                  style={{ color: 'var(--sh-ink)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}
                >
                  Clear filters
                </button>
              </>
            )}
          </div>
        ) : groupBy === 'status' && statusGroups ? (
          statusGroups.map(({ status, tasks: groupTasks }) => (
            <TaskGroupCard
              key={status.id}
              groupKey={status.id}
              label={status.name}
              dotColor={status.color}
              tasks={groupTasks}
              allStatuses={statuses}
              listId={listId}
              onStatusChange={handleStatusChange}
              canEdit={canEdit}
              showAddRow={canEdit}
              dimFocused={!!focusGroup}
              defaultNewTaskStatus={status.category}
              onDrop={handleStatusChange}
            />
          ))
        ) : groupBy === 'none' ? (
          <>
            <TaskGroupCard
              groupKey="all"
              label="All tasks"
              tasks={openTasks}
              allStatuses={statuses}
              listId={listId}
              onStatusChange={handleStatusChange}
              canEdit={canEdit}
              showAddRow={canEdit}
              dimFocused={!!focusGroup}
            />
            {completedTasks.length > 0 && (
              <TaskGroupCard
                groupKey="completed"
                label="Completed"
                dotColor="#7c3aed"
                tasks={completedTasks}
                allStatuses={statuses}
                listId={listId}
                onStatusChange={handleStatusChange}
                canEdit={canEdit}
                showAddRow={false}
                defaultCollapsed
              />
            )}
          </>
        ) : genericGroups ? (
          <>
            {genericGroups.map((g) => (
              <TaskGroupCard
                key={g.key}
                groupKey={`gg:${g.key}`}
                label={g.label}
                tasks={g.tasks}
                allStatuses={statuses}
                listId={listId}
                onStatusChange={handleStatusChange}
                canEdit={canEdit}
                showAddRow={false}
                dimFocused={!!focusGroup}
              />
            ))}
            {completedTasks.length > 0 && (
              <TaskGroupCard
                groupKey="completed"
                label="Completed"
                dotColor="#7c3aed"
                tasks={completedTasks}
                allStatuses={statuses}
                listId={listId}
                onStatusChange={handleStatusChange}
                canEdit={canEdit}
                showAddRow={false}
                defaultCollapsed
              />
            )}
          </>
        ) : null}

        {/* Bulk action bar — floating pill */}
        {canEdit && selectedTasks.length > 0 && (
          <div className="lv-bulk-bar">
            <span className="count">{selectedTasks.length} SELECTED</span>
            <button className="lv-bulk-btn" onClick={(e) => e.stopPropagation()}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" />
                <path d="M18.586 2.586a2 2 0 112.828 2.828L12 15l-4 1 1-4 9.586-9.414z" />
              </svg>
              Rename
            </button>
            <button className="lv-bulk-btn" onClick={(e) => e.stopPropagation()}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              Duplicate
            </button>
            <button className="lv-bulk-btn" onClick={(e) => e.stopPropagation()}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
              Move
            </button>
            <button className="lv-bulk-btn danger" onClick={(e) => { e.stopPropagation(); clearSelection(); }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              </svg>
              Delete
            </button>
            <button className="lv-bulk-btn" onClick={clearSelection} aria-label="Clear selection">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
