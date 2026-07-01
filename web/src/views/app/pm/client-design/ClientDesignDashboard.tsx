import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import './design.css';
import api from '../../../../services/api';
import { useFolder, useFolderTasks } from '../../../../hooks/useFolderTasks';
import { useClientDesignPlan } from '../../../../hooks/useClientDesignPlan';
import { useTaskTypes } from '../../../../hooks/useTaskTypes';
import { useUpdateTask } from '../../../../hooks/useTasks';
import { useSpace } from '../../../../hooks/useSpaces';
import { usePMStore } from '../../../../stores/pmStore';
import { useMeetingPanelStore } from '../../../../stores/meetingPanelStore';
import { canAtLeast } from '../../../../lib/access';
import { sortStages, isGeneralTasksListName } from '../../../../lib/designSpaceLists';
import ContainerChatButton from '../../../../components/pm/ContainerChatButton';
import DashboardTab from './tabs/DashboardTab';
import BoardTab from './tabs/BoardTab';
import ReportsTab from './tabs/ReportsTab';
import CompletedTab from './tabs/CompletedTab';
import TasksTab from './tabs/TasksTab';
import TaskCreatePanel from '../TaskCreatePanel';
import SquadShareModal from './SquadShareModal';

type TabKey = 'dashboard' | 'board' | 'tasks' | 'reports' | 'completed';
const TAB_STORAGE = 'cd.tab';
const TAB_KEYS: TabKey[] = ['dashboard', 'board', 'tasks', 'reports', 'completed'];

const TAB_ICONS: Record<TabKey, React.ReactNode> = {
  dashboard: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />
    </svg>
  ),
  board: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
    </svg>
  ),
  tasks: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
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
    // Validate against the current tab set so users whose saved tab is the now
    // removed 'requests' (merged into Dashboard) don't land on a blank pane.
    const v = window.localStorage.getItem(TAB_STORAGE) as TabKey | null;
    return v && TAB_KEYS.includes(v) ? v : 'dashboard';
  });
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [createMode, setCreateMode] = useState<'design' | 'general'>('design');
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingListId, setPendingListId] = useState<string | null>(null);
  const [pendingTasksListId, setPendingTasksListId] = useState<string | null>(null);
  const creatingRef = useRef(false);
  const creatingTasksRef = useRef(false);

  const qc = useQueryClient();
  const setActiveTask = usePMStore((s) => s.setActiveTask);
  const openMeetingPanel = useMeetingPanelStore((s) => s.openMeetingPanel);
  // Resolve the space (and its 8-stage status catalog) first so the resolved
  // stages can be fed into useFolderTasks for accurate grouping. useFolder here
  // shares the ['folder', folderId] query with useFolderTasks (no extra fetch).
  const { data: folderForSpace } = useFolder(folderId);
  const { data: space } = useSpace(folderForSpace?.space_id ?? null);
  const effectiveStatuses = (space as any)?.space_statuses || space?.statuses || [];
  const sortedStatuses = useMemo(() => sortStages(effectiveStatuses), [effectiveStatuses]);
  const { folder, requests, listByStatus, isLoading } = useFolderTasks(folderId, sortedStatuses);
  const updateTask = useUpdateTask(null);
  const plan = useClientDesignPlan(folderId);
  const { data: taskTypes } = useTaskTypes();
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
      setCreateMode('design');
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
        setCreateMode('design');
        setShowCreatePanel(true);
      }
    } catch (err) {
      console.error('Failed to create default list:', err);
    }
  }, [listByStatus.queued?.id, pendingListId, folder, qc, folderId]);

  // The general "Tasks" list backing the Tasks tab. Find-or-create lazily,
  // mirroring the Briefs list above. Returns the resolved list id (or null on
  // failure) so callers can immediately act on it.
  const existingTasksListId =
    (folder?.lists?.find((l) => isGeneralTasksListName(l.name))?.id) || pendingTasksListId;

  const ensureTasksList = useCallback(async (): Promise<string | null> => {
    if (existingTasksListId) return existingTasksListId;
    if (!folder || creatingTasksRef.current) return null;
    creatingTasksRef.current = true;
    try {
      const res = await api.post('/pm/lists', {
        space_id: folder.space_id,
        folder_id: folder.id,
        name: 'Tasks',
      });
      const newListId = res.data?.data?.id as string | undefined;
      if (newListId) {
        setPendingTasksListId(newListId);
        qc.invalidateQueries({ queryKey: ['folder', folderId] });
        qc.invalidateQueries({ queryKey: ['folder-tasks', folderId] });
        return newListId;
      }
      return null;
    } catch (err) {
      console.error('Failed to create Tasks list:', err);
      return null;
    } finally {
      creatingTasksRef.current = false;
    }
  }, [existingTasksListId, folder, qc, folderId]);

  const handleNewGeneralTask = useCallback(async () => {
    setShowNewMenu(false);
    const listId = await ensureTasksList();
    if (!listId) return;
    setTab('tasks');
    setCreateMode('general');
    setShowCreatePanel(true);
  }, [ensureTasksList]);

  const handleScheduleMeeting = useCallback(async () => {
    setShowNewMenu(false);
    const listId = await ensureTasksList();
    if (!listId) return;
    openMeetingPanel({ listId });
  }, [ensureTasksList, openMeetingPanel]);

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

  const activeCount = requests.filter((r) => r._stage?.category !== 'closed').length;
  const doneCount = requests.filter((r) => r._stage?.category === 'closed').length;

  const tasksListEntry = folder?.lists?.find((l) => isGeneralTasksListName(l.name));
  const tasksCount = (tasksListEntry as any)?.task_count as number | undefined;

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'dashboard', label: 'Dashboard', count: activeCount },
    { key: 'board', label: 'Board' },
    { key: 'tasks', label: 'Tasks', count: tasksCount },
    { key: 'reports', label: 'Reports' },
    { key: 'completed', label: 'Completed', count: doneCount },
  ];

  const briefsListId = listByStatus.queued?.id || pendingListId;
  const tasksListId = existingTasksListId;

  return (
    // min-h-0 / min-w-0 are load-bearing: this is a flex child of the layout's
    // column container, and without them its automatic min-size stays at content
    // height — the tall Reports tab then overflows instead of letting the inner
    // `.cd-root` scroll, which clips the top and breaks scrolling. (Matches the
    // chat/clips sibling views in MainLayout.)
    <div className="flex flex-1 flex-col min-h-0 min-w-0">
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

          {/* Split button: main click = New Design/Video request (default,
              unchanged); caret opens a dropdown with general-task + meeting. */}
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <div style={{ display: 'inline-flex' }}>
              <button
                onClick={handleNewTask}
                className="lv-newtask-btn"
                style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {newTaskLabel}
              </button>
              <button
                onClick={() => setShowNewMenu((v) => !v)}
                className="lv-newtask-btn"
                style={{
                  borderTopLeftRadius: 0,
                  borderBottomLeftRadius: 0,
                  borderLeft: '1px solid rgba(255,255,255,0.22)',
                  padding: '0 7px',
                }}
                aria-label="More create options"
                aria-haspopup="menu"
                aria-expanded={showNewMenu}
                title="More options"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            </div>
            {showNewMenu && (
              <>
                <div className="fixed inset-0 z-[1]" onClick={() => setShowNewMenu(false)} />
                <div
                  className="absolute right-0 top-[calc(100%+6px)] z-[2] w-52 overflow-hidden rounded-xl border shadow-lg"
                  style={{ borderColor: 'var(--sh-hair)', background: 'var(--surface)' }}
                  role="menu"
                >
                  <button
                    onClick={handleNewGeneralTask}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-[color:var(--sh-ink)] hover:bg-[color:var(--sh-hair-3)]"
                    role="menuitem"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M9 11l3 3 8-8M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h9" /></svg>
                    New General Task
                  </button>
                  <button
                    onClick={handleScheduleMeeting}
                    className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-left text-[13px] text-[color:var(--sh-ink)] hover:bg-[color:var(--sh-hair-3)]"
                    style={{ borderColor: 'var(--sh-hair)' }}
                    role="menuitem"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0a7d55" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    Schedule Meeting
                  </button>
                </div>
              </>
            )}
          </div>
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
        <ContainerChatButton
          resourceType="folder"
          resourceId={folderId}
          name={folder?.name || 'Workspace'}
          accessLevel={folder?.my_access_level}
          style={{ marginLeft: 'auto' }}
        />
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
                  statuses={sortedStatuses}
                  listByStatus={listByStatus}
                />
              )}
              {tab === 'board' && (
                  <BoardTab
                    requests={filteredRequests}
                    statuses={sortedStatuses}
                    onOpenRequest={(r) => openRequest(r.id)}
                    onNewRequest={handleNewTask}
                    onMoveStage={(id, name) => updateTask.mutate({ id, status: name })}
                  />
              )}
              {tab === 'tasks' && (
                tasksListId ? (
                  <TasksTab
                    listId={tasksListId}
                    statuses={sortedStatuses}
                    searchQuery={searchQuery}
                  />
                ) : (
                  <div style={{ padding: 60, textAlign: 'center', color: 'var(--sh-ink-3)' }}>
                    <div style={{ fontSize: 13, marginBottom: 14 }}>
                      No general tasks yet. Add plain to-dos or schedule a meeting here.
                    </div>
                    <button onClick={handleNewGeneralTask} className="lv-newtask-btn" style={{ margin: '0 auto' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      New General Task
                    </button>
                  </div>
                )
              )}
              {tab === 'reports' && (
                <ReportsTab requests={filteredRequests} plan={plan} folderId={folderId} />
              )}
              {tab === 'completed' && (
                <CompletedTab
                  requests={filteredRequests}
                  statuses={sortedStatuses}
                  listByStatus={listByStatus}
                />
              )}
            </>
          )}
        </div>
      </div>

      {showCreatePanel && createMode === 'design' && briefsListId && (
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
          statuses={sortedStatuses}
          defaultStatus={sortedStatuses[0]?.name}
        />
      )}

      {showCreatePanel && createMode === 'general' && tasksListId && (
        <TaskCreatePanel
          listId={tasksListId}
          spaceName={space?.name}
          spaceColor={space?.color || null}
          folderName={folder?.name || null}
          listName="Tasks"
          onClose={() => setShowCreatePanel(false)}
          statuses={sortedStatuses}
          defaultStatus={sortedStatuses[0]?.name}
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
