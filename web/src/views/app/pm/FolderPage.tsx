import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { Folder, List, SpaceStatus, Task } from '@squadhub/shared';
import api from '../../../services/api';
import { usePMStore } from '../../../stores/pmStore';
import { useSpace } from '../../../hooks/useSpaces';
import ContainerChatButton from '../../../components/pm/ContainerChatButton';
import ClientFolderReport from './client-design/ClientFolderReport';
import TaskOverview from './TaskOverview';

type FolderWithLists = Folder & { lists?: List[] };

export default function FolderPage({ folderId: propFolderId }: { folderId?: string } = {}) {
  // When a folderId is passed (the tab strip renders each open tab from its own
  // snapshot), it overrides the global store so sibling tabs can show different
  // folders at once. Falls back to the store for normal single-view navigation.
  const storeFolderId = usePMStore((s) => s.activeFolderId);
  const activeFolderId = propFolderId ?? storeFolderId;
  const setContextListId = usePMStore((s) => s.setContextListId);
  const [listFilter, setListFilter] = useState<string>('all');

  useEffect(() => {
    setListFilter('all');
  }, [activeFolderId]);

  // New tasks created from this page land in the selected list.
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

  const taskQueries = useQueries({
    queries: lists.map((l) => ({
      queryKey: ['folder-tasks', activeFolderId, l.id],
      queryFn: async () => {
        const res = await api.get(`/pm/tasks?list_id=${l.id}&include_subtasks=true`);
        return { listId: l.id, listName: l.name, tasks: (res.data.data || []) as Task[] };
      },
      enabled: !!activeFolderId,
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
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskQueries.map((q) => q.dataUpdatedAt).join('|')]);

  // Space-level statuses resolve lists still on the basic To Do / In
  // Progress / Done set; managed workflows come from the status directory.
  const spaceStatuses: SpaceStatus[] = useMemo(
    () => (parentSpace as unknown as { space_statuses?: SpaceStatus[] } | undefined)?.space_statuses ?? [],
    [parentSpace],
  );

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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TaskOverview
        title={folder?.name || 'Folder'}
        tasks={allTasks}
        lists={lists.map((l) => ({ id: l.id, name: l.name }))}
        listFilter={listFilter}
        onListFilter={setListFilter}
        scopeKey={`folder:${activeFolderId}`}
        statusFallback={spaceStatuses}
        loading={isLoading}
        headerExtra={
          <ContainerChatButton
            resourceType="folder"
            resourceId={activeFolderId}
            name={folder?.name || 'Folder'}
            accessLevel={(folder as { my_access_level?: string } | undefined)?.my_access_level}
          />
        }
      />
    </div>
  );
}
