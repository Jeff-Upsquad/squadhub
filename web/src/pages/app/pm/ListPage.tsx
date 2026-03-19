import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { usePMStore } from '../../../stores/pmStore';
import type { SpaceStatus } from '@squadhub/shared';
import ListView from './ListView';
import BoardView from './BoardView';
import TaskDetailPanel from './TaskDetailPanel';

export default function ListPage() {
  const { activeSpaceId, activeListId, activeTaskId, viewMode, setViewMode } = usePMStore();
  const [filterPriority, setFilterPriority] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sort, setSort] = useState('position');
  const [showFilters, setShowFilters] = useState(false);

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

  const filters = useMemo(() => ({
    ...(filterPriority && { priority: filterPriority }),
    ...(filterStatus && { status_id: filterStatus }),
    ...(sort !== 'position' && { sort }),
  }), [filterPriority, filterStatus, sort]);

  const hasActiveFilters = filterPriority || filterStatus || sort !== 'position';

  if (!activeListId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <svg className="mx-auto mb-3 h-12 w-12 text-[#333]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-sm text-[#555]">Select a list to view tasks</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* List header */}
      <div className="border-b border-[#222]">
        <div className="flex items-center justify-between px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-[#ededed]">{listData?.name || 'Loading...'}</h2>
            {listData?.task_count !== undefined && (
              <span className="text-xs text-[#555]">{listData.task_count} tasks</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${
                hasActiveFilters
                  ? 'bg-[#ededed]/20 text-[#ededed]'
                  : 'text-[#555] hover:text-[#ededed]'
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filter
            </button>

            <div className="h-4 w-px bg-[#222]" />

            {/* List / Board toggle */}
            <button
              onClick={() => setViewMode('list')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                viewMode === 'list' ? 'bg-[#1a1a1a] text-[#ededed]' : 'text-[#555] hover:text-[#ededed]'
              }`}
            >
              List
            </button>
            <button
              onClick={() => setViewMode('board')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                viewMode === 'board' ? 'bg-[#1a1a1a] text-[#ededed]' : 'text-[#555] hover:text-[#ededed]'
              }`}
            >
              Board
            </button>
          </div>
        </div>

        {/* Filter bar */}
        {showFilters && (
          <div className="flex items-center gap-3 border-t border-[#222]/50 px-5 py-2">
            {/* Status filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#555]">Status:</span>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded border border-[#333] bg-[#1a1a1a] px-2 py-0.5 text-xs text-[#ededed] outline-none"
              >
                <option value="">All</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Priority filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#555]">Priority:</span>
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="rounded border border-[#333] bg-[#1a1a1a] px-2 py-0.5 text-xs text-[#ededed] outline-none"
              >
                <option value="">All</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
                <option value="none">None</option>
              </select>
            </div>

            {/* Sort */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#555]">Sort:</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="rounded border border-[#333] bg-[#1a1a1a] px-2 py-0.5 text-xs text-[#ededed] outline-none"
              >
                <option value="position">Manual</option>
                <option value="created_at">Created</option>
                <option value="due_date">Due date</option>
                <option value="priority">Priority</option>
              </select>
            </div>

            {/* Clear filters */}
            {hasActiveFilters && (
              <button
                onClick={() => { setFilterPriority(''); setFilterStatus(''); setSort('position'); }}
                className="text-xs text-[#555] hover:text-[#ededed]"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content area + task detail panel */}
      <div className="flex flex-1 overflow-hidden">
        {viewMode === 'list' ? (
          <ListView listId={activeListId} statuses={statuses} filters={filters} />
        ) : (
          <BoardView listId={activeListId} statuses={statuses} filters={filters} />
        )}

        {/* Task detail side panel */}
        {activeTaskId && (
          <TaskDetailPanel statuses={statuses} listId={activeListId} />
        )}
      </div>
    </div>
  );
}
