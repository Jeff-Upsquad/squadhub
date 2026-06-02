import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import './design.css';
import api from '../../../../services/api';
import { useFolderTasks } from '../../../../hooks/useFolderTasks';
import { useClientDesignPlan } from '../../../../hooks/useClientDesignPlan';
import { useTaskTypes } from '../../../../hooks/useTaskTypes';
import { useSpace } from '../../../../hooks/useSpaces';
import { usePMStore } from '../../../../stores/pmStore';
import { canAtLeast } from '../../../../lib/access';
import DashboardTab from './tabs/DashboardTab';
import RequestsTab from './tabs/RequestsTab';
import BoardTab from './tabs/BoardTab';
import ReportsTab from './tabs/ReportsTab';
import CompletedTab from './tabs/CompletedTab';
import TaskCreatePanel from '../TaskCreatePanel';
import SquadShareModal from './SquadShareModal';

type TabKey = 'dashboard' | 'requests' | 'board' | 'reports' | 'completed';
const TAB_STORAGE = 'cd.tab';

const TAB_ICONS: Record<TabKey, React.ReactNode> = {
  dashboard: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />
    </svg>
  ),
  requests: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  ),
  board: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
    </svg>
  ),
  reports: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  completed: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

export default function ClientDesignDashboard({ folderId }: { folderId: string }) {
  const [tab, setTab] = useState<TabKey>(() => {
    if (typeof window === 'undefined') return 'dashboard';
    const v = window.localStorage.getItem(TAB_STORAGE);
    return (v as TabKey) || 'dashboard';
  });
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingListId, setPendingListId] = useState<string | null>(null);
  const creatingRef = useRef(false);

  const qc = useQueryClient();
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const { folder, requests, byStatus, listByStatus, isLoading } = useFolderTasks(folderId);
  const plan = useClientDesignPlan(folderId);
  const { data: taskTypes } = useTaskTypes();
  const { data: space } = useSpace(folder?.space_id ?? null);
  const openRequest = (id: string) => setActiveTask(id);

  const templateSlug = (folder as any)?.client_space_template?.slug as string | undefined;
  const isVideo = templateSlug === 'video-editing-space';
  const taskTypeKey = isVideo ? 'video_edit_task' : 'design_task';
  const breadcrumbLabel = isVideo ? 'Video editing workspace' : 'Design workspace';
  const newTaskLabel = isVideo ? 'New Video Task' : 'New Design Task';

  const designType = useMemo(
    () => taskTypes?.find((t) => t.key === taskTypeKey) || null,
    [taskTypes, taskTypeKey],
  );

  const isManager = canAtLeast(folder?.my_access_level, 'manager');

  const handleNewTask = useCallback(async () => {
    const listId = listByStatus.queued?.id || pendingListId;
    if (listId) {
      setShowCreatePanel(true);
      return;
    }
    if (!folder || creatingRef.current) return;
    try {
      const res = await api.post('/pm/lists', {
        space_id: folder.space_id,
        folder_id: folder.id,
        name: 'Briefs',
      });
      const newListId = res.data?.data?.id;
      if (newListId) {
        setPendingListId(newListId);
        qc.invalidateQueries({ queryKey: ['folder', folderId] });
        qc.invalidateQueries({ queryKey: ['folder-tasks', folderId] });
        setShowCreatePanel(true);
      }
    } catch (err) {
      console.error('Failed to create default list:', err);
    }
  }, [listByStatus.queued?.id, pendingListId, folder, qc, folderId]);

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(TAB_STORAGE, tab);
  }, [tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleNewTask();
      }
      if (e.key === 'Escape') {
        setShowCreatePanel(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleNewTask]);

  const filteredRequests = useMemo(() => {
    if (!searchQuery.trim()) return requests;
    const q = searchQuery.toLowerCase();
    return requests.filter((r) => r.title?.toLowerCase().includes(q));
  }, [requests, searchQuery]);

  const activeCount = requests.filter((r) => r._derivedStatus !== 'done').length;
  const doneCount = requests.filter((r) => r._derivedStatus === 'done').length;

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'requests', label: 'Requests', count: activeCount },
    { key: 'board', label: 'Board' },
    { key: 'reports', label: 'Reports' },
    { key: 'completed', label: 'Completed', count: doneCount },
  ];

  const briefsListId = listByStatus.queued?.id || pendingListId;
  const effectiveStatuses = (space as any)?.space_statuses || space?.statuses || [];

  return (
    <div className="flex flex-1 flex-col">
      {/* Row 1: Breadcrumb + global actions */}
      <div className="lv-breadcrumb-row">
        <div className="lv-breadcrumb">
          <span className="lv-bc-link">{breadcrumbLabel}</span>
          <span className="lv-bc-sep">/</span>
          <span className="lv-bc-current">{folder?.name || 'Loading…'}</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="lv-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks..."
            />
            <kbd>N</kbd>
          </div>

          {isManager && (
            <button
              onClick={() => setShowShare(true)}
              className="lv-icon-btn"
              title="Share this space"
              aria-label="Share"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
              </svg>
            </button>
          )}

          <button
            onClick={handleNewTask}
            className="lv-newtask-btn"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {newTaskLabel}
          </button>
        </div>
      </div>

      {/* Row 2: View Tabs */}
      <div className="lv-tabs-row">
        {tabs.map((t) => (
          <button
            key={t.key}
            className="lv-tab"
            data-active={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {TAB_ICONS[t.key]}
            {t.label}
            {t.count != null && (
              <span className="ml-1 text-[11px] tabular-nums text-[color:var(--sh-ink-4)]">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="flex flex-1 overflow-hidden">
        <div className="cd-root flex-1 overflow-y-auto">
          {isLoading && requests.length === 0 ? (
            <div
              style={{
                padding: 60,
                textAlign: 'center',
                fontSize: 13,
                color: 'var(--sh-ink-3)',
              }}
            >
              Loading design workspace…
            </div>
          ) : (
            <>
              {tab === 'dashboard' && (
                <DashboardTab
                  folderId={folderId}
                  requests={filteredRequests}
                  plan={plan}
                  statuses={effectiveStatuses}
                  listByStatus={listByStatus}
                />
              )}
              {tab === 'requests' && (
                <RequestsTab
                  requests={filteredRequests}
                  statuses={effectiveStatuses}
                  listByStatus={listByStatus}
                />
              )}
              {tab === 'board' && (
                  <BoardTab
                    byStatus={byStatus}
                    onOpenRequest={(r) => openRequest(r.id)}
                    onNewRequest={handleNewTask}
                  />
              )}
              {tab === 'reports' && <ReportsTab requests={filteredRequests} plan={plan} />}
              {tab === 'completed' && (
                <CompletedTab
                  requests={filteredRequests}
                  statuses={effectiveStatuses}
                  listByStatus={listByStatus}
                />
              )}
            </>
          )}
        </div>
      </div>

      {showCreatePanel && briefsListId && (
        <TaskCreatePanel
          listId={briefsListId}
          spaceName={space?.name}
          spaceColor={space?.color || null}
          folderName={folder?.name || null}
          listName={listByStatus.queued?.name || null}
          onClose={() => setShowCreatePanel(false)}
          isDesignTask
          customTaskTypeKey={taskTypeKey}
          designTaskTypeId={designType?.id || null}
          statuses={effectiveStatuses}
          defaultStatus={effectiveStatuses[0]?.name}
        />
      )}

      {showShare && folder && (
        <SquadShareModal
          folderId={folder.id}
          folderName={folder.name}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}
