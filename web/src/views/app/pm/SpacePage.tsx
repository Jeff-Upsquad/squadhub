import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Folder, List, Space, SpaceStatus, Task } from '@squadhub/shared';
import api from '../../../services/api';
import { usePMStore } from '../../../stores/pmStore';
import { useSpace } from '../../../hooks/useSpaces';
import TaskGroupCard from './TaskGroupCard';
import { GROUP_BY_OPTIONS, groupTasks, partitionByCompletion, buildFocusTodayGroup, type GroupBy } from '../../../lib/taskGrouping';
import FilterBar from '../../../components/pm/FilterBar';
import GroupByDropdown from '../../../components/pm/GroupByDropdown';
import ViewSearchInput from '../../../components/pm/ViewSearchInput';
import {
  EMPTY_FILTER,
  countActiveFilters,
  deriveAssigneeOptions,
  deriveTagOptions,
  filterTasks,
} from '../../../lib/filters';

type SpaceWithChildren = Space & { folders?: (Folder & { lists?: List[] })[]; lists?: List[] };

type ListWithFolder = List & { folder?: { id: string; name: string } | null };

const NO_FOLDER_KEY = '__none__';

export default function SpacePage() {
  const activeSpacePageId = usePMStore((s) => s.activeSpacePageId);
  const setContextListId = usePMStore((s) => s.setContextListId);
  const filtersByScope = usePMStore((s) => s.filtersByScope);
  const setScopeFilters = usePMStore((s) => s.setScopeFilters);
  const clearScopeFilters = usePMStore((s) => s.clearScopeFilters);
  const groupByScope = usePMStore((s) => s.groupByScope);
  const setScopedGroupBy = usePMStore((s) => s.setScopedGroupBy);
  const fadingTaskIds = usePMStore((s) => s.fadingTaskIds);
  const [folderFilter, setFolderFilter] = useState<string>('all');
  const [listFilter, setListFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const groupScopeKey = activeSpacePageId ? `space:${activeSpacePageId}` : '';
  const groupBy = (groupScopeKey && groupByScope[groupScopeKey]) || 'none';

  const scopeKey = activeSpacePageId ? `space:${activeSpacePageId}` : '';
  const filters = (scopeKey && filtersByScope[scopeKey]) || EMPTY_FILTER;

  const { data: space } = useSpace(activeSpacePageId) as { data: SpaceWithChildren | undefined };

  useEffect(() => {
    setFolderFilter('all');
    setListFilter('all');
  }, [activeSpacePageId]);

  useEffect(() => {
    setListFilter('all');
  }, [folderFilter]);

  useEffect(() => {
    setContextListId(listFilter === 'all' ? null : listFilter);
  }, [listFilter, setContextListId]);

  const allLists: ListWithFolder[] = useMemo(() => {
    if (!space) return [];
    const out: ListWithFolder[] = [];
    for (const f of space.folders ?? []) {
      for (const l of f.lists ?? []) {
        out.push({ ...l, folder: { id: f.id, name: f.name } });
      }
    }
    for (const l of space.lists ?? []) {
      out.push({ ...l, folder: null });
    }
    return out;
  }, [space]);

  const hasDirectLists = useMemo(() => (space?.lists ?? []).length > 0, [space]);

  const visibleLists: ListWithFolder[] = useMemo(() => {
    if (folderFilter === 'all') return allLists;
    if (folderFilter === NO_FOLDER_KEY) return allLists.filter((l) => !l.folder);
    return allLists.filter((l) => l.folder?.id === folderFilter);
  }, [allLists, folderFilter]);

  const taskQueries = useQueries({
    queries: allLists.map((l) => ({
      queryKey: ['space-tasks', activeSpacePageId, l.id],
      queryFn: async () => {
        const res = await api.get(`/pm/tasks?list_id=${l.id}`);
        return { listId: l.id, listName: l.name, folder: l.folder, tasks: (res.data.data || []) as Task[] };
      },
      enabled: !!activeSpacePageId,
    })),
  });

  const isLoading = taskQueries.some((q) => q.isLoading || q.isFetching);

  const allTasks = useMemo<Task[]>(() => {
    const out: Task[] = [];
    for (const q of taskQueries) {
      if (!q.data) continue;
      for (const t of q.data.tasks) {
        out.push({
          ...t,
          list: t.list ?? { id: q.data.listId, name: q.data.listName },
          folder: (t as Task).folder ?? q.data.folder ?? null,
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskQueries.map((q) => q.dataUpdatedAt).join('|')]);

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const tasksAfterPills = useMemo(() => {
    let arr = allTasks;
    if (folderFilter === NO_FOLDER_KEY) {
      arr = arr.filter((t) => !t.folder);
    } else if (folderFilter !== 'all') {
      arr = arr.filter((t) => t.folder?.id === folderFilter);
    }
    if (listFilter !== 'all') {
      arr = arr.filter((t) => t.list?.id === listFilter);
    }
    return arr;
  }, [allTasks, folderFilter, listFilter]);

  const filteredTasks = useMemo(() => {
    let arr = filterTasks(tasksAfterPills, filters, tz);
    const q = searchQuery.trim().toLowerCase();
    if (q) arr = arr.filter((t) => t.title.toLowerCase().includes(q));
    return arr;
  }, [tasksAfterPills, filters, tz, searchQuery]);

  const spaceStatuses: SpaceStatus[] = useMemo(
    () => ((space as unknown as { space_statuses?: SpaceStatus[] } | undefined)?.space_statuses ?? []),
    [space],
  );
  const assigneeOptions = useMemo(() => deriveAssigneeOptions(tasksAfterPills), [tasksAfterPills]);
  const tagOptions = useMemo(() => deriveTagOptions(tasksAfterPills), [tasksAfterPills]);
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
    return buildFocusTodayGroup(openTasks, tz);
  }, [openTasks, tz]);

  if (!activeSpacePageId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <svg className="mx-auto mb-3 h-12 w-12 text-[var(--sh-ink-4)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
          </svg>
          <p className="text-sm text-[var(--sh-ink-3)]">Select a space to view tasks</p>
        </div>
      </div>
    );
  }

  const totalCount = allTasks.length;
  const filteredCount = filteredTasks.length;
  const noopStatusChange = () => {};

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--sh-hair)] bg-[var(--surface)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className="flex h-[22px] w-[22px] items-center justify-center rounded text-[11px] font-bold text-white"
            style={{ backgroundColor: space?.color || '#7c3aed' }}
          >
            {space?.name?.[0]?.toUpperCase() || 'S'}
          </span>
          <span className="text-sm font-medium text-[var(--sh-ink)]">{space?.name || 'Space'}</span>
          <span className="text-xs text-[var(--sh-ink-3)]">· {totalCount} task{totalCount === 1 ? '' : 's'}</span>
        </div>
        <ViewSearchInput value={searchQuery} onChange={setSearchQuery} />
      </div>

      {/* Folders filter pills */}
      <div className="sh-view dl-groupby shrink-0">
        <span className="dl-groupby-lbl">Folders</span>
        <div
          className="pill"
          data-active={folderFilter === 'all'}
          onClick={() => setFolderFilter('all')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setFolderFilter('all');
            }
          }}
        >
          All
        </div>
        {(space?.folders ?? []).map((f) => (
          <div
            key={f.id}
            className="pill"
            data-active={folderFilter === f.id}
            onClick={() => setFolderFilter(f.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setFolderFilter(f.id);
              }
            }}
          >
            {f.name}
          </div>
        ))}
        {hasDirectLists && (
          <div
            className="pill"
            data-active={folderFilter === NO_FOLDER_KEY}
            onClick={() => setFolderFilter(NO_FOLDER_KEY)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setFolderFilter(NO_FOLDER_KEY);
              }
            }}
          >
            No folder
          </div>
        )}
      </div>

      {/* Lists filter pills */}
      <div className="sh-view dl-groupby shrink-0">
        <span className="dl-groupby-lbl">Lists</span>
        <div
          className="pill"
          data-active={listFilter === 'all'}
          onClick={() => setListFilter('all')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setListFilter('all');
            }
          }}
        >
          All
        </div>
        {visibleLists.map((l) => (
          <div
            key={l.id}
            className="pill"
            data-active={listFilter === l.id}
            onClick={() => setListFilter(l.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setListFilter(l.id);
              }
            }}
          >
            {l.name}
          </div>
        ))}
      </div>

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
        ) : allLists.length === 0 ? (
          <div style={{ padding: '28px 20px', fontSize: 13, color: 'var(--sh-ink-3)' }}>
            This space has no lists yet.
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
              'No tasks match the current filters.'
            )}
          </div>
        ) : (
          <>
            {focusGroup && (
              <TaskGroupCard
                groupKey="focus_today"
                label={focusGroup.label}
                dotColor="#f59e0b"
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
                groupKey="sp-all"
                label="All tasks"
                tasks={openTasks}
                allStatuses={spaceStatuses}
                listId={null}
                onStatusChange={noopStatusChange}
                canEdit
                showAddRow={false}
              />
            ) : (
              groups.map((g) => (
                <TaskGroupCard
                  key={g.key}
                  groupKey={`sp:${g.key}`}
                  label={g.label}
                  tasks={g.tasks}
                  allStatuses={spaceStatuses}
                  listId={null}
                  onStatusChange={noopStatusChange}
                  canEdit
                  showAddRow={false}
                />
              ))
            )}
            {completedTasks.length > 0 && (
              <TaskGroupCard
                groupKey="sp-completed"
                label="Completed"
                dotColor="#10b981"
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
