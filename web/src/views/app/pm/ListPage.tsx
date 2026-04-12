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
  const [groupByStatus, setGroupByStatus] = useState(true);
  const [collapseSubtasks, setCollapseSubtasks] = useState(true);
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

  const filters = useMemo(() => ({
    ...(filterPriority && { priority: filterPriority }),
    ...(filterStatus && { status: filterStatus }),
    ...(sort !== 'position' && { sort }),
  }), [filterPriority, filterStatus, sort]);

  const activeFilterCount = [filterPriority, filterStatus, sort !== 'position' ? sort : ''].filter(Boolean).length;
  const hasActiveFilters = activeFilterCount > 0;

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

          <button className="flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-sm text-[#999999] hover:text-[#666666]">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Team
            <span className="text-xs text-[#CAD5E2]">8</span>
          </button>

          <button className="flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-sm text-[#999999] hover:text-[#666666]">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Calendar
          </button>

          <button className="flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-sm text-[#999999] hover:text-[#666666]">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Timeline
          </button>

          <span className="px-2 text-xs text-[#999999] hover:text-[#666666] cursor-pointer">6 more...</span>

          <button className="flex items-center gap-1 border-b-2 border-transparent px-3 py-2.5 text-sm text-[#999999] hover:text-[#666666]">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            View
          </button>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          <button className="rounded p-1.5 text-[#999999] hover:bg-[#F1F5F9] hover:text-[#0F172B]">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>

          <button className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs text-[#666666] hover:bg-[#F1F5F9]">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
            </svg>
            Hide
          </button>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs transition ${
              showSettings ? 'bg-[#F1F5F9] text-[#0F172B]' : 'text-[#666666] hover:bg-[#F1F5F9]'
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Customize
          </button>

          <button className="flex items-center gap-1.5 rounded-md bg-[#2962FF] px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-[#1E50E0]">
            Add Task
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Filter & Toolbar Bar */}
      <div className="flex items-center gap-2 border-b border-[#E2E8F0] bg-[#FAFBFC] px-4 py-1.5">
        {/* Blue outlined pills */}
        <button
          onClick={() => setGroupByStatus(!groupByStatus)}
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition ${
            groupByStatus
              ? 'border border-[#2962FF] bg-white text-[#2962FF]'
              : 'border border-[#E2E8F0] bg-white text-[#999999]'
          }`}
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
          Group: Status
        </button>

        <button
          onClick={() => setCollapseSubtasks(!collapseSubtasks)}
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition ${
            collapseSubtasks
              ? 'border border-[#2962FF] bg-white text-[#2962FF]'
              : 'border border-[#E2E8F0] bg-white text-[#999999]'
          }`}
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          Subtasks: Collapse all
        </button>

        {/* Divider */}
        <div className="h-4 w-px bg-[#E2E8F0]" />

        {/* Text buttons */}
        {viewMode === 'list' && (
          <button className="flex items-center gap-1 px-2 py-1 text-xs text-[#666666] hover:text-[#0F172B]">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
            </svg>
            Columns
          </button>
        )}

        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1 px-2 py-1 text-xs transition ${
            hasActiveFilters ? 'text-[#2962FF] font-medium' : 'text-[#666666] hover:text-[#0F172B]'
          }`}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          Filters
        </button>

        <button className="flex items-center gap-1 px-2 py-1 text-xs text-[#666666] hover:text-[#0F172B]">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
          </svg>
          Sort
        </button>

        <button className="flex items-center gap-1 px-2 py-1 text-xs text-[#666666] hover:text-[#0F172B]">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          Me Mode
        </button>

        <button className="flex items-center gap-1 px-2 py-1 text-xs text-[#666666] hover:text-[#0F172B]">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Assignees
        </button>

        <button className="flex items-center gap-1 px-2 py-1 text-xs text-[#666666] hover:text-[#0F172B]">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Show closed
        </button>

        <span className="px-2 text-xs text-[#666666] cursor-pointer hover:text-[#0F172B]">Hide</span>

        {/* Spacer */}
        <div className="flex-1" />

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
      </div>

      {/* Expandable filter panel */}
      {showFilters && (
        <div className="flex items-center gap-3 border-b border-[#E2E8F0]/50 bg-[#FAFBFC] px-5 py-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[#999999] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">Status:</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded border border-[#CAD5E2] bg-white px-2 py-0.5 text-xs text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
            >
              <option value="">All</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[#999999] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">Priority:</span>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="rounded border border-[#CAD5E2] bg-white px-2 py-0.5 text-xs text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
            >
              <option value="">All</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
              <option value="none">None</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[#999999] font-[family-name:var(--font-mono)] uppercase tracking-[0.12em]">Sort:</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="rounded border border-[#CAD5E2] bg-white px-2 py-0.5 text-xs text-[#0F172B] outline-none focus:border-[#2962FF] focus:ring-1 focus:ring-[#2962FF]"
            >
              <option value="position">Manual</option>
              <option value="created_at">Created</option>
              <option value="due_date">Due date</option>
              <option value="priority">Priority</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button
              onClick={() => { setFilterPriority(''); setFilterStatus(''); setSort('position'); }}
              className="text-xs text-[#999999] hover:text-[#0F172B]"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Content area + task detail panel */}
      <div className="flex flex-1 overflow-hidden">
        {viewMode === 'list' ? (
          <ListView
            listId={activeListId}
            statuses={statuses}
            filters={filters}
            hasActiveFilters={hasActiveFilters}
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
