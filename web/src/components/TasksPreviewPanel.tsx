import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import { usePMStore, type ListGroupBy } from '../stores/pmStore';
import { useAuthStore } from '../stores/authStore';
import { useTabsStore } from '../stores/tabsStore';
import { buildHomeSnapshot } from '../lib/tabSnapshots';
import { usePersonalList, useTasks, useUpdateTask, groupTasksByStatus } from '../hooks/useTasks';
import { useListViews } from '../hooks/useListViews';
import {
  LIST_GROUP_BY_OPTIONS,
  SORT_BY_OPTIONS,
  buildFocusTodayGroup,
  filterWithSubtasks,
  groupTasks as groupTasksGeneric,
  isTaskCompleted,
  isTaskFocused,
  nestSubtasks,
  partitionByCompletion,
  sortByCreationOrder,
  sortTasks,
  type SortBy,
} from '../lib/taskGrouping';
import { EMPTY_FILTER, filterTasks, type TaskFilterState } from '../lib/filters';
import { PRIORITY_META } from '../views/app/pm/PriorityPicker';
import { useIsMobile } from '../hooks/useIsMobile';
import type { SpaceStatus, Task } from '@squadhub/shared';

/**
 * Floating "My Tasks" quick-view — opened by hovering the rail's tasks button.
 * Mirrors the My Tasks section (the private personal list rendered through the
 * same grouping/sorting pipeline as ListPage/ListView): group + sort come from
 * the list's active saved view, falling back to status/manual exactly like the
 * section does. Read-only rows; clicking one opens it in a new tab backed by
 * the My Tasks view and closes the panel.
 */

const MAX_ROWS_PER_GROUP = 7;

function dueMeta(due: string | null): { text: string; overdue: boolean } | null {
  if (!due) return null;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  const md = d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  if (diffDays === 0) return { text: 'Today', overdue: false };
  if (diffDays === 1) return { text: 'Tomorrow', overdue: false };
  if (diffDays === -1) return { text: 'Yesterday', overdue: true };
  return { text: md, overdue: diffDays < 0 };
}

function PreviewRow({ task, listId, onOpen }: { task: Task; listId: string; onOpen: (t: Task) => void }) {
  const updateTask = useUpdateTask(listId);
  const done = isTaskCompleted(task);
  const due = dueMeta(task.due_date);
  const pri = task.priority && task.priority !== 'none' ? PRIORITY_META[task.priority] : null;

  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className="flex w-full items-center gap-2.5 px-5 py-2 text-left transition hover:bg-[var(--sh-hair-3)]"
    >
      <span
        role="checkbox"
        aria-checked={done}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        onClick={(e) => {
          e.stopPropagation();
          updateTask.mutate({ id: task.id, status: done ? 'todo' : 'done' });
        }}
        className={`grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[5px] border transition ${
          done
            ? 'border-transparent bg-[var(--sh-ink)] text-[var(--surface)]'
            : 'border-[var(--sh-ink-4)] text-transparent hover:border-[var(--sh-ink)]'
        }`}
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="m5 13 4 4L19 7" />
        </svg>
      </span>
      <span className={`min-w-0 flex-1 truncate text-[13px] ${done ? 'text-[var(--sh-ink-4)] line-through' : 'text-[var(--sh-ink)]'}`}>
        {task.title}
      </span>
      {pri && (
        <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--sh-ink-3)]">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: pri.color }} />
          {pri.label}
        </span>
      )}
      {due && (
        <span className={`shrink-0 text-[11px] ${due.overdue ? 'font-semibold text-red-500' : 'text-[var(--sh-ink-4)]'}`}>
          {due.text}
        </span>
      )}
    </button>
  );
}

function GroupHeader({ label, count, dotColor }: { label: string; count: number; dotColor?: string }) {
  return (
    <div className="flex items-center gap-2 px-5 pb-1 pt-3">
      {dotColor && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor }} />}
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--sh-ink-3)]">{label}</span>
      <span className="text-[11px] tabular-nums text-[var(--sh-ink-4)]">{count}</span>
    </div>
  );
}

export default function TasksPreviewPanel({
  onClose,
  onHoverEnter,
  onHoverLeave,
  onOpenSection,
  pinned = true,
}: {
  onClose: () => void;
  /** Kept open while the pointer moves from the rail icon into the panel. */
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
  /** Navigate to the full My Tasks section. */
  onOpenSection: () => void;
  /**
   * Same contract as InboxSlider: hover-opened panels (pinned=false) skip the
   * transparent click-catcher so it can't steal hit-testing from the rail
   * button and instantly trigger its pointer-leave close timer.
   */
  pinned?: boolean;
}) {
  const isMobile = useIsMobile();
  const fadingTaskIds = usePMStore((s) => s.fadingTaskIds);
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const myTasksOnly = usePMStore((s) => s.myTasksOnly);
  const focusTodayScope = usePMStore((s) => s.focusTodayScope);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [completedOpen, setCompletedOpen] = useState(false);
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  // Close on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const { data: personal } = usePersonalList();
  const listId = personal?.list.id ?? null;
  const spaceId = personal?.space.id ?? null;

  // Same saved-view resolution as ListPage: last-opened tab, else default, else first.
  const { data: views = [] } = useListViews(listId);
  const activeViewIdByList = usePMStore((s) => s.activeViewIdByList);
  const activeView = useMemo(() => {
    if (!views.length) return null;
    const savedId = listId ? activeViewIdByList[listId] : null;
    return views.find((v) => v.id === savedId) || views.find((v) => v.is_default) || views[0];
  }, [views, activeViewIdByList, listId]);

  const groupBy = (activeView?.config?.groupBy ?? 'status') as ListGroupBy;
  const sortBy = (activeView?.config?.sortBy ?? 'manual') as SortBy;
  const filters = (activeView?.config?.filters ?? EMPTY_FILTER) as TaskFilterState;
  const groupLabel = LIST_GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label ?? groupBy;
  const sortLabel = SORT_BY_OPTIONS.find((o) => o.value === sortBy)?.label ?? sortBy;

  // Same status fallback chain as ListPage.
  const { data: listData } = useQuery({
    queryKey: ['list', listId],
    queryFn: async () => (await api.get(`/pm/lists/${listId}`)).data.data,
    enabled: !!listId,
  });
  const { data: spaceData } = useQuery({
    queryKey: ['space', spaceId],
    queryFn: async () => (await api.get(`/pm/spaces/${spaceId}`)).data.data,
    enabled: !!spaceId,
  });
  const statuses: SpaceStatus[] = useMemo(
    () => spaceData?.space_statuses || spaceData?.statuses || listData?.space_statuses || [],
    [spaceData, listData],
  );

  // Same fetch + nesting as ListView.
  const { data: flatTasks, isLoading } = useTasks(listId, { includeSubtasks: true });
  const tasks = useMemo(() => nestSubtasks(flatTasks ?? []), [flatTasks]);

  // Same per-list ephemeral toggles the section uses.
  const listScopeKey = listId ? `list:${listId}` : '';
  const focusToday = !!(listScopeKey && focusTodayScope[listScopeKey]);

  // Same filter + sort pipeline as ListView (subtask-aware, no search box here).
  const filteredTasks = useMemo(() => {
    const matches = (t: Task): boolean => {
      if (filterTasks([t], filters, tz).length === 0) return false;
      if (myTasksOnly) {
        if (!currentUserId) return false;
        const assignees = (t.assignees || []) as { id: string }[];
        if (!assignees.some((a) => a.id === currentUserId)) return false;
      }
      if (focusToday && !isTaskFocused(t)) return false;
      return true;
    };
    let arr = filterWithSubtasks(tasks, matches);
    arr = sortBy !== 'manual' ? sortTasks(arr, sortBy) : sortByCreationOrder(arr);
    return arr;
  }, [tasks, filters, myTasksOnly, currentUserId, tz, focusToday, sortBy]);

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
    return groupTasksByStatus(filteredTasks, statuses, fadingTaskIds).filter((g) => g.tasks.length > 0);
  }, [filteredTasks, statuses, groupBy, fadingTaskIds]);

  const genericGroups = useMemo(() => {
    if (groupBy === 'status' || groupBy === 'none') return null;
    return groupTasksGeneric(openTasks, groupBy, tz, fadingTaskIds).filter((g) => g.tasks.length > 0);
  }, [openTasks, groupBy, tz, fadingTaskIds]);

  const openTask = (t: Task) => {
    // Same as the inbox panel: back the detail overlay with a My Tasks tab so
    // closing it lands somewhere sensible, preserving the current tab.
    useTabsStore.getState().openInNewTab(buildHomeSnapshot('my-tasks'));
    setActiveTask(t.id);
    onClose();
  };

  const renderCapped = (rows: Task[]) => {
    const shown = rows.slice(0, MAX_ROWS_PER_GROUP);
    return (
      <>
        {shown.map((t) => (
          <PreviewRow key={t.id} task={t} listId={listId!} onOpen={openTask} />
        ))}
        {rows.length > shown.length && (
          <button
            type="button"
            onClick={() => { onOpenSection(); }}
            className="block w-full px-5 py-1.5 text-left text-[11.5px] font-medium text-[var(--sh-ink-3)] transition hover:text-[var(--sh-ink)]"
          >
            +{rows.length - shown.length} more — open section
          </button>
        )}
      </>
    );
  };

  return (
    <>
      {pinned && <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />}

      <div
        className="inbox-slider-panel sh-view fixed left-2 right-2 top-14 z-50 flex max-h-[calc(100dvh-72px)] flex-col overflow-hidden rounded-[14px] border border-[var(--sh-hair)] bg-[var(--surface)] md:left-[76px] md:right-auto md:top-3 md:max-h-[calc(100dvh-24px)] md:w-[520px]"
        style={{ boxShadow: '0 18px 50px rgba(10, 10, 10, 0.16), 0 2px 8px rgba(10, 10, 10, 0.06)' }}
        onPointerEnter={onHoverEnter}
        onPointerLeave={onHoverLeave}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 pb-3 pt-4">
          <svg className="h-[18px] w-[18px] text-[var(--sh-ink)]" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M8.4 3.8h7.2a4.6 4.6 0 0 1 4.6 4.6v7.2a4.6 4.6 0 0 1-4.6 4.6H8.4a4.6 4.6 0 0 1-4.6-4.6V8.4a4.6 4.6 0 0 1 4.6-4.6z" />
            <path d="m8.4 12.1 2.5 2.5 4.7-5.2" fill="none" stroke="var(--surface)" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h3 className="text-[15px] font-semibold text-[var(--sh-ink)]">My Tasks</h3>
          {openTasks.length > 0 && (
            <span className="grid h-[18px] min-w-[18px] place-items-center rounded-[5px] bg-[var(--sh-ink)] px-1 text-[10.5px] font-semibold leading-none text-[var(--surface)]">
              {openTasks.length}
            </span>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tasks preview"
            className="grid h-7 w-7 place-items-center rounded-[8px] text-[var(--sh-ink-3)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Grouping summary — read-only mirror of the section's active view */}
        <div className="flex items-center gap-2 border-b border-[var(--sh-hair)] px-5 pb-2.5">
          <span className="text-[11.5px] text-[var(--sh-ink-3)]">
            Grouped by {groupLabel} · {sortLabel}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => { onOpenSection(); }}
            className="text-[11.5px] font-medium text-[var(--sh-ink-3)] transition hover:text-[var(--sh-ink)]"
          >
            Open section →
          </button>
        </div>

        {/* Groups */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {isLoading && !flatTasks ? (
            <div className="px-5 py-8 text-[13px] text-[var(--sh-ink-3)]">Loading…</div>
          ) : !listId || filteredTasks.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-[var(--sh-ink-3)]">
              No tasks yet. Press + to add one.
            </div>
          ) : (
            <>
              {focusGroup && (
                <>
                  <GroupHeader label={focusGroup.label} count={focusGroup.tasks.length} dotColor="#f59e0b" />
                  {renderCapped(focusGroup.tasks)}
                </>
              )}
              {statusGroups
                ? statusGroups.map(({ status, tasks: rows }) => (
                    <div key={status.id}>
                      <GroupHeader label={status.name} count={rows.length} dotColor={status.color} />
                      {renderCapped(rows)}
                    </div>
                  ))
                : groupBy === 'none' ? (
                    <>
                      <GroupHeader label="All tasks" count={openTasks.length} />
                      {renderCapped(openTasks)}
                    </>
                  )
                : genericGroups?.map((g) => (
                    <div key={g.key}>
                      <GroupHeader label={g.label} count={g.tasks.length} />
                      {renderCapped(g.tasks)}
                    </div>
                  ))}
              {groupBy !== 'status' && completedTasks.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setCompletedOpen((v) => !v)}
                    className="flex w-full items-center gap-2 px-5 pb-1 pt-3 text-left"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: '#7c3aed' }} />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--sh-ink-3)]">
                      Completed
                    </span>
                    <span className="text-[11px] tabular-nums text-[var(--sh-ink-4)]">{completedTasks.length}</span>
                    <svg
                      className={`ml-auto h-3.5 w-3.5 text-[var(--sh-ink-4)] transition-transform ${completedOpen ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                  {completedOpen && renderCapped(completedTasks)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
