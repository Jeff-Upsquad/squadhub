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
  const [showSettings, setShowSettings] = useState(false);
  const [groupByStatus] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: listData } = useQuery({
    queryKey: ['list', activeListId],
    queryFn: async () => {
      const res = await api.get(`/pm/lists/${activeListId}`);
      return res.data.data;
    },
    enabled: !!activeListId,
  });

  const { data: spaceData } = useQuery({
    queryKey: ['space', activeSpaceId],
    queryFn: async () => {
      const res = await api.get(`/pm/spaces/${activeSpaceId}`);
      return res.data.data;
    },
    enabled: !!activeSpaceId,
  });

  const statuses: SpaceStatus[] = useMemo(
    () => spaceData?.space_statuses || spaceData?.statuses || [],
    [spaceData],
  );

  const filters = useMemo(() => ({}), []);

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
      {/* View Tabs Bar */}
      <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-white px-4">
        {/* Left: tabs */}
        <div className="flex items-center gap-0">
          <button
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              viewMode === 'list'
                ? 'border-[#2962FF] text-[#0F172B]'
                : 'border-transparent text-[#999999] hover:text-[#666666]'
            }`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
            </svg>
            List
          </button>

          <button
            onClick={() => setViewMode('board')}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              viewMode === 'board'
                ? 'border-[#2962FF] text-[#0F172B]'
                : 'border-transparent text-[#999999] hover:text-[#666666]'
            }`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
            Board
          </button>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          {/* Search input */}
          <div className="flex items-center gap-1.5 rounded border border-[#E2E8F0] bg-white px-2.5 py-1">
            <svg className="h-3.5 w-3.5 text-[#CAD5E2]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks..."
              className="w-32 bg-transparent text-xs text-[#0F172B] placeholder-[#CAD5E2] outline-none"
            />
          </div>

          <button className="flex items-center gap-1.5 rounded-md bg-[#2962FF] px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-[#1E50E0]">
            Add Task
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content area + task detail panel */}
      <div className="flex flex-1 overflow-hidden">
        {viewMode === 'list' ? (
          <ListView
            listId={activeListId}
            statuses={statuses}
            filters={filters}
            groupByStatus={groupByStatus}
            searchQuery={searchQuery}
          />
        ) : (
          <BoardView
            listId={activeListId}
            statuses={statuses}
            filters={filters}
            listName={listData?.name || ''}
            searchQuery={searchQuery}
          />
        )}

        {activeTaskId && !showSettings && (
          <TaskDetailPanel statuses={statuses} listId={activeListId} />
        )}

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
