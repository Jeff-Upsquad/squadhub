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

// ---- Sidebar Workspace Icon ----
function SidebarIcon({ label, active, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold transition ${
        active ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
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
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <p className="text-lg text-gray-400">Loading...</p>
      </div>
    );
  }

  // No workspaces — show creation form
  if (!workspacesRes || workspaces.length === 0) {
    return <CreateWorkspaceView />;
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      {/* Far-left icon sidebar */}
      <div className="flex w-16 flex-col items-center gap-2 border-r border-gray-800 bg-gray-950 py-3">
        {workspaces.map((ws) => (
          <SidebarIcon
            key={ws.id}
            label={ws.name}
            active={currentWorkspace?.id === ws.id}
            onClick={() => handleSwitchWorkspace(ws)}
          />
        ))}
        <div className="mt-auto flex flex-col items-center gap-2 pb-3">
          {user?.role === 'admin' && (
            <button
              onClick={() => navigate('/admin')}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-800 hover:text-white"
              title="Admin Panel"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}
          <button
            onClick={logout}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-800 hover:text-white"
            title="Logout"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Module sidebar (Chat channels or Task spaces) */}
      {currentWorkspace && (
        <div className="flex h-full w-60 flex-col border-r border-gray-800 bg-[var(--color-sidebar)]">
          <ModuleSwitcher active={activeModule} onChange={setActiveModule} />

          {activeModule === 'chat' ? (
            <ChannelSidebar
              channels={channels}
              activeId={activeChannelId}
              onSelect={setActiveChannel}
              onCreateChannel={() => setShowCreateChannel(true)}
            />
          ) : (
            /* Tasks sidebar — placeholder until Phase 3 */
            <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
              <svg className="mb-3 h-10 w-10 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              <p className="text-sm font-medium text-gray-400">Tasks</p>
              <p className="mt-1 text-xs text-gray-600">Coming soon</p>
            </div>
          )}
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 flex-col">
        {activeModule === 'chat' ? (
          <>
            {/* Channel header */}
            {activeChannelId && (
              <div className="flex items-center border-b border-gray-800 px-5 py-3">
                <span className="mr-2 text-gray-500">#</span>
                <span className="font-semibold text-white">
                  {channels.find((c) => c.id === activeChannelId)?.name}
                </span>
              </div>
            )}

            {activeChannelId ? (
              <ChatPanel channelId={activeChannelId} />
            ) : (
              <div className="flex flex-1 items-center justify-center text-gray-500">
                Select a channel to start chatting
              </div>
            )}
          </>
        ) : (
          /* Tasks content — placeholder until Phase 3 */
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <svg className="mx-auto mb-4 h-16 w-16 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              <h2 className="text-lg font-semibold text-gray-400">Project Management</h2>
              <p className="mt-1 text-sm text-gray-600">Spaces, lists, and tasks coming soon</p>
            </div>
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
