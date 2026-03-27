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
  const [showStatusChip, setShowStatusChip] = useState(true);
  const [showSeparate, setShowSeparate] = useState(true);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

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
      <div className="flex items-center gap-0 border-b border-[#E2E8F0] bg-white px-4">
        <button
          onClick={() => setViewMode('list')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
            viewMode === 'list'
              ? 'border-[#0F172B] text-[#0F172B]'
              : 'border-transparent text-[#999999] hover:text-[#666666]'
          }`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
          Tasks
          {listData?.task_count !== undefined && (
            <span className="ml-0.5 text-xs text-[#999999]">{listData.task_count}</span>
          )}
        </button>

        <button
          onClick={() => setViewMode('board')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
            viewMode === 'board'
              ? 'border-[#0F172B] text-[#0F172B]'
              : 'border-transparent text-[#999999] hover:text-[#666666]'
          }`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
          Board
        </button>

        <button className="flex items-center gap-1 border-b-2 border-transparent px-3 py-2.5 text-sm text-[#999999] hover:text-[#666666]">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          View
        </button>
      </div>

      {/* Filter & Action Bar */}
      <div className="flex items-center justify-between border-b border-[#E2E8F0] bg-white px-4 py-1.5">
        {/* Left side */}
        <div className="flex items-center gap-2">
          {/* Status chip */}
          <button
            onClick={() => {
              setShowStatusChip(!showStatusChip);
              if (showStatusChip) setFilterStatus('');
            }}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${
              showStatusChip
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                : 'bg-[#F1F5F9] text-[#666666]'
            }`}
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
            </svg>
            Status
          </button>

          {/* Separate toggle */}
          <button
            onClick={() => setShowSeparate(!showSeparate)}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${
              showSeparate
                ? 'bg-[#F1F5F9] text-[#0F172B]'
                : 'bg-white text-[#999999] ring-1 ring-[#E2E8F0]'
            }`}
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
            Separate
          </button>

          {/* Divider */}
          <div className="h-4 w-px bg-[#E2E8F0]" />

          {/* Group/board mini toggle */}
          <button
            onClick={() => setViewMode(viewMode === 'list' ? 'board' : 'list')}
            className="rounded p-1 text-[#999999] hover:bg-[#F1F5F9] hover:text-[#0F172B]"
            title="Toggle view"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {viewMode === 'list' ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Filter button */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${
              hasActiveFilters
                ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
                : 'text-[#999999] hover:bg-[#F1F5F9] hover:text-[#0F172B]'
            }`}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            {hasActiveFilters ? `${activeFilterCount} Filter${activeFilterCount > 1 ? 's' : ''}` : 'Filter'}
          </button>

          {/* Assignee icon */}
          <button className="rounded p-1 text-[#999999] hover:bg-[#F1F5F9] hover:text-[#0F172B]">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* Search icon */}
          <button className="rounded p-1 text-[#999999] hover:bg-[#F1F5F9] hover:text-[#0F172B]">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>

          {/* Settings */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`rounded p-1 transition ${
              showSettings ? 'bg-[#F1F5F9] text-[#0F172B]' : 'text-[#999999] hover:bg-[#F1F5F9] hover:text-[#0F172B]'
            }`}
            title="List settings"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* + Task button */}
          <button
            onClick={() => setQuickAddOpen(!quickAddOpen)}
            className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Task
          </button>
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
            groupByStatus={showSeparate}
          />
        ) : (
          <BoardView listId={activeListId} statuses={statuses} filters={filters} />
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
