import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

const ADMIN_APP_URL = process.env.NEXT_PUBLIC_ADMIN_URL || (process.env.NODE_ENV === 'production' ? '/admin' : 'http://localhost:3001');
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useAuthStore } from '../stores/authStore';
import { usePMStore } from '../stores/pmStore';
import type { Workspace, Channel, RoleHomeView } from '@squadhub/shared';
import { connectSocket, disconnectSocket } from '../services/socket';
import ChatPanel from '../views/app/chat/ChatPanel';
import CreateChannelModal from '../views/app/chat/CreateChannelModal';
import GlobalCreateTaskModal from '../views/app/pm/GlobalCreateTaskModal';
import ListPage from '../views/app/pm/ListPage';
import FolderPage from '../views/app/pm/FolderPage';
import SpacePage from '../views/app/pm/SpacePage';
import HomeSidebar from '../views/app/HomeSidebar';
import SettingsSlider from '../components/SettingsSlider';
import CheckInWidget from '../views/app/checkin/CheckInWidget';
import TimeManagementPage from '../views/app/time-management/TimeManagementPage';
import SalesLeadsPage from '../views/app/sales/SalesLeadsPage';
import ThemeToggle from '../components/ThemeToggle';
import ActiveTimer from '../components/ActiveTimer';
import TimeSheetPanel from '../components/TimeSheetPanel';
import ClientDashboard from '../views/app/client/ClientDashboard';
import PartnerDashboard from '../views/app/partner/PartnerDashboard';
import PartnerCashBook from '../views/app/partner/PartnerCashBook';
import ClientCashBook from '../views/app/client/ClientCashBook';
import ClientDesignDashboard from '../views/app/pm/client-design/ClientDesignDashboard';
import MemberHome from '../views/app/home/MemberHome';
import UserHome from '../views/app/home/UserHome';
import GuestHome from '../views/app/home/GuestHome';
import GlobalTaskDetailPanel from '../views/app/home/GlobalTaskDetailPanel';
import EmergencyBanner from '../views/app/pm/EmergencyBanner';
import InboxView from '../views/app/InboxView';
import MyTasksView from '../views/app/MyTasksView';
import LearningShell from '../views/app/learning/LearningShell';
import { useUserType } from '../hooks/useUserType';
import { useUnreadCount } from '../hooks/useUnreadCount';

// ---- Types ----
type ActiveSection = 'home' | 'cal' | 'docs' | 'teams' | 'apps' | 'clients' | 'learning' | 'more';
export type HomeView = 'hub' | 'chat' | 'tasks' | 'inbox' | 'my-tasks' | 'mentions' | 'later' | 'checkin' | 'checkin-partners' | 'time-management' | 'sales-leads' | 'cashbook';

// ---- Rail icons (stroke-1.6, 18x18) ----
const ICON = {
  home: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />
    </svg>
  ),
  inbox: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M3 13V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8" />
      <path d="M3 13h5l2 3h4l2-3h5v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  tasks: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  ),
  docs: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M8 13h8M8 17h6" />
    </svg>
  ),
  cal: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  apps: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  learning: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  timesheet: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  users: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21a7 7 0 0 1 14 0" />
      <circle cx="17" cy="7" r="3" />
      <path d="M22 18a5 5 0 0 0-7-4.6" />
    </svg>
  ),
  more: (
    <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </svg>
  ),
} as const;

const SECTION_TITLES: Record<ActiveSection, string> = {
  home: 'Home',
  cal: 'Calendar',
  docs: 'Documents',
  teams: 'Teams',
  apps: 'Apps',
  clients: 'Clients',
  learning: 'Learning',
  more: 'More',
};

// Single rail button — used in both nav groups
function RailBtn({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`relative grid h-10 w-10 place-items-center rounded-[9px] transition ${
        active
          ? 'border border-[var(--sh-hair)] bg-[var(--surface)] text-[var(--sh-ink)]'
          : 'border border-transparent text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
      }`}
      style={active ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
    >
      {icon}
      {badge != null && badge > 0 && (
        <span
          className="absolute top-[3px] right-[3px] grid min-w-[14px] h-[14px] place-items-center rounded-full bg-[var(--sh-ink)] text-[var(--sidebar)] text-[9px] font-semibold px-[3px] leading-none"
        >
          {badge}
        </span>
      )}
    </button>
  );
}

export default function MainLayout() {
  const { currentWorkspace, activeChannelId, setWorkspace, setChannels, setActiveChannel } = useWorkspaceStore();
  const myHomeView: RoleHomeView = currentWorkspace?.my_home_view ?? 'user';
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const pmReset = usePMStore((s) => s.reset);
  const activeListId = usePMStore((s) => s.activeListId);
  const activeFolderId = usePMStore((s) => s.activeFolderId);
  const activeSpacePageId = usePMStore((s) => s.activeSpacePageId);
  const activeDesignFolderId = usePMStore((s) => s.activeDesignFolderId);
  const userType = useUserType();
  const [activeSection, setActiveSection] = useState<ActiveSection>('home');
  const [homeView, setHomeView] = useState<HomeView>('hub');
  const { data: unreadCount = 0 } = useUnreadCount();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showChannelSettings, setShowChannelSettings] = useState(false);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [timesheetOpen, setTimesheetOpen] = useState(false);
  const [timesheetAnchor, setTimesheetAnchor] = useState<DOMRect | null>(null);

  // Auto-switch to tasks view when a list is selected
  useEffect(() => {
    if (activeListId) setHomeView('tasks');
  }, [activeListId]);

  // Auto-switch to tasks view when a folder is selected
  useEffect(() => {
    if (activeFolderId) setHomeView('tasks');
  }, [activeFolderId]);

  // Auto-switch to tasks view when a space is opened (space page)
  useEffect(() => {
    if (activeSpacePageId) setHomeView('tasks');
  }, [activeSpacePageId]);

  // Auto-switch to tasks view when a client opens a design folder
  useEffect(() => {
    if (activeDesignFolderId) setHomeView('tasks');
  }, [activeDesignFolderId]);

  // Fetch workspaces
  const { data: workspacesRes, isLoading: workspacesLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api.get('/workspaces').then((r) => r.data),
  });

  const workspaces: (Workspace & { my_role?: string; my_home_view?: RoleHomeView })[] = useMemo(() => workspacesRes?.data || [], [workspacesRes]);

  // Auto-select first workspace
  useEffect(() => {
    if (workspaces.length > 0 && !currentWorkspace) {
      setWorkspace(workspaces[0]);
    }
  }, [workspaces, currentWorkspace, setWorkspace]);

  // Fetch channels for current workspace
  const { data: channelsRes } = useQuery({
    queryKey: ['channels', currentWorkspace?.id],
    queryFn: () => api.get(`/channels?workspace_id=${currentWorkspace!.id}`).then((r) => r.data),
    enabled: !!currentWorkspace,
  });

  const channels: Channel[] = useMemo(() => channelsRes?.data || [], [channelsRes]);

  // Update store when channels change
  useEffect(() => {
    if (channels.length > 0) {
      setChannels(channels);
      if (!activeChannelId) {
        setActiveChannel(channels[0].id);
      }
    }
  }, [channels, activeChannelId, setChannels, setActiveChannel]);

  // Connect socket when workspace loads
  useEffect(() => {
    if (currentWorkspace) {
      const socket = connectSocket();
      socket.emit('join_workspace', currentWorkspace.id);
      return () => { disconnectSocket(); };
    }
  }, [currentWorkspace]);

  // Handlers for HomeSidebar
  const handleSelectChannel = (channelId: string) => {
    setActiveChannel(channelId);
    setHomeView('chat');
  };

  const handleOpenSpaces = () => {
    setHomeView('tasks');
  };

  // Loading state
  if (workspacesLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <p className="text-sm text-foreground-dim">Loading...</p>
      </div>
    );
  }

  // No workspaces
  if (!workspacesRes || workspaces.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <div className="text-center">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-foreground">Welcome to SquadHub</h2>
          <p className="mt-2 text-sm text-foreground-muted">Your workspace is being set up. Please refresh in a moment.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-surface transition hover:opacity-80"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  const activeChannel = channels.find((c) => c.id === activeChannelId);

  return (
    <div className="flex h-screen bg-[var(--sidebar)] text-foreground">
      {/* Far-left monochrome rail — 64px wide, inset right shadow, light gray */}
      <div
        className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-[var(--sh-hair)] bg-[var(--icon-bar)] px-2 pt-[14px] pb-3 relative z-[3]"
        style={{ boxShadow: 'var(--sh-rail-inset)' }}
      >
        {/* Serif "S" logo */}
        <div
          className="mb-[14px] grid h-9 w-9 place-items-center rounded-[10px] bg-[var(--sh-ink)] text-[var(--sidebar)]"
          style={{ fontFamily: 'var(--font-serif, Instrument Serif, serif)', fontSize: 22, letterSpacing: '-0.02em', boxShadow: 'var(--sh-shadow-sm)' }}
          title="SquadHub"
        >
          S
        </div>

        {/* Main nav: Home / Inbox / Tasks / Docs / Cal / Apps */}
        <div className="flex w-full flex-col items-center gap-[2px]">
          <RailBtn
            icon={ICON.home}
            label="Home"
            active={activeSection === 'home' && homeView === 'hub'}
            onClick={() => { setActiveSection('home'); setHomeView('hub'); }}
          />
          <RailBtn
            icon={ICON.inbox}
            label="Inbox"
            badge={unreadCount > 0 ? unreadCount : undefined}
            active={activeSection === 'home' && homeView === 'inbox'}
            onClick={() => { setActiveSection('home'); setHomeView('inbox'); }}
          />
          <RailBtn
            icon={ICON.tasks}
            label="Tasks"
            active={activeSection === 'home' && homeView === 'my-tasks'}
            onClick={() => { setActiveSection('home'); setHomeView('my-tasks'); }}
          />
          <RailBtn icon={ICON.docs} label="Docs" active={activeSection === 'docs'} onClick={() => setActiveSection('docs')} />
          <RailBtn icon={ICON.cal}  label="Cal"  active={activeSection === 'cal'}  onClick={() => setActiveSection('cal')} />
          <RailBtn icon={ICON.apps} label="Apps" active={activeSection === 'apps'} onClick={() => setActiveSection('apps')} />
          <RailBtn icon={ICON.learning} label="Learning" active={activeSection === 'learning'} onClick={() => setActiveSection('learning')} />
          <button
            onClick={(e) => {
              setTimesheetAnchor((e.currentTarget as HTMLElement).getBoundingClientRect());
              setTimesheetOpen((v) => !v);
            }}
            title="Time sheet"
            className={`relative grid h-10 w-10 place-items-center rounded-[9px] transition ${
              timesheetOpen
                ? 'border border-[var(--sh-hair)] bg-[var(--surface)] text-[var(--sh-ink)]'
                : 'border border-transparent text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]'
            }`}
            style={timesheetOpen ? { boxShadow: 'var(--sh-shadow-sm)' } : undefined}
          >
            {ICON.timesheet}
          </button>
        </div>

        {/* Divider */}
        <div className="h-px w-7 bg-[var(--sh-hair-2)] my-2" />

        {/* Second nav: Clients / More */}
        <div className="flex w-full flex-col items-center gap-[2px]">
          <RailBtn icon={ICON.users} label="Clients" active={activeSection === 'clients'} onClick={() => setActiveSection('clients')} />
          <RailBtn icon={ICON.more}  label="More"    active={activeSection === 'more'}    onClick={() => setActiveSection('more')} />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom group: theme + logout + avatar */}
        <div className="flex w-full flex-col items-center gap-[2px]">
          <div className="grid h-10 w-10 place-items-center">
            <ThemeToggle />
          </div>
          <button
            onClick={() => {
              logout();
              pmReset();
            }}
            className="grid h-10 w-10 place-items-center rounded-[9px] text-[var(--sh-ink-3)] transition hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)]"
            title="Log out"
          >
            <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3-3h-9m9 0l-3-3m3 3l-3 3" />
            </svg>
          </button>
          <div
            className="mt-1 grid h-8 w-8 place-items-center rounded-full bg-[var(--sh-ink)] text-[var(--sidebar)] text-[11px] font-semibold relative"
            style={{ border: '2px solid var(--icon-bar)' }}
            title={user?.display_name || user?.email || 'Me'}
          >
            {(user?.display_name || user?.email || 'ME').split(/[ @]/).slice(0, 2).map((s) => s.charAt(0).toUpperCase()).join('').slice(0, 2) || 'ME'}
            <span className="absolute -right-[2px] -bottom-[2px] h-[10px] w-[10px] rounded-full bg-[var(--icon-bar)]" style={{ border: '2px solid var(--sh-ink)' }} />
          </div>
        </div>
      </div>

      {/* Module sidebar — always visible, flat edges, drop shadow to the right */}
      {currentWorkspace && activeSection !== 'learning' && (
        <div
          className={`flex h-full shrink-0 flex-col overflow-hidden bg-[var(--sidebar)] border-r border-[var(--sh-hair)] relative z-[2] transition-[width] duration-200 ease-in-out ${
            sidebarOpen ? 'w-[280px]' : 'w-0'
          }`}
          style={{ boxShadow: 'var(--sh-sidebar-drop)' }}
        >
          <HomeSidebar
            workspaceId={currentWorkspace.id}
            channels={channels}
            activeChannelId={activeChannelId}
            homeView={homeView}
            onChangeView={(v) => { setActiveSection('home'); setHomeView(v); }}
            onSelectChannel={handleSelectChannel}
            onCreateChannel={() => setShowCreateChannel(true)}
            onOpenSpaces={handleOpenSpaces}
          />
        </div>
      )}

      {/* Main content area */}
      <div className="relative flex flex-1 flex-col overflow-hidden bg-surface">
        {/* Universal "New task" button — visible in all views */}
        <button
          type="button"
          onClick={() => setShowCreateTaskModal(true)}
          title="New task"
          aria-label="Create new task"
          className="absolute right-3 top-2 z-40 grid h-8 w-8 place-items-center rounded-[9px] border border-transparent text-[var(--sh-ink-3)] hover:bg-[var(--sh-hair-3)] hover:text-[var(--sh-ink)] transition"
        >
          <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <EmergencyBanner />
        <ActiveTimer />
        {activeSection === 'learning' ? (
          <LearningShell />
        ) : activeSection !== 'home' ? (
          <div className="sh-view flex flex-1 flex-col items-center justify-center">
            <div className="mb-4 opacity-20 text-[var(--sh-ink-3)]">{ICON[(activeSection === 'clients' ? 'users' : activeSection) as keyof typeof ICON]}</div>
            <h3 className="serif text-[40px] text-[var(--sh-ink)]" style={{ fontFamily: 'var(--font-serif, Instrument Serif, serif)', letterSpacing: '-0.01em' }}>{SECTION_TITLES[activeSection]}</h3>
            <p className="mt-1 text-[12.5px] text-[var(--sh-ink-3)]">Coming soon</p>
          </div>
        ) : homeView === 'inbox' ? (
          <InboxView setHomeView={setHomeView} />
        ) : homeView === 'my-tasks' ? (
          <MyTasksView />
        ) : homeView === 'mentions' ? (
          <div className="sh-view flex flex-1 flex-col items-center justify-center">
            <h3 className="serif text-[40px] text-[var(--sh-ink)]" style={{ fontFamily: 'var(--font-serif, Instrument Serif, serif)', letterSpacing: '-0.01em' }}>Mentions</h3>
            <p className="mt-1 text-[12.5px] text-[var(--sh-ink-3)]">Coming soon</p>
          </div>
        ) : homeView === 'later' ? (
          <div className="sh-view flex flex-1 flex-col items-center justify-center">
            <h3 className="serif text-[40px] text-[var(--sh-ink)]" style={{ fontFamily: 'var(--font-serif, Instrument Serif, serif)', letterSpacing: '-0.01em' }}>Later</h3>
            <p className="mt-1 text-[12.5px] text-[var(--sh-ink-3)]">Coming soon</p>
          </div>
        ) : (
          homeView === 'chat' ? (
            <>
              {activeChannelId && (
                <div className="flex flex-col border-b border-divider">
                  <div className="flex items-center justify-between px-2 py-[7px]">
                    <div className="flex items-center gap-1 w-[360px]">
                      {/* Channel name with hashtag */}
                      <div className="flex items-center gap-1.5 rounded px-2 py-1 overflow-hidden">
                        <svg className="h-4 w-4 shrink-0 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                        </svg>
                        <span className="text-[18px] font-black leading-[26px] text-foreground">
                          {activeChannel?.name}
                        </span>
                        <svg className="h-4 w-4 shrink-0 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                      {activeChannel?.description && (
                        <span className="text-[12px] leading-[16px] text-foreground-muted truncate flex-1">
                          {activeChannel.description}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5">
                      {/* Members pill */}
                      <div className="flex items-center gap-2 rounded-[7px] border border-divider px-2 py-1.5">
                        <span className="text-[12px] font-semibold leading-[16px] text-foreground-muted">
                          {channels.length}
                        </span>
                      </div>
                      {/* Huddle */}
                      <div className="flex items-center gap-2 rounded-[7px] border border-divider px-2 py-1.5">
                        <svg className="h-[22px] w-[22px] text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                        </svg>
                      </div>
                      {/* Canvas */}
                      <div className="flex items-center gap-2 rounded-[7px] border border-divider px-2 py-1.5">
                        <svg className="h-5 w-5 text-foreground-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                        <span className="text-[12px] font-semibold leading-[16px] text-foreground-muted">Canvas</span>
                      </div>
                      {/* Settings */}
                      <button
                        onClick={() => setShowChannelSettings(!showChannelSettings)}
                        className={`rounded-[7px] border border-divider p-1.5 transition ${
                          showChannelSettings ? 'bg-surface-alt text-foreground' : 'text-foreground-muted hover:bg-surface-alt hover:text-foreground'
                        }`}
                        title="Channel settings"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex flex-1 overflow-hidden">
                {activeChannelId ? (
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <ChatPanel channelId={activeChannelId} />
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-foreground-dim">
                    Select a channel to start chatting
                  </div>
                )}
                {showChannelSettings && activeChannelId && (() => {
                  const ch = channels.find((c) => c.id === activeChannelId);
                  return ch ? (
                    <SettingsSlider
                      type="channel"
                      id={ch.id}
                      name={ch.name}
                      description={ch.description}
                      onClose={() => setShowChannelSettings(false)}
                      onDeleted={() => {
                        setShowChannelSettings(false);
                        setActiveChannel(null);
                      }}
                    />
                  ) : null;
                })()}
              </div>
            </>
          ) : homeView === 'tasks' ? (
            activeDesignFolderId ? (
              <ClientDesignDashboard folderId={activeDesignFolderId} />
            ) : activeFolderId && !activeListId ? (
              <FolderPage />
            ) : activeSpacePageId && !activeListId && !activeFolderId ? (
              <SpacePage />
            ) : (
              <ListPage />
            )
          ) : homeView === 'checkin' ? (
            <CheckInWidget title="Daily Check-In Teammates" context="teammates" />
          ) : homeView === 'checkin-partners' ? (
            <CheckInWidget title="Daily Check-In Partners" context="partners" />
          ) : homeView === 'time-management' ? (
            <TimeManagementPage />
          ) : homeView === 'sales-leads' ? (
            <SalesLeadsPage />
          ) : homeView === 'hub' && (userType === 'client' || userType === 'client_staff') ? (
            <ClientDashboard />
          ) : homeView === 'hub' && userType === 'partner' ? (
            <PartnerDashboard />
          ) : homeView === 'cashbook' && userType === 'partner' ? (
            <PartnerCashBook />
          ) : homeView === 'cashbook' && (userType === 'client' || userType === 'client_staff') ? (
            <ClientCashBook />
          ) : (
            myHomeView === 'member' ? <MemberHome onOpenInbox={() => { setActiveSection('home'); setHomeView('inbox'); }} /> :
            myHomeView === 'guest' ? <GuestHome onOpenInbox={() => { setActiveSection('home'); setHomeView('inbox'); }} /> :
            <UserHome onOpenInbox={() => { setActiveSection('home'); setHomeView('inbox'); }} />
          )
        )}
      </div>

      {/* Global task detail panel — opens from any view when activeTaskId is set */}
      <GlobalTaskDetailPanel />

      {/* Time sheet panel — anchored to the rail button */}
      {timesheetOpen && (
        <TimeSheetPanel
          anchorRect={timesheetAnchor}
          onClose={() => setTimesheetOpen(false)}
        />
      )}

      {/* Create channel modal */}
      {showCreateChannel && currentWorkspace && (
        <CreateChannelModal
          workspaceId={currentWorkspace.id}
          onClose={() => setShowCreateChannel(false)}
        />
      )}

      {/* Universal create task modal — opens from the global + button */}
      {showCreateTaskModal && (
        <GlobalCreateTaskModal onClose={() => setShowCreateTaskModal(false)} />
      )}
    </div>
  );
}
