import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

const ADMIN_APP_URL = import.meta.env.PROD ? 'http://72.61.245.97:3081' : 'http://localhost:5174';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useAuthStore } from '../stores/authStore';
import { usePMStore } from '../stores/pmStore';
import type { Workspace, Channel } from '@squadhub/shared';
import { connectSocket, disconnectSocket } from '../services/socket';
import ModuleSwitcher, { type ActiveSection, type HomeTab } from '../components/ModuleSwitcher';
import ChannelSidebar from '../pages/app/chat/ChannelSidebar';
import ChatPanel from '../pages/app/chat/ChatPanel';
import CreateChannelModal from '../pages/app/chat/CreateChannelModal';
import SpaceTree from '../pages/app/pm/SpaceTree';
import ListPage from '../pages/app/pm/ListPage';

// ---- Section definitions ----
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
    id: 'docs',
    label: 'Docs',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: 'apps',
    label: 'Apps',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
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
];

// ---- Placeholder sidebar/content labels ----
const SECTION_TITLES: Record<ActiveSection, string> = {
  home: 'Home',
  docs: 'Documents',
  calendar: 'Calendar',
  apps: 'Apps',
  teams: 'Teams',
};

export default function MainLayout() {
  const { currentWorkspace, activeChannelId, setWorkspace, setChannels, setActiveChannel } = useWorkspaceStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const pmReset = usePMStore((s) => s.reset);
  const [activeSection, setActiveSection] = useState<ActiveSection>('home');
  const [homeTab, setHomeTab] = useState<HomeTab>('chat');
  const [showCreateChannel, setShowCreateChannel] = useState(false);

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

  // Loading state
  if (workspacesLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <p className="text-sm text-[#999]">Loading...</p>
      </div>
    );
  }

  // No workspaces — user hasn't been added yet
  if (!workspacesRes || workspaces.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="text-center">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[#171717]">Welcome to SquadHub</h2>
          <p className="mt-2 text-sm text-[#666]">Your workspace is being set up. Please refresh in a moment.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-[#171717] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#333]"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-white text-[#171717]">
      {/* Far-left section icon sidebar */}
      <div className="flex w-14 flex-col items-center border-r border-[#eaeaea] bg-white pt-3">
        <div className="flex flex-col items-center gap-1">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition ${
                activeSection === section.id
                  ? 'bg-[#f5f5f5] text-[#171717]'
                  : 'text-[#999] hover:bg-[#f5f5f5] hover:text-[#666]'
              }`}
              title={section.label}
            >
              {activeSection === section.id && (
                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[#0070F3]" />
              )}
              {section.icon}
            </button>
          ))}
        </div>

        {/* Bottom actions */}
        <div className="mt-auto flex flex-col items-center gap-2 pb-3">
          {user?.role === 'admin' && (
            <a
              href={ADMIN_APP_URL}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-[#999] transition hover:bg-[#f5f5f5] hover:text-[#666]"
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
            className="flex h-10 w-10 items-center justify-center rounded-lg text-[#999] transition hover:bg-[#f5f5f5] hover:text-[#666]"
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
        <div className="flex h-full w-56 flex-col border-r border-[#eaeaea] bg-white">
          {activeSection === 'home' ? (
            <>
              <ModuleSwitcher active={homeTab} onChange={setHomeTab} />
              {homeTab === 'chat' ? (
                <ChannelSidebar
                  channels={channels}
                  activeId={activeChannelId}
                  onSelect={setActiveChannel}
                  onCreateChannel={() => setShowCreateChannel(true)}
                />
              ) : (
                <SpaceTree workspaceId={currentWorkspace.id} />
              )}
            </>
          ) : (
            <div className="flex flex-col">
              <div className="border-b border-[#eaeaea] px-4 py-3">
                <h3 className="font-[family-name:var(--font-display)] text-sm font-semibold text-[#171717]">{SECTION_TITLES[activeSection]}</h3>
              </div>
              <div className="flex flex-1 items-center justify-center px-4 py-12">
                <p className="font-[family-name:var(--font-mono)] text-center text-[10px] uppercase tracking-[0.12em] text-[#999]">Coming soon</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 flex-col bg-white">
        {activeSection === 'home' ? (
          <>
            {homeTab === 'chat' ? (
              <>
                {activeChannelId && (
                  <div className="flex items-center border-b border-[#eaeaea] px-5 py-3">
                    <span className="mr-2 text-[#999]">#</span>
                    <span className="text-sm font-medium text-[#171717]">
                      {channels.find((c) => c.id === activeChannelId)?.name}
                    </span>
                  </div>
                )}

                {activeChannelId ? (
                  <ChatPanel channelId={activeChannelId} />
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-[#999]">
                    Select a channel to start chatting
                  </div>
                )}
              </>
            ) : (
              <ListPage />
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-[#999]">
            <div className="mb-4 opacity-30">
              {SECTIONS.find((s) => s.id === activeSection)?.icon}
            </div>
            <h3 className="font-[family-name:var(--font-display)] text-lg font-medium text-[#666]">{SECTION_TITLES[activeSection]}</h3>
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
