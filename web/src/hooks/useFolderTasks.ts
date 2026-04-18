import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import api from '../services/api';
import type { Task, Folder } from '@squadhub/shared';
import type { RequestStatus } from '../views/app/pm/client-design/atoms/StatusPill';
import type { RequestRowData } from '../views/app/pm/client-design/atoms/RequestRow';

export interface FolderDetail extends Folder {
  lists?: (NonNullable<Folder['lists']>[number] & { name: string; id: string })[];
}

export function useFolder(folderId: string | null) {
  return useQuery<FolderDetail>({
    queryKey: ['folder', folderId],
    queryFn: async () => {
      const res = await api.get(`/pm/folders/${folderId}`);
      return res.data.data;
    },
    enabled: !!folderId,
  });
}

function listNameToStatus(name: string): RequestStatus | null {
  const n = name.trim().toLowerCase();
  if (n === 'briefs' || n === 'queued' || n === 'queue') return 'queued';
  if (n === 'in progress' || n === 'in-progress' || n === 'progress') return 'progress';
  if (n === 'reviews' || n === 'review' || n === 'in review') return 'review';
  if (n === 'completed' || n === 'done') return 'done';
  return null;
}

export interface FolderTasksResult {
  isLoading: boolean;
  requests: RequestRowData[];
  folder: FolderDetail | undefined;
  listByStatus: Record<RequestStatus, { id: string; name: string } | null>;
  byStatus: Record<RequestStatus, RequestRowData[]>;
}

export function useFolderTasks(folderId: string | null): FolderTasksResult {
  const folderQuery = useFolder(folderId);
  const folder = folderQuery.data;
  const lists = folder?.lists || [];

  const taskQueries = useQueries({
    queries: lists.map((l) => ({
      queryKey: ['folder-tasks', folderId, l.id],
      queryFn: async () => {
        const res = await api.get(`/pm/tasks?list_id=${l.id}`);
        return { listId: l.id, listName: l.name, tasks: (res.data.data || []) as Task[] };
      },
      enabled: !!folderId,
    })),
  });

  const isLoading =
    folderQuery.isLoading || taskQueries.some((q) => q.isLoading || q.isFetching);

  return useMemo(() => {
    const requests: RequestRowData[] = [];
    const listByStatus: Record<RequestStatus, { id: string; name: string } | null> = {
      queued: null,
      progress: null,
      review: null,
      done: null,
    };

    for (const l of lists) {
      const mapped = listNameToStatus(l.name);
      if (mapped && !listByStatus[mapped]) {
        listByStatus[mapped] = { id: l.id, name: l.name };
      }
    }

    for (const q of taskQueries) {
      if (!q.data) continue;
      const mapped = listNameToStatus(q.data.listName);
      for (const t of q.data.tasks) {
        const taskStatus = (t as any).status as string | undefined;
        let derived: RequestStatus;
        if (taskStatus === 'done') derived = 'done';
        else if (mapped) derived = mapped;
        else if (taskStatus === 'in_progress') derived = 'progress';
        else if (taskStatus === 'review') derived = 'review';
        else derived = 'queued';
        requests.push({
          ...t,
          metadata: (t.metadata as any) || {},
          _derivedStatus: derived,
          _listName: q.data.listName,
        });
      }
    }

    const byStatus: Record<RequestStatus, RequestRowData[]> = {
      queued: [],
      progress: [],
      review: [],
      done: [],
    };
    for (const r of requests) byStatus[r._derivedStatus].push(r);

    return { isLoading, requests, folder, listByStatus, byStatus };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, folder, ...taskQueries.map((q) => q.data)]);
}
