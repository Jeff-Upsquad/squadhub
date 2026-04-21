import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { usePMStore } from '../../../stores/pmStore';
import { useIsAdmin } from '../../../hooks/usePermissions';
import { canAtLeast } from '../../../lib/access';
import type { SpaceStatus, AccessLevel } from '@squadhub/shared';
import ListView from './ListView';
import BoardView from './BoardView';
import SettingsSlider from '../../../components/SettingsSlider';
import ManageMembersModal from './ManageMembersModal';
import TaskCreatePanel from './TaskCreatePanel';

export default function ListPage() {
  const { activeSpaceId, activeListId, viewMode, setViewMode, setActiveTask } = usePMStore();
  const [showSettings, setShowSettings] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [groupByStatus] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreatePanel, setShowCreatePanel] = useState(false);

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
    () => spaceData?.space_statuses || spaceData?.statuses || listData?.space_statuses || [],
    [spaceData, listData],
  );

  const myAccess: AccessLevel | undefined = spaceData?.my_access_level || listData?.my_access_level;
  const isManager = canAtLeast(myAccess, 'manager');
  const isAdmin = useIsAdmin();
  const canAccessSettings = isManager || isAdmin;
  const canEdit = canAtLeast(myAccess, 'member');

  const filters = useMemo(() => ({}), []);

  if (!activeListId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <svg className="mx-auto mb-3 h-12 w-12 text-[var(--sh-ink-4)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-sm text-[var(--sh-ink-3)]">Select a list to view tasks</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* View Tabs Bar */}
      <div className="flex items-center justify-between border-b border-[var(--sh-hair)] bg-[var(--surface)] px-4">
        {/* Left: tabs */}
        <div className="flex items-center gap-0">
          <button
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              viewMode === 'list'
                ? 'border-[var(--sh-ink)] text-[var(--sh-ink)]'
                : 'border-transparent text-[var(--sh-ink-3)] hover:text-[var(--sh-ink-2)]'
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
                ? 'border-[var(--sh-ink)] text-[var(--sh-ink)]'
                : 'border-transparent text-[var(--sh-ink-3)] hover:text-[var(--sh-ink-2)]'
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
          <div className="flex items-center gap-1.5 rounded border border-[var(--sh-hair)] bg-[var(--surface)] px-2.5 py-1">
            <svg className="h-3.5 w-3.5 text-[var(--sh-ink-4)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks..."
              className="w-32 bg-transparent text-xs text-[var(--sh-ink)] placeholder-[var(--sh-ink-4)] outline-none"
            />
          </div>

          {/* Share button */}
          {isManager && (
            <button
              onClick={() => setShowShare(true)}
              className="rounded p-1.5 text-[var(--sh-ink-3)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
              title="Share list"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            </button>
          )}

          {/* Settings button - list managers + workspace admins */}
          {canAccessSettings && (
            <button
              onClick={() => {
                const next = !showSettings;
                setShowSettings(next);
                if (next) setActiveTask(null);
              }}
              className={`rounded p-1.5 transition ${
                showSettings
                  ? 'bg-[var(--sh-hair-3)] text-[var(--sh-ink)]'
                  : 'text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
              }`}
              title="List settings"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}

          {canEdit ? (
            <button
              onClick={() => setShowCreatePanel(true)}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition"
              style={{ background: 'var(--sh-ink)', color: 'var(--surface)' }}
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 24 24">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New task
            </button>
          ) : null}
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
            canEdit={canEdit}
          />
        ) : (
          <BoardView
            listId={activeListId}
            statuses={statuses}
            filters={filters}
            listName={listData?.name || ''}
            searchQuery={searchQuery}
            canEdit={canEdit}
          />
        )}

        {showSettings && activeListId && (
          <SettingsSlider
            type="list"
            id={activeListId}
            name={listData?.name || ''}
            spaceId={activeSpaceId}
            myAccess={myAccess}
            onClose={() => setShowSettings(false)}
            onDeleted={() => {
              setShowSettings(false);
            }}
          />
        )}
      </div>

      {showShare && activeListId && (
        <ManageMembersModal
          resourceType="list"
          resourceId={activeListId}
          resourceName={listData?.name || 'List'}
          onClose={() => setShowShare(false)}
        />
      )}

      {showCreatePanel && activeListId && canEdit && (
        <TaskCreatePanel
          listId={activeListId}
          statuses={statuses}
          defaultStatus={statuses[0]?.category}
          spaceName={spaceData?.name || listData?.name}
          spaceColor={spaceData?.color || null}
          onClose={() => setShowCreatePanel(false)}
        />
      )}
    </div>
  );
}
