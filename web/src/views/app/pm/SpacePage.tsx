import { useEffect, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { Folder, List, Space, SpaceStatus, Task } from '@squadhub/shared';
import api from '../../../services/api';
import { usePMStore } from '../../../stores/pmStore';
import { useSpace } from '../../../hooks/useSpaces';
import ContainerChatButton from '../../../components/pm/ContainerChatButton';
import TaskOverview from './TaskOverview';

type SpaceWithChildren = Space & { folders?: (Folder & { lists?: List[] })[]; lists?: List[] };

type ListWithFolder = List & { folder?: { id: string; name: string } | null };

export default function SpacePage({ spacePageId: propSpacePageId }: { spacePageId?: string } = {}) {
  // When a spacePageId is passed (the tab strip renders each open tab from its
  // own snapshot), it overrides the global store so sibling tabs can show
  // different spaces at once. Falls back to the store for normal navigation.
  const storeSpacePageId = usePMStore((s) => s.activeSpacePageId);
  const activeSpacePageId = propSpacePageId ?? storeSpacePageId;
  const setContextListId = usePMStore((s) => s.setContextListId);
  const [listFilter, setListFilter] = useState<string>('all');

  const { data: space } = useSpace(activeSpacePageId) as { data: SpaceWithChildren | undefined };

  useEffect(() => {
    setListFilter('all');
  }, [activeSpacePageId]);

  // New tasks created from this page land in the selected list.
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

  const taskQueries = useQueries({
    queries: allLists.map((l) => ({
      queryKey: ['space-tasks', activeSpacePageId, l.id],
      queryFn: async () => {
        const res = await api.get(`/pm/tasks?list_id=${l.id}&include_subtasks=true`);
        return { listId: l.id, listName: l.name, folder: l.folder, tasks: (res.data.data || []) as Task[] };
      },
      enabled: !!activeSpacePageId,
    })),
  });

  const isLoading = taskQueries.some((q) => q.isLoading);

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

  // Space-level statuses resolve lists still on the basic To Do / In
  // Progress / Done set; managed workflows come from the status directory.
  const spaceStatuses: SpaceStatus[] = useMemo(
    () => (space as unknown as { space_statuses?: SpaceStatus[] } | undefined)?.space_statuses ?? [],
    [space],
  );

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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TaskOverview
        title={space?.name || 'Space'}
        tasks={allTasks}
        lists={allLists.map((l) => ({ id: l.id, name: l.name }))}
        listFilter={listFilter}
        onListFilter={setListFilter}
        scopeKey={`space:${activeSpacePageId}`}
        statusFallback={spaceStatuses}
        loading={isLoading}
        headerExtra={
          <ContainerChatButton
            resourceType="space"
            resourceId={activeSpacePageId}
            name={space?.name || 'Space'}
            accessLevel={space?.my_access_level}
          />
        }
      />
    </div>
  );
}
