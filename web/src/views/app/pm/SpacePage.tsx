import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Folder, List, Space, Task } from '@squadhub/shared';
import api from '../../../services/api';
import { usePMStore } from '../../../stores/pmStore';
import { useSpace } from '../../../hooks/useSpaces';
import DashboardTaskRow from '../home/DashboardTaskRow';
import CompletedSection from './CompletedSection';
import { GROUP_BY_OPTIONS, groupTasks, partitionByCompletion, type GroupBy } from '../../../lib/taskGrouping';

type SpaceWithChildren = Space & { folders?: (Folder & { lists?: List[] })[]; lists?: List[] };

type ListWithFolder = List & { folder?: { id: string; name: string } | null };

const NO_FOLDER_KEY = '__none__';

export default function SpacePage() {
  const activeSpacePageId = usePMStore((s) => s.activeSpacePageId);
  const setContextListId = usePMStore((s) => s.setContextListId);
  const [folderFilter, setFolderFilter] = useState<string>('all');
  const [listFilter, setListFilter] = useState<string>('all');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');

  const { data: space } = useSpace(activeSpacePageId) as { data: SpaceWithChildren | undefined };

  // Reset child filters when switching spaces or when folder filter changes
  useEffect(() => {
    setFolderFilter('all');
    setListFilter('all');
    setGroupBy('none');
  }, [activeSpacePageId]);

  useEffect(() => {
    setListFilter('all');
  }, [folderFilter]);

  // Mirror the list filter into the store so the global + button prefills it
  useEffect(() => {
    setContextListId(listFilter === 'all' ? null : listFilter);
  }, [listFilter, setContextListId]);

  // Flatten: every list in the space, stamped with its folder (or null for direct)
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

  // Lists visible in the Lists pill row, based on current folder filter
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

  const filteredTasks = useMemo(() => {
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

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const { open: openTasks, completed: completedTasks } = useMemo(
    () => partitionByCompletion(filteredTasks),
    [filteredTasks],
  );

  const groups = useMemo(() => {
    if (groupBy === 'none') return [];
    return groupTasks(openTasks, groupBy, tz);
  }, [openTasks, groupBy, tz]);

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
  const activeListName = listFilter === 'all' ? null : visibleLists.find((l) => l.id === listFilter)?.name;

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

      {/* Lists filter pills (narrowed by selected folder) */}
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

      {/* Group by pills */}
      <div className="sh-view dl-groupby shrink-0">
        <span className="dl-groupby-lbl">Group by</span>
        {GROUP_BY_OPTIONS.map((opt) => (
          <div
            key={opt.value}
            className="pill"
            data-active={groupBy === opt.value}
            onClick={() => setGroupBy(opt.value)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setGroupBy(opt.value);
              }
            }}
          >
            {opt.label}
          </div>
        ))}
      </div>

      {/* Body */}
      <div className="td-scroll sh-view" style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading && allTasks.length === 0 ? (
          <div style={{ padding: 24, fontSize: 12, color: 'var(--sh-ink-3)' }}>Loading…</div>
        ) : allLists.length === 0 ? (
          <div style={{ padding: '28px 20px', fontSize: 13, color: 'var(--sh-ink-3)' }}>
            This space has no lists yet.
          </div>
        ) : filteredCount === 0 ? (
          <div style={{ padding: '28px 20px', fontSize: 13, color: 'var(--sh-ink-3)' }}>
            {activeListName ? `No tasks in ${activeListName}.` : 'No tasks match the current filters.'}
          </div>
        ) : (
          <>
            {groupBy === 'none' ? (
              <div className="today-list">
                {openTasks.map((t) => (
                  <DashboardTaskRow key={t.id} task={t} />
                ))}
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.key} className="today-group">
                  <div className="today-group-head">
                    <span>{g.label}</span>
                    <span className="count">· {g.tasks.length}</span>
                  </div>
                  <div className="today-list">
                    {g.tasks.map((t) => (
                      <DashboardTaskRow key={t.id} task={t} />
                    ))}
                  </div>
                </div>
              ))
            )}
            <CompletedSection tasks={completedTasks} />
          </>
        )}
      </div>
    </div>
  );
}
