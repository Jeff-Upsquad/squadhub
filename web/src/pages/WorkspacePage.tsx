import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useAuthStore } from '../stores/authStore';
import type { Workspace, Channel, Message } from '@squadhub/shared';
import { connectSocket, disconnectSocket, getSocket } from '../services/socket';

// ---- Sidebar Icon ----
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

// ---- Channel Sidebar ----
function ChannelSidebar({ channels, activeId, onSelect, onCreateChannel }: {
  channels: Channel[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreateChannel: () => void;
}) {
  return (
    <div className="flex h-full w-60 flex-col border-r border-gray-800 bg-[var(--color-sidebar)]">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--color-sidebar-text-bright)]">Channels</h2>
        <button
          onClick={onCreateChannel}
          className="text-lg text-gray-400 hover:text-white"
          title="Create channel"
        >
          +
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        {channels.map((ch) => (
          <button
            key={ch.id}
            onClick={() => onSelect(ch.id)}
            className={`mb-0.5 flex w-full items-center rounded-md px-3 py-1.5 text-left text-sm transition ${
              activeId === ch.id
                ? 'bg-[var(--color-sidebar-active)] text-white'
                : 'text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)]'
            }`}
          >
            <span className="mr-2 text-gray-500">#</span>
            {ch.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Message Bubble ----
function MessageBubble({ message }: { message: Message }) {
  const sender = message.sender;
  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="group flex gap-3 px-5 py-1.5 hover:bg-gray-50/5">
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">
        {sender?.display_name?.[0]?.toUpperCase() || '?'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-white">{sender?.display_name || 'Unknown'}</span>
          <span className="text-xs text-gray-500">{time}</span>
        </div>
        {message.content && <p className="text-sm text-gray-300">{message.content}</p>}
        {message.file_url && message.type === 'image' && (
          <img src={message.file_url} alt="attachment" className="mt-1 max-h-60 rounded-lg" />
        )}
        {message.file_url && message.type === 'audio' && (
          <audio controls src={message.file_url} className="mt-1" />
        )}
      </div>
    </div>
  );
}

// ---- Message Composer ----
function MessageComposer({ channelId, onSend }: { channelId: string; onSend: () => void }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await api.post('/messages', { channel_id: channelId, content: text.trim(), type: 'text' });
      setText('');
      onSend();
    } catch (err) {
      console.error('Send message failed:', err);
    } finally {
      setSending(false);
    }
  };

  // Emit typing indicators
  const handleTyping = () => {
    const socket = getSocket();
    if (socket) socket.emit('typing', { channel_id: channelId });
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-800 px-5 py-3">
      <div className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2">
        <input
          type="text"
          value={text}
          onChange={(e) => { setText(e.target.value); handleTyping(); }}
          placeholder="Type a message..."
          className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="rounded-md bg-brand-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </form>
  );
}

// ---- Main Chat Panel ----
function ChatPanel({ channelId }: { channelId: string }) {
  const queryClient = useQueryClient();
  const { data: messagesRes } = useQuery({
    queryKey: ['messages', channelId],
    queryFn: () => api.get(`/messages?channel_id=${channelId}`).then((r) => r.data),
    enabled: !!channelId,
    refetchInterval: false,
  });

  // Listen for real-time messages
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.emit('join_channel', channelId);

    const handleNewMessage = () => {
      queryClient.invalidateQueries({ queryKey: ['messages', channelId] });
    };

    socket.on('new_message', handleNewMessage);
    return () => {
      socket.emit('leave_channel', channelId);
      socket.off('new_message', handleNewMessage);
    };
  }, [channelId, queryClient]);

  const messages: Message[] = messagesRes?.data || [];

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-y-auto py-4">
        {messages.length === 0 && (
          <p className="px-5 text-sm text-gray-500">No messages yet. Say something!</p>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>
      <MessageComposer
        channelId={channelId}
        onSend={() => queryClient.invalidateQueries({ queryKey: ['messages', channelId] })}
      />
    </div>
  );
}

// ---- Create Channel Modal ----
function CreateChannelModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (channelName: string) =>
      api.post('/channels', { workspace_id: workspaceId, name: channelName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels', workspaceId] });
      onClose();
    },
    onError: (err: any) => setError(err.response?.data?.error || 'Failed to create channel'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-xl bg-gray-900 p-6">
        <h3 className="mb-4 text-lg font-bold text-white">Create Channel</h3>
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          placeholder="channel-name"
          className="mb-4 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:text-white">
            Cancel
          </button>
          <button
            onClick={() => name && mutation.mutate(name)}
            disabled={!name || mutation.isPending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Main Workspace Page ----
export default function WorkspacePage() {
  const { currentWorkspace, activeChannelId, setWorkspace, setChannels, setActiveChannel } = useWorkspaceStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
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
    setChannels(channels);
    if (channels.length > 0 && !activeChannelId) {
      setActiveChannel(channels[0].id);
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

  // Show loading while fetching workspaces
  if (workspacesLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <p className="text-lg text-gray-400">Loading...</p>
      </div>
    );
  }

  // Show workspace creation if none exist
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
            onClick={() => { setWorkspace(ws); setActiveChannel(null); }}
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

      {/* Channel sidebar */}
      {currentWorkspace && (
        <ChannelSidebar
          channels={channels}
          activeId={activeChannelId}
          onSelect={setActiveChannel}
          onCreateChannel={() => setShowCreateChannel(true)}
        />
      )}

      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
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

// ---- Create Workspace View ----
function CreateWorkspaceView() {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    try {
      await api.post('/workspaces', { name: name.trim() });
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create workspace');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-md rounded-xl bg-gray-900 p-8 shadow-2xl">
        <h1 className="mb-2 text-2xl font-bold text-white">Create Your Workspace</h1>
        <p className="mb-6 text-gray-400">Give your team a home on SquadHub</p>
        <form onSubmit={handleCreate} className="space-y-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workspace name"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-white placeholder-gray-500 focus:border-brand-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Workspace'}
          </button>
        </form>
      </div>
    </div>
  );
}
