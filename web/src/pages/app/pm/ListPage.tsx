import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { usePMStore } from '../../../stores/pmStore';
import type { SpaceStatus } from '@squadhub/shared';
import ListView from './ListView';
import TaskDetailPanel from './TaskDetailPanel';

export default function ListPage() {
  const { activeSpaceId, activeListId, activeTaskId, viewMode, setViewMode } = usePMStore();

  // Fetch list details
  const { data: listData } = useQuery({
    queryKey: ['list', activeListId],
    queryFn: async () => {
      const res = await api.get(`/pm/lists/${activeListId}`);
      return res.data.data;
    },
    enabled: !!activeListId,
  });

  // Fetch statuses for the active space
  const { data: spaceData } = useQuery({
    queryKey: ['space', activeSpaceId],
    queryFn: async () => {
      const res = await api.get(`/pm/spaces/${activeSpaceId}`);
      return res.data.data;
    },
    enabled: !!activeSpaceId,
  });

  const statuses: SpaceStatus[] = useMemo(
    () => spaceData?.statuses || [],
    [spaceData],
  );

  if (!activeListId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <svg className="mx-auto mb-3 h-12 w-12 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-sm text-gray-500">Select a list to view tasks</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* List header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
        <div>
          <h2 className="text-base font-semibold text-white">{listData?.name || 'Loading...'}</h2>
          {listData?.task_count !== undefined && (
            <span className="text-xs text-gray-500">{listData.task_count} tasks</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* List / Board toggle */}
          <button
            onClick={() => setViewMode('list')}
            className={`rounded px-2.5 py-1 text-xs font-medium transition ${
              viewMode === 'list' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            List
          </button>
          <button
            onClick={() => setViewMode('board')}
            className={`rounded px-2.5 py-1 text-xs font-medium transition ${
              viewMode === 'board' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Board
          </button>
        </div>
      </div>

      {/* Content area + task detail panel */}
      <div className="flex flex-1 overflow-hidden">
        {viewMode === 'list' ? (
          <ListView listId={activeListId} statuses={statuses} />
        ) : (
          /* Board view placeholder for Phase 4 */
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-gray-500">Board view coming soon</p>
          </div>
        )}

        {/* Task detail side panel */}
        {activeTaskId && (
          <TaskDetailPanel statuses={statuses} listId={activeListId} />
        )}
      </div>
    </div>
  );
}
