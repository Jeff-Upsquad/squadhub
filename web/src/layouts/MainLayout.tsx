import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

const ADMIN_APP_URL = import.meta.env.PROD ? 'http://72.61.245.97:3081' : 'http://localhost:5174';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useAuthStore } from '../stores/authStore';
import { usePMStore } from '../stores/pmStore';
import type { Workspace, Channel } from '@squadhub/shared';
import { connectSocket, disconnectSocket } from '../services/socket';
import ChannelSidebar from '../pages/app/chat/ChannelSidebar';
import ChatPanel from '../pages/app/chat/ChatPanel';
import CreateChannelModal from '../pages/app/chat/CreateChannelModal';
import SpaceTree from '../pages/app/pm/SpaceTree';
import ListPage from '../pages/app/pm/ListPage';
import HomeSidebar from '../pages/app/HomeSidebar';

// ---- Section type ----
type ActiveSection = 'home' | 'spaces' | 'chat' | 'planner' | 'ai' | 'teams' | 'docs' | 'dashboard';

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
    id: 'spaces',
    label: 'Spaces',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
      </svg>
    ),
  },
  {
    id: 'planner',
    label: 'Planner',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
    ),
  },
  {
    id: 'ai',
    label: 'AI',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
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
    id: 'docs',
    label: 'Docs',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: 'dashboard',
    label: 'Dashboa..',
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
];

// ---- Placeholder sidebar/content labels ----
const SECTION_TITLES: Record<ActiveSection, string> = {
  home: 'Home',
  spaces: 'Spaces',
  chat: 'Chat',
  planner: 'Planner',
  ai: 'AI',
  teams: 'Teams',
  docs: 'Documents',
  dashboard: 'Dashboard',
};

export default function MainLayout() {
  const { currentWorkspace, activeChannelId, setWorkspace, setChannels, setActiveChannel } = useWorkspaceStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const pmReset = usePMStore((s) => s.reset);
  const [activeSection, setActiveSection] = useState<ActiveSection>('home');
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
              className={`relative flex h-10 w-10 flex-col items-center justify-center rounded-lg transition ${
                activeSection === section.id
                  ? 'bg-[#f5f5f5] text-[#171717]'
                  : 'text-[#999] hover:bg-[#f5f5f5] hover:text-[#666]'
              }`}
              title={SECTION_TITLES[section.id]}
            >
              {activeSection === section.id && (
                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[#0070F3]" />
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
            <HomeSidebar workspaceId={currentWorkspace.id} />
          ) : activeSection === 'chat' ? (
            <ChannelSidebar
              channels={channels}
              activeId={activeChannelId}
              onSelect={setActiveChannel}
              onCreateChannel={() => setShowCreateChannel(true)}
            />
          ) : activeSection === 'spaces' ? (
            <SpaceTree workspaceId={currentWorkspace.id} />
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
        {activeSection === 'chat' ? (
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
        ) : activeSection === 'spaces' ? (
          <ListPage />
        ) : activeSection === 'home' ? (
          <div className="flex flex-1 flex-col items-center justify-center text-[#999]">
            <svg className="mb-4 h-10 w-10 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" />
            </svg>
            <h3 className="font-[family-name:var(--font-display)] text-lg font-medium text-[#666]">Home</h3>
            <p className="mt-1 text-sm">Your notifications and updates will appear here</p>
          </div>
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
