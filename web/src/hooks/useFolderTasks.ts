import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import api from '../services/api';
import type { Task, Folder, SpaceStatus } from '@squadhub/shared';
import type { RequestStatus } from '../views/app/pm/client-design/atoms/StatusPill';
import type { RequestRowData } from '../views/app/pm/client-design/atoms/RequestRow';
import { isGeneralTasksListName, listNameToStatus, resolveStage, sortStages, stageCategoryToBucket } from '../lib/designSpaceLists';

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

export interface FolderTasksResult {
  isLoading: boolean;
  requests: RequestRowData[];
  folder: FolderDetail | undefined;
  listByStatus: Record<RequestStatus, { id: string; name: string } | null>;
  byStatus: Record<RequestStatus, RequestRowData[]>;
}

export function useFolderTasks(
  folderId: string | null,
  statuses: SpaceStatus[] = [],
): FolderTasksResult {
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

  // Constant-size dependency for the memo below. We can't spread
  // `taskQueries.map((q) => q.data)` into the deps array — its length tracks the
  // number of lists, and React requires the deps array to keep a constant size
  // across renders (otherwise it logs "the final argument passed to useMemo
  // changed size between renders"). Each query's `dataUpdatedAt` advances on
  // every successful (re)fetch, so this signature changes whenever any list's
  // task data changes; its value also changes when lists are added/removed
  // (different number of segments), and `folder` covers list identity.
  const tasksSignature = taskQueries.map((q) => q.dataUpdatedAt).join('|');
  // Stable proxy for the statuses array so the memo only recomputes when the
  // space's stage catalog actually changes (not on every parent re-render).
  const statusesSignature = statuses
    .map((s) => `${s.id}:${s.name}:${s.category}:${s.position}`)
    .join('|');

  return useMemo(() => {
    const sortedStages = sortStages(statuses);
    const requests: RequestRowData[] = [];
    const listByStatus: Record<RequestStatus, { id: string; name: string } | null> = {
      queued: null,
      progress: null,
      review: null,
      done: null,
    };

    for (const l of lists) {
      // The general "Tasks" list is surfaced as its own tab, not a request lane.
      if (isGeneralTasksListName(l.name)) continue;
      const mapped = listNameToStatus(l.name);
      if (mapped && !listByStatus[mapped]) {
        listByStatus[mapped] = { id: l.id, name: l.name };
      }
    }

    for (const q of taskQueries) {
      if (!q.data) continue;
      // Keep general-task-list tasks out of Dashboard/Board/Reports/Completed.
      if (isGeneralTasksListName(q.data.listName)) continue;
      const mapped = listNameToStatus(q.data.listName);
      for (const t of q.data.tasks) {
        const taskStatus = (t as any).status as string | undefined;
        // Prefer the real 8-stage resolution when the space's statuses are
        // loaded; fall back to the legacy list-name derivation otherwise.
        const stage = sortedStages.length ? resolveStage(taskStatus, sortedStages) : null;
        let derived: RequestStatus;
        if (stage) derived = stageCategoryToBucket(stage.category);
        else if (taskStatus === 'done') derived = 'done';
        else if (mapped) derived = mapped;
        else if (taskStatus === 'in_progress') derived = 'progress';
        else if (taskStatus === 'review') derived = 'review';
        else derived = 'queued';
        requests.push({
          ...t,
          metadata: (t.metadata as any) || {},
          _derivedStatus: derived,
          _stage: stage,
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
    // `lists`/`taskQueries`/`statuses` are intentionally tracked via `folder` +
    // `tasksSignature` + `statusesSignature` (constant-size proxies) rather than
    // listed directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, folder, tasksSignature, statusesSignature]);
}
