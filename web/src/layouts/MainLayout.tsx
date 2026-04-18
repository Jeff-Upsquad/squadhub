import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

const ADMIN_APP_URL = process.env.NEXT_PUBLIC_ADMIN_URL || (process.env.NODE_ENV === 'production' ? '/admin' : 'http://localhost:3001');
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useAuthStore } from '../stores/authStore';
import { usePMStore } from '../stores/pmStore';
import type { Workspace, Channel } from '@squadhub/shared';
import { connectSocket, disconnectSocket } from '../services/socket';
import ChatPanel from '../views/app/chat/ChatPanel';
import CreateChannelModal from '../views/app/chat/CreateChannelModal';
import ListPage from '../views/app/pm/ListPage';
import HomeSidebar from '../views/app/HomeSidebar';
import SettingsSlider from '../components/SettingsSlider';
import CheckInWidget from '../views/app/checkin/CheckInWidget';
import TimeManagementPage from '../views/app/time-management/TimeManagementPage';
import ThemeToggle from '../components/ThemeToggle';
import ActiveTimer from '../components/ActiveTimer';
import ClientDashboard from '../views/app/client/ClientDashboard';
import PartnerDashboard from '../views/app/partner/PartnerDashboard';
import PartnerCashBook from '../views/app/partner/PartnerCashBook';
import ClientCashBook from '../views/app/client/ClientCashBook';
import ClientDesignDashboard from '../views/app/pm/client-design/ClientDesignDashboard';
import { useUserType } from '../hooks/useUserType';

// ---- Types (ORIGINAL) ----
type ActiveSection = 'home' | 'cal' | 'docs' | 'teams' | 'apps' | 'more';
export type HomeView = 'hub' | 'chat' | 'tasks' | 'checkin' | 'checkin-partners' | 'time-management' | 'cashbook';

// ---- Section definitions matching Figma icon bar (72px wide, 38x38 containers, 22x22 icons) ----
const SECTIONS: { id: ActiveSection; label: string; icon: React.ReactNode }[] = [
  {
    id: 'home',
    label: 'Home',
    icon: (
      <svg className="h-[22px] w-[22px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" />
      </svg>
    ),
  },
  {
    id: 'docs',
    label: 'Docs',
    icon: (
      <svg className="h-[22px] w-[22px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: 'cal',
    label: 'Cal',
    icon: (
      <svg className="h-[22px] w-[22px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
    ),
  },
  {
    id: 'apps',
    label: 'Apps',
    icon: (
      <svg className="h-[22px] w-[22px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    id: 'more',
    label: 'More',
    icon: (
      <svg className="h-[22px] w-[22px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
      </svg>
    ),
  },
];

const SECTION_TITLES: Record<ActiveSection, string> = {
  home: 'Home',
  cal: 'Calendar',
  docs: 'Documents',
  teams: 'Teams',
  apps: 'Apps',
  more: 'More',
};

export default function MainLayout() {
  const { currentWorkspace, activeChannelId, setWorkspace, setChannels, setActiveChannel } = useWorkspaceStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const pmReset = usePMStore((s) => s.reset);
  const activeListId = usePMStore((s) => s.activeListId);
  const activeDesignFolderId = usePMStore((s) => s.activeDesignFolderId);
  const userType = useUserType();
  const [activeSection, setActiveSection] = useState<ActiveSection>('home');
  const [homeView, setHomeView] = useState<HomeView>('hub');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showChannelSettings, setShowChannelSettings] = useState(false);

  // Auto-switch to tasks view when a list is selected
  useEffect(() => {
    if (activeListId) setHomeView('tasks');
  }, [activeListId]);

  // Auto-switch to tasks view when a client opens a design folder
  useEffect(() => {
    if (activeDesignFolderId) setHomeView('tasks');
  }, [activeDesignFolderId]);

  // Fetch workspaces
  const { data: workspacesRes, isLoading: workspacesLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api.get('/workspaces').then((r) => r.data),
  });

  const workspaces: (Workspace & { my_role?: string })[] = useMemo(() => workspacesRes?.data || [], [workspacesRes]);

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
    <div className="flex h-screen bg-[#0F172A] text-foreground">
      {/* Far-left icon sidebar — Figma: 72px wide, bg #0F172A, gap 4px, top 23px */}
      <div className="flex w-[72px] shrink-0 flex-col items-start gap-[4px] pt-[23px]">
        {SECTIONS.map((section) => {
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className="flex h-[70.5px] w-[72px] flex-col items-center justify-center gap-[4px] py-[6px]"
              title={SECTION_TITLES[section.id]}
            >
              {/* Icon container: 38x38, rounded-[14px] */}
              <div className={`flex h-[38px] w-[38px] items-center justify-center rounded-[14px] px-[8px] transition ${
                isActive
                  ? 'bg-white text-[#0F172A] shadow-[0px_1px_3px_rgba(0,0,0,0.1),0px_1px_2px_-1px_rgba(0,0,0,0.1)]'
                  : 'text-[#99A1AF]'
              }`}>
                {section.icon}
              </div>
              {/* Label: Inter Medium 11px, line-height 16.5px */}
              <span className={`font-[Inter] text-[11px] font-medium leading-[16.5px] tracking-[0.065px] text-center whitespace-nowrap ${
                isActive ? 'text-white' : 'text-[#99A1AF]'
              }`}>
                {section.label}
              </span>
            </button>
          );
        })}

        {/* Spacer to push bottom actions down */}
        <div className="flex-1" />

        {/* Settings & Theme toggle */}
        <div className="flex flex-col items-center gap-[4px] pb-[16px] w-full">
          <ThemeToggle />
          <button
            onClick={() => {
              logout();
              pmReset();
            }}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-[14px] transition hover:bg-white/10"
            title="Log out"
          >
            <svg className="h-[22px] w-[22px] text-[#99A1AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3-3h-9m9 0l-3-3m3 3l-3 3" />
            </svg>
          </button>
        </div>
      </div>

      {/* Module sidebar + content wrapper with rounded corners */}
      {currentWorkspace && (
        <div
          className={`flex h-full shrink-0 flex-col bg-sidebar rounded-tl-[20px] rounded-bl-[20px] overflow-hidden transition-[width] duration-200 ease-in-out ${
            sidebarOpen ? 'w-[280px]' : 'w-0'
          }`}
        >
          {activeSection === 'home' ? (
            <HomeSidebar
              workspaceId={currentWorkspace.id}
              channels={channels}
              activeChannelId={activeChannelId}
              homeView={homeView}
              onChangeView={setHomeView}
              onSelectChannel={handleSelectChannel}
              onCreateChannel={() => setShowCreateChannel(true)}
              onOpenSpaces={handleOpenSpaces}
            />
          ) : (
            <div className="flex flex-col">
              <div className="border-b border-divider px-4 py-3">
                <h3 className="text-sm font-semibold text-foreground">{SECTION_TITLES[activeSection]}</h3>
              </div>
              <div className="flex flex-1 items-center justify-center px-4 py-12">
                <p className="text-center text-[10px] uppercase tracking-[0.12em] text-foreground-muted">Coming soon</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden bg-surface">
        <ActiveTimer />
        {activeSection === 'home' ? (
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
            ) : (
              <ListPage />
            )
          ) : homeView === 'checkin' ? (
            <CheckInWidget title="Daily Check-In Teammates" context="teammates" />
          ) : homeView === 'checkin-partners' ? (
            <CheckInWidget title="Daily Check-In Partners" context="partners" />
          ) : homeView === 'time-management' ? (
            <TimeManagementPage />
          ) : homeView === 'hub' && userType === 'client' ? (
            <ClientDashboard />
          ) : homeView === 'hub' && userType === 'partner' ? (
            <PartnerDashboard />
          ) : homeView === 'cashbook' && userType === 'partner' ? (
            <PartnerCashBook />
          ) : homeView === 'cashbook' && userType === 'client' ? (
            <ClientCashBook />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-foreground-dim">
              <h3 className="font-[family-name:var(--font-display)] text-lg font-medium text-foreground-muted">Welcome to SquadHub</h3>
              <p className="mt-1 text-sm">Select a channel, space, or module to get started</p>
            </div>
          )
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-foreground-dim">
            <div className="mb-4 opacity-20">
              {(SECTIONS.find((s) => s.id === activeSection) as any)?.icon}
            </div>
            <h3 className="font-[family-name:var(--font-display)] text-lg font-medium text-foreground-muted">{SECTION_TITLES[activeSection]}</h3>
            <p className="mt-1 text-sm">Coming soon</p>
          </div>
        )}
      </div>

      {/* Create channel modal */}
      {showCreateChannel && currentWorkspace && (
        <CreateChannelModal
          workspaceId={currentWorkspace.id}
          onClose={() => setShowCreateChannel(false)}
        />
      )}
    </div>
  );
}
