import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { Folder, List, Task } from '@squadhub/shared';
import api from '../../../services/api';
import { usePMStore } from '../../../stores/pmStore';
import DashboardTaskRow from '../home/DashboardTaskRow';
import CompletedSection from './CompletedSection';
import { GROUP_BY_OPTIONS, groupTasks, partitionByCompletion, type GroupBy } from '../../../lib/taskGrouping';

type FolderWithLists = Folder & { lists?: List[] };

export default function FolderPage() {
  const activeFolderId = usePMStore((s) => s.activeFolderId);
  const setContextListId = usePMStore((s) => s.setContextListId);
  const [listFilter, setListFilter] = useState<string>('all');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');

  // Mirror the list filter into the store so the global + button prefills it
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

  const filteredTasks = useMemo(() => {
    if (listFilter === 'all') return allTasks;
    return allTasks.filter((t) => t.list?.id === listFilter);
  }, [allTasks, listFilter]);

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const { open: openTasks, completed: completedTasks } = useMemo(
    () => partitionByCompletion(filteredTasks),
    [filteredTasks],
  );

  const groups = useMemo(() => {
    if (groupBy === 'none') return [];
    return groupTasks(openTasks, groupBy, tz);
  }, [openTasks, groupBy, tz]);

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

  const totalCount = allTasks.length;
  const filteredCount = filteredTasks.length;
  const activeListName = listFilter === 'all' ? null : lists.find((l) => l.id === listFilter)?.name;

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
      </div>

      {/* List filter pills */}
      <div className="sh-view dl-groupby shrink-0">
        <span className="dl-groupby-lbl">List</span>
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
        {lists.map((l) => (
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
        ) : lists.length === 0 ? (
          <div style={{ padding: '28px 20px', fontSize: 13, color: 'var(--sh-ink-3)' }}>
            This folder has no lists yet.
          </div>
        ) : filteredCount === 0 ? (
          <div style={{ padding: '28px 20px', fontSize: 13, color: 'var(--sh-ink-3)' }}>
            {activeListName ? `No tasks in ${activeListName}.` : 'No tasks in this folder yet.'}
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
