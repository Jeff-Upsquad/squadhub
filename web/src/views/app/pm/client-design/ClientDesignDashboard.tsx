import { useEffect, useState } from 'react';
import './design.css';
import { useFolderTasks } from '../../../../hooks/useFolderTasks';
import { useClientDesignPlan } from '../../../../hooks/useClientDesignPlan';
import DashboardTab from './tabs/DashboardTab';
import RequestsTab from './tabs/RequestsTab';
import BoardTab from './tabs/BoardTab';
import ReportsTab from './tabs/ReportsTab';
import CompletedTab from './tabs/CompletedTab';
import NewRequestModal from './NewRequestModal';
import RequestDetailDrawer from './RequestDetailDrawer';
import SquadShareModal from './SquadShareModal';
import { IconPlus, IconSearch, IconKeyboard, IconShare } from './atoms/Icons';
import type { RequestRowData } from './atoms/RequestRow';

type TabKey = 'dashboard' | 'requests' | 'board' | 'reports' | 'completed';
const TAB_STORAGE = 'cd.tab';

export default function ClientDesignDashboard({ folderId }: { folderId: string }) {
  const [tab, setTab] = useState<TabKey>(() => {
    if (typeof window === 'undefined') return 'dashboard';
    const v = window.localStorage.getItem(TAB_STORAGE);
    return (v as TabKey) || 'dashboard';
  });
  const [openRequest, setOpenRequest] = useState<RequestRowData | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const { folder, requests, byStatus, listByStatus, isLoading } = useFolderTasks(folderId);
  const plan = useClientDesignPlan();

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(TAB_STORAGE, tab);
  }, [tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShowNew(true);
      }
      if (e.key === 'Escape') {
        setShowNew(false);
        setOpenRequest(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeCount = requests.filter((r) => r._derivedStatus !== 'done').length;
  const doneCount = requests.filter((r) => r._derivedStatus === 'done').length;

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'requests', label: 'Requests', count: activeCount },
    { key: 'board', label: 'Board' },
    { key: 'reports', label: 'Reports' },
    { key: 'completed', label: 'Completed', count: doneCount },
  ];

  return (
    <div className="cd-root">
      <div className="cd-topbar">
        <div className="cd-breadcrumbs">
          <span>Design workspace</span>
          <span className="sep">/</span>
          <span className="cur">{folder?.name || 'Loading…'}</span>
        </div>
        <div className="cd-topbar-spacer" />
        <div className="cd-search-bar">
          <IconSearch size={14} />
          <input placeholder="Search requests…" />
        </div>
        {(folder?.my_access_level === 'manager') && (
          <button
            className="cd-topbar-btn"
            style={{ border: '1px solid var(--cd-br-1)' }}
            onClick={() => setShowShare(true)}
            title="Share this space"
          >
            <IconShare size={13} />
            Share
          </button>
        )}
        <button className="cd-topbar-btn primary" onClick={() => setShowNew(true)}>
          <IconPlus size={14} />
          New Request
          <span className="cd-topbar-kbd">N</span>
        </button>
      </div>

      <div className="cd-tab-bar">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`cd-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.count != null && <span className="cd-tab-count">{t.count}</span>}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className="cd-topbar-btn"
          style={{ marginRight: 12, color: 'var(--cd-fg-3)' }}
          title="Shortcuts: N new request, Esc close"
        >
          <IconKeyboard size={13} />
        </button>
      </div>

      <div className="cd-view">
        {isLoading && requests.length === 0 ? (
          <div
            style={{
              padding: 60,
              textAlign: 'center',
              fontFamily: 'var(--cd-font-mono)',
              fontSize: 11,
              color: 'var(--cd-fg-3)',
            }}
          >
            Loading design workspace…
          </div>
        ) : (
          <>
            {tab === 'dashboard' && (
              <DashboardTab
                requests={requests}
                plan={plan}
                onOpenRequest={setOpenRequest}
                onSwitchTab={(t) => setTab(t as TabKey)}
              />
            )}
            {tab === 'requests' && (
              <RequestsTab requests={requests} onOpenRequest={setOpenRequest} />
            )}
            {tab === 'board' && (
              <BoardTab
                byStatus={byStatus}
                onOpenRequest={setOpenRequest}
                onNewRequest={() => setShowNew(true)}
              />
            )}
            {tab === 'reports' && <ReportsTab requests={requests} plan={plan} />}
            {tab === 'completed' && (
              <CompletedTab requests={requests} onOpenRequest={setOpenRequest} />
            )}
          </>
        )}
      </div>

      {showNew && (
        <NewRequestModal
          briefsListId={listByStatus.queued?.id || null}
          onClose={() => setShowNew(false)}
          onSubmitted={() => setShowNew(false)}
        />
      )}
      {openRequest && (
        <RequestDetailDrawer request={openRequest} onClose={() => setOpenRequest(null)} />
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
