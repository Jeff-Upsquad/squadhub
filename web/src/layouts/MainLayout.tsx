import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

const ADMIN_APP_URL = import.meta.env.VITE_ADMIN_URL || (import.meta.env.PROD ? '/admin' : 'http://localhost:5174');
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useAuthStore } from '../stores/authStore';
import { usePMStore } from '../stores/pmStore';
import type { Workspace, Channel } from '@squadhub/shared';
import { connectSocket, disconnectSocket } from '../services/socket';
import ChatPanel from '../pages/app/chat/ChatPanel';
import CreateChannelModal from '../pages/app/chat/CreateChannelModal';
import ListPage from '../pages/app/pm/ListPage';
import HomeSidebar from '../pages/app/HomeSidebar';
import SettingsSlider from '../components/SettingsSlider';
import CheckInWidget from '../pages/app/checkin/CheckInWidget';

// ---- Types ----
type ActiveSection = 'home' | 'cal' | 'docs' | 'teams' | 'apps' | 'more';
export type HomeView = 'hub' | 'chat' | 'tasks';

// ---- Section definitions (6 items) ----
const SECTIONS: { id: ActiveSection; label: string; icon: React.ReactNode }[] = [
  {
    id: 'home',
    label: 'Home',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" />
      </svg>
    ),
  },
  {
    id: 'cal',
    label: 'Cal',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
    ),
  },
  {
    id: 'docs',
    label: 'Docs',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: 'teams',
    label: 'Teams',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    id: 'apps',
    label: 'Apps',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    id: 'more',
    label: 'More',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
  const [activeSection, setActiveSection] = useState<ActiveSection>('home');
  const [homeView, setHomeView] = useState<HomeView>('hub');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showChannelSettings, setShowChannelSettings] = useState(false);

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
      <div className="flex h-screen items-center justify-center bg-white">
        <p className="text-sm text-[#90A1B9]">Loading...</p>
      </div>
    );
  }

  // No workspaces
  if (!workspacesRes || workspaces.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="text-center">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[#0F172B]">Welcome to SquadHub</h2>
          <p className="mt-2 text-sm text-[#62748E]">Your workspace is being set up. Please refresh in a moment.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-[#0F172B] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1D293D]"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#F0F2F5] text-[#0F172B]">
      {/* Far-left icon sidebar — black */}
      <div className="flex w-[68px] shrink-0 flex-col items-center bg-[#1A1A2E] pt-2">
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="mb-1 flex h-8 w-8 items-center justify-center rounded-md text-[#8888A0] transition hover:bg-white/10 hover:text-white"
          title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          <svg className={`h-4 w-4 transition-transform ${sidebarOpen ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex flex-col items-center gap-0.5">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`relative flex h-11 w-11 flex-col items-center justify-center rounded-lg transition ${
                activeSection === section.id
                  ? 'bg-white/15 text-white'
                  : 'text-[#8888A0] hover:bg-white/10 hover:text-white'
              }`}
              title={SECTION_TITLES[section.id]}
            >
              {activeSection === section.id && (
                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[#2962FF]" />
              )}
              {section.icon}
              <span className="mt-0.5 font-[family-name:var(--font-mono)] text-[8px] leading-none">{section.label}</span>
            </button>
          ))}
        </div>

        {/* Bottom actions */}
        <div className="mt-auto flex flex-col items-center gap-2 pb-3">
          {user?.role === 'admin' && (
            <a
              href={ADMIN_APP_URL}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-[#8888A0] transition hover:bg-white/10 hover:text-white"
              title="Admin Panel"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </a>
          )}
          <button
            onClick={logout}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-[#8888A0] transition hover:bg-white/10 hover:text-white"
            title="Logout"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Module sidebar */}
      {currentWorkspace && (
        <div
          className={`flex h-full shrink-0 flex-col bg-[#F0F2F5] transition-[width] duration-200 ease-in-out ${
            sidebarOpen ? 'w-60' : 'w-0 overflow-hidden'
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
              <div className="border-b border-[#E2E8F0] px-4 py-3">
                <h3 className="font-[family-name:var(--font-display)] text-sm font-semibold text-[#0F172B]">{SECTION_TITLES[activeSection]}</h3>
              </div>
              <div className="flex flex-1 items-center justify-center px-4 py-12">
                <p className="font-[family-name:var(--font-mono)] text-center text-[10px] uppercase tracking-[0.12em] text-[#90A1B9]">Coming soon</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main content area — rounded top-left corner, Hashnode-style */}
      <div className="mt-2 flex flex-1 flex-col overflow-hidden rounded-tl-2xl border-l border-t border-[#E2E8F0] bg-white">
        {activeSection === 'home' ? (
          homeView === 'chat' ? (
            <>
              {activeChannelId && (
                <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-3">
                  <div className="flex items-center">
                    <span className="mr-2 text-[#90A1B9]">#</span>
                    <span className="text-sm font-medium text-[#0F172B]">
                      {channels.find((c) => c.id === activeChannelId)?.name}
                    </span>
                    {channels.find((c) => c.id === activeChannelId)?.description && (
                      <span className="ml-3 text-xs text-[#999999] truncate max-w-xs">
                        {channels.find((c) => c.id === activeChannelId)?.description}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowChannelSettings(!showChannelSettings)}
                    className={`rounded p-1.5 transition ${
                      showChannelSettings ? 'bg-[#F1F5F9] text-[#0F172B]' : 'text-[#999999] hover:text-[#0F172B]'
                    }`}
                    title="Channel settings"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                    </svg>
                  </button>
                </div>
              )}
              <div className="flex flex-1 overflow-hidden">
                {activeChannelId ? (
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <ChatPanel channelId={activeChannelId} />
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-[#90A1B9]">
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
            <ListPage />
          ) : (
            <CheckInWidget />
          )
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-[#90A1B9]">
            <div className="mb-4 opacity-20">
              {SECTIONS.find((s) => s.id === activeSection)?.icon}
            </div>
            <h3 className="font-[family-name:var(--font-display)] text-lg font-medium text-[#62748E]">{SECTION_TITLES[activeSection]}</h3>
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
