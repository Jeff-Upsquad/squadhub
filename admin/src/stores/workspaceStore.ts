import { create } from 'zustand';
import type { Workspace, Channel } from '@squadhub/shared';

interface WorkspaceState {
  currentWorkspace: (Workspace & { my_role?: string }) | null;
  channels: Channel[];
  activeChannelId: string | null;
  setWorkspace: (workspace: Workspace & { my_role?: string }) => void;
  setChannels: (channels: Channel[]) => void;
  setActiveChannel: (channelId: string | null) => void;
  reset: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  currentWorkspace: null,
  channels: [],
  activeChannelId: null,

  setWorkspace: (workspace) => set({ currentWorkspace: workspace }),
  setChannels: (channels) => set({ channels }),
  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),
  reset: () => set({ currentWorkspace: null, channels: [], activeChannelId: null }),
}));
