import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useAuthStore } from '../stores/authStore';
import { usePMStore } from '../stores/pmStore';
import type { Workspace, Channel } from '@squadhub/shared';
import { connectSocket, disconnectSocket } from '../services/socket';
import ModuleSwitcher, { type ActiveModule } from '../components/ModuleSwitcher';
import ChannelSidebar from '../pages/app/chat/ChannelSidebar';
import ChatPanel from '../pages/app/chat/ChatPanel';
import CreateChannelModal from '../pages/app/chat/CreateChannelModal';
import CreateWorkspaceView from '../pages/app/CreateWorkspaceView';
import SpaceTree from '../pages/app/pm/SpaceTree';
import ListPage from '../pages/app/pm/ListPage';

// ---- Sidebar Workspace Icon ----
function SidebarIcon({ label, active, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md text-xs font-semibold transition ${
        active
          ? 'bg-[#ededed] text-[#0a0a0a]'
          : 'bg-[#1a1a1a] text-[#888] hover:bg-[#222] hover:text-[#ededed]'
      }`}
      title={label}
    >
      {label[0].toUpperCase()}
    </button>
  );
}

export default function MainLayout() {
  const { currentWorkspace, activeChannelId, setWorkspace, setChannels, setActiveChannel } = useWorkspaceStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const pmReset = usePMStore((s) => s.reset);
  const navigate = useNavigate();
  const [activeModule, setActiveModule] = useState<ActiveModule>('chat');
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

  // Handle workspace switch
  const handleSwitchWorkspace = (ws: Workspace & { my_role?: string }) => {
    setWorkspace(ws);
    setActiveChannel(null);
    pmReset();
  };

  // Loading state
  if (workspacesLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0a]">
        <p className="text-sm text-[#555]">Loading...</p>
      </div>
    );
  }

  // No workspaces — show creation form
  if (!workspacesRes || workspaces.length === 0) {
    return <CreateWorkspaceView />;
  }

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-[#ededed]">
      {/* Far-left icon sidebar */}
      <div className="flex w-14 flex-col items-center gap-2 border-r border-[#222] bg-[#0a0a0a] py-3">
        {workspaces.map((ws) => (
          <SidebarIcon
            key={ws.id}
            label={ws.name}
            active={currentWorkspace?.id === ws.id}
            onClick={() => handleSwitchWorkspace(ws)}
          />
        ))}
        <div className="mt-auto flex flex-col items-center gap-2 pb-3">
          {currentWorkspace && (currentWorkspace as any).my_role && ['super_admin', 'admin'].includes((currentWorkspace as any).my_role) && (
            <button
              onClick={() => navigate('/workspace-admin')}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[#555] transition hover:bg-[#1a1a1a] hover:text-[#ededed]"
              title="Workspace Settings"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </button>
          )}
          {user?.role === 'admin' && (
            <button
              onClick={() => navigate('/admin')}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[#555] transition hover:bg-[#1a1a1a] hover:text-[#ededed]"
              title="Admin Panel"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}
          <button
            onClick={logout}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#555] transition hover:bg-[#1a1a1a] hover:text-[#ededed]"
            title="Logout"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Module sidebar */}
      {currentWorkspace && (
        <div className="flex h-full w-56 flex-col border-r border-[#222] bg-[#0a0a0a]">
          <ModuleSwitcher active={activeModule} onChange={setActiveModule} />

          {activeModule === 'chat' ? (
            <ChannelSidebar
              channels={channels}
              activeId={activeChannelId}
              onSelect={setActiveChannel}
              onCreateChannel={() => setShowCreateChannel(true)}
            />
          ) : (
            <SpaceTree workspaceId={currentWorkspace.id} />
          )}
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 flex-col bg-[#0a0a0a]">
        {activeModule === 'chat' ? (
          <>
            {activeChannelId && (
              <div className="flex items-center border-b border-[#222] px-5 py-3">
                <span className="mr-2 text-[#555]">#</span>
                <span className="text-sm font-medium text-[#ededed]">
                  {channels.find((c) => c.id === activeChannelId)?.name}
                </span>
              </div>
            )}

            {activeChannelId ? (
              <ChatPanel channelId={activeChannelId} />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-[#555]">
                Select a channel to start chatting
              </div>
            )}
          </>
        ) : (
          <ListPage />
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
