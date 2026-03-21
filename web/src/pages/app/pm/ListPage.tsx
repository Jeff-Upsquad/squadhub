import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { usePMStore } from '../../../stores/pmStore';
import type { SpaceStatus } from '@squadhub/shared';
import ListView from './ListView';
import BoardView from './BoardView';
import TaskDetailPanel from './TaskDetailPanel';
import SettingsSlider from '../../../components/SettingsSlider';

export default function ListPage() {
  const { activeSpaceId, activeListId, activeTaskId, viewMode, setViewMode } = usePMStore();
  const [filterPriority, setFilterPriority] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sort, setSort] = useState('position');
  const [showFilters, setShowFilters] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

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
          <svg className="mx-auto mb-3 h-12 w-12 text-[#CAD5E2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-sm text-[#999999]">Select a list to view tasks</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* List header */}
      <div className="border-b border-[#E2E8F0]">
        <div className="flex items-center justify-between px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-[#0F172B] font-[family-name:var(--font-display)]">{listData?.name || 'Loading...'}</h2>
            {listData?.task_count !== undefined && (
              <span className="text-xs text-[#999999]">{listData.task_count} tasks</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Filter toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${
                hasActiveFilters
                  ? 'bg-[#0F172B]/10 text-[#0F172B]'
                  : 'text-[#999999] hover:text-[#0F172B]'
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filter
            </button>

            <div className="h-4 w-px bg-[#E2E8F0]" />

            {/* List / Board toggle */}
            <button
              onClick={() => setViewMode('list')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                viewMode === 'list' ? 'bg-[#F8FAFC] text-[#0F172B]' : 'text-[#999999] hover:text-[#0F172B]'
              }`}
            >
              List
            </button>
            <button
              onClick={() => setViewMode('board')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                viewMode === 'board' ? 'bg-[#F8FAFC] text-[#0F172B]' : 'text-[#999999] hover:text-[#0F172B]'
              }`}
            >
              Board
            </button>

            <div className="h-4 w-px bg-[#E2E8F0]" />

            {/* Settings three-dot menu */}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`rounded p-1.5 transition ${
                showSettings ? 'bg-[#F1F5F9] text-[#0F172B]' : 'text-[#999999] hover:text-[#0F172B]'
              }`}
              title="List settings"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Filter bar */}
        {showFilters && (
          <div className="flex items-center gap-3 border-t border-[#E2E8F0]/50 px-5 py-2">
            {/* Status filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#999999] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">Status:</span>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded border border-[#CAD5E2] bg-[#F8FAFC] px-2 py-0.5 text-xs text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
              >
                <option value="">All</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Priority filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#999999] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">Priority:</span>
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="rounded border border-[#CAD5E2] bg-[#F8FAFC] px-2 py-0.5 text-xs text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
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
              <span className="text-xs text-[#999999] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">Sort:</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="rounded border border-[#CAD5E2] bg-[#F8FAFC] px-2 py-0.5 text-xs text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
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
                className="text-xs text-[#999999] hover:text-[#0F172B]"
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
        {activeTaskId && !showSettings && (
          <TaskDetailPanel statuses={statuses} listId={activeListId} />
        )}

        {/* List settings slider */}
        {showSettings && activeListId && (
          <SettingsSlider
            type="list"
            id={activeListId}
            name={listData?.name || ''}
            spaceId={activeSpaceId}
            onClose={() => setShowSettings(false)}
            onDeleted={() => {
              setShowSettings(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
