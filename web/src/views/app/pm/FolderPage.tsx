import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Folder, List, SpaceStatus, Task } from '@squadhub/shared';
import api from '../../../services/api';
import { usePMStore } from '../../../stores/pmStore';
import { useSpace, useReorderLists } from '../../../hooks/useSpaces';
import TaskGroupCard from './TaskGroupCard';
import { GROUP_BY_OPTIONS, groupTasks, partitionByCompletion, buildFocusTodayGroup, isTaskCompleted, type GroupBy } from '../../../lib/taskGrouping';
import FilterBar from '../../../components/pm/FilterBar';
import GroupByDropdown from '../../../components/pm/GroupByDropdown';
import ViewSearchInput from '../../../components/pm/ViewSearchInput';
import ContainerChatButton from '../../../components/pm/ContainerChatButton';
import ListChipsFilter from '../../../components/pm/ListChipsFilter';
import ClientFolderReport from './client-design/ClientFolderReport';
import {
  EMPTY_FILTER,
  countActiveFilters,
  deriveAssigneeOptions,
  deriveTagOptions,
  filterTasks,
} from '../../../lib/filters';

type FolderWithLists = Folder & { lists?: List[] };

export default function FolderPage({ folderId: propFolderId }: { folderId?: string } = {}) {
  const qc = useQueryClient();
  const reorderLists = useReorderLists();
  // When a folderId is passed (the tab strip renders each open tab from its own
  // snapshot), it overrides the global store so sibling tabs can show different
  // folders at once. Falls back to the store for normal single-view navigation.
  const storeFolderId = usePMStore((s) => s.activeFolderId);
  const activeFolderId = propFolderId ?? storeFolderId;
  const setContextListId = usePMStore((s) => s.setContextListId);
  const filtersByScope = usePMStore((s) => s.filtersByScope);
  const setScopeFilters = usePMStore((s) => s.setScopeFilters);
  const clearScopeFilters = usePMStore((s) => s.clearScopeFilters);
  const groupByScope = usePMStore((s) => s.groupByScope);
  const setScopedGroupBy = usePMStore((s) => s.setScopedGroupBy);
  const fadingTaskIds = usePMStore((s) => s.fadingTaskIds);
  const [listFilter, setListFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const groupScopeKey = activeFolderId ? `folder:${activeFolderId}` : '';
  const groupBy = (groupScopeKey && groupByScope[groupScopeKey]) || 'none';

  const scopeKey = activeFolderId ? `folder:${activeFolderId}` : '';
  const filters = (scopeKey && filtersByScope[scopeKey]) || EMPTY_FILTER;

  useEffect(() => {
    setContextListId(listFilter === 'all' ? null : listFilter);
  }, [listFilter, setContextListId]);

  const { data: folder } = useQuery<FolderWithLists>({
    queryKey: ['folder', activeFolderId],
    queryFn: async () => {
      const res = await api.get(`/pm/folders/${activeFolderId}`);
      return res.data.data;
    },
    enabled: !!activeFolderId,
  });

  const lists: List[] = useMemo(() => folder?.lists ?? [], [folder]);

  const { data: parentSpace } = useSpace(folder?.space_id ?? null);
  const spaceStatuses: SpaceStatus[] = useMemo(
    () => ((parentSpace as unknown as { space_statuses?: SpaceStatus[] } | undefined)?.space_statuses ?? []),
    [parentSpace],
  );

  const taskQueries = useQueries({
    queries: lists.map((l) => ({
      queryKey: ['folder-tasks', activeFolderId, l.id],
      queryFn: async () => {
        const res = await api.get(`/pm/tasks?list_id=${l.id}`);
        return { listId: l.id, listName: l.name, tasks: (res.data.data || []) as Task[] };
      },
      enabled: !!activeFolderId,
    })),
  });

  const isLoading = taskQueries.some((q) => q.isLoading || q.isFetching);

  // Live per-list OPEN task counts for the list chips (completed/closed
  // excluded, matching how the view itself partitions tasks).
  const listCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const q of taskQueries) {
      if (q.data) m[q.data.listId] = q.data.tasks.filter((t) => !isTaskCompleted(t)).length;
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskQueries.map((q) => q.dataUpdatedAt).join('|')]);

  const allTasks = useMemo<Task[]>(() => {
    const out: Task[] = [];
    for (const q of taskQueries) {
      if (!q.data) continue;
      for (const t of q.data.tasks) {
        out.push({
          ...t,
          list: t.list ?? { id: q.data.listId, name: q.data.listName },
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskQueries.map((q) => q.dataUpdatedAt).join('|')]);

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const filteredTasks = useMemo(() => {
    let arr = allTasks;
    if (listFilter !== 'all') arr = arr.filter((t) => t.list?.id === listFilter);
    arr = filterTasks(arr, filters, tz);
    const q = searchQuery.trim().toLowerCase();
    if (q) arr = arr.filter((t) => t.title.toLowerCase().includes(q));
    return arr;
  }, [allTasks, listFilter, filters, tz, searchQuery]);

  const optionSourceTasks = useMemo(
    () => (listFilter === 'all' ? allTasks : allTasks.filter((t) => t.list?.id === listFilter)),
    [allTasks, listFilter],
  );
  const assigneeOptions = useMemo(() => deriveAssigneeOptions(optionSourceTasks), [optionSourceTasks]);
  const tagOptions = useMemo(() => deriveTagOptions(optionSourceTasks), [optionSourceTasks]);
  const activeFilterCount = countActiveFilters(filters);

  const { open: openTasks, completed: completedTasks } = useMemo(
    () => partitionByCompletion(filteredTasks, fadingTaskIds),
    [filteredTasks, fadingTaskIds],
  );

  const groups = useMemo(() => {
    if (groupBy === 'none') return [];
    return groupTasks(openTasks, groupBy, tz, fadingTaskIds);
  }, [openTasks, groupBy, tz, fadingTaskIds]);

  const focusGroup = useMemo(() => {
    return buildFocusTodayGroup(openTasks);
  }, [openTasks]);

  if (!activeFolderId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <svg className="mx-auto mb-3 h-12 w-12 text-[var(--sh-ink-4)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <p className="text-sm text-[var(--sh-ink-3)]">Select a folder to view tasks</p>
        </div>
      </div>
    );
  }

  // A client folder holds no direct lists — its child design/video spaces hang
  // off it. Render the per-space report (tabbed) instead of the empty task list.
  if (folder?.folder_type === 'client') {
    return <ClientFolderReport folder={folder} />;
  }

  const totalCount = allTasks.length;
  const filteredCount = filteredTasks.length;
  const noopStatusChange = () => {};

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--sh-hair)] bg-[var(--surface)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-[var(--sh-ink-3)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="text-sm font-medium text-[var(--sh-ink)]">{folder?.name || 'Folder'}</span>
          <span className="text-xs text-[var(--sh-ink-3)]">· {totalCount} task{totalCount === 1 ? '' : 's'}</span>
        </div>
        <div className="flex items-center gap-2">
          <ViewSearchInput value={searchQuery} onChange={setSearchQuery} />
          {activeFolderId && (
            <ContainerChatButton
              resourceType="folder"
              resourceId={activeFolderId}
              name={folder?.name || 'Folder'}
              accessLevel={(folder as { my_access_level?: string } | undefined)?.my_access_level}
            />
          )}
        </div>
      </div>

      {/* List chips (with task counts; empty lists collapse into a dropdown).
          Drag chips to reorder — persists via POST /pm/lists/reorder. */}
      <ListChipsFilter
        label="List"
        lists={lists}
        counts={listCounts}
        value={listFilter}
        onChange={setListFilter}
        myAccess={folder?.my_access_level}
        onReorder={(orderedIds) => {
          if (!folder) return;
          reorderLists.mutate({ space_id: folder.space_id, folder_id: activeFolderId, ordered_ids: orderedIds });
        }}
        onSettingsClosed={() => qc.invalidateQueries({ queryKey: ['folder', activeFolderId] })}
      />

      {/* Group by dropdown + Filter */}
      <div className="lv-subtoolbar shrink-0">
        <span className="st-label">Group by</span>
        <GroupByDropdown
          options={GROUP_BY_OPTIONS}
          value={groupBy}
          onChange={(v) => groupScopeKey && setScopedGroupBy(groupScopeKey, v as GroupBy)}
        />
        <div className="st-divider" />
        <FilterBar
          filters={filters}
          onChange={(next) => scopeKey && setScopeFilters(scopeKey, next)}
          statuses={spaceStatuses}
          assigneeOptions={assigneeOptions}
          tagOptions={tagOptions}
        />
      </div>

      {/* Body */}
      <div className="td-scroll lv-card-canvas" style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading && allTasks.length === 0 ? (
          <div style={{ padding: 24, fontSize: 12, color: 'var(--sh-ink-3)' }}>Loading…</div>
        ) : lists.length === 0 ? (
          <div style={{ padding: '28px 20px', fontSize: 13, color: 'var(--sh-ink-3)' }}>
            This folder has no lists yet.
          </div>
        ) : filteredCount === 0 ? (
          <div style={{ padding: '28px 20px', fontSize: 13, color: 'var(--sh-ink-3)' }}>
            {activeFilterCount > 0 ? (
              <>
                No tasks match the current filters.{' '}
                <button
                  type="button"
                  onClick={() => scopeKey && clearScopeFilters(scopeKey)}
                  style={{ color: 'var(--sh-ink)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}
                >
                  Clear filters
                </button>
              </>
            ) : (
              'No tasks in this folder yet.'
            )}
          </div>
        ) : (
          <>
            {focusGroup && (
              <TaskGroupCard
                groupKey="focus_today"
                label={focusGroup.label}
                dotColor="#f59e0b"
                variant="focus"
                tasks={focusGroup.tasks}
                allStatuses={spaceStatuses}
                listId={null}
                onStatusChange={noopStatusChange}
                canEdit
                showAddRow={false}
              />
            )}
            {groupBy === 'none' ? (
              <TaskGroupCard
                groupKey="fl-all"
                label="All tasks"
                tasks={openTasks}
                allStatuses={spaceStatuses}
                listId={null}
                onStatusChange={noopStatusChange}
                canEdit
                showAddRow={false}
                dimFocused={!!focusGroup}
              />
            ) : (
              groups.map((g) => (
                <TaskGroupCard
                  key={g.key}
                  groupKey={`fl:${g.key}`}
                  label={g.label}
                  tasks={g.tasks}
                  allStatuses={spaceStatuses}
                  listId={null}
                  onStatusChange={noopStatusChange}
                  canEdit
                  showAddRow={false}
                  dimFocused={!!focusGroup}
                />
              ))
            )}
            {completedTasks.length > 0 && (
              <TaskGroupCard
                groupKey="fl-completed"
                label="Completed"
                dotColor="#7c3aed"
                tasks={completedTasks}
                allStatuses={spaceStatuses}
                listId={null}
                onStatusChange={noopStatusChange}
                canEdit
                showAddRow={false}
                defaultCollapsed
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
