import { create } from 'zustand';
import type { Workspace, Channel, RoleHomeView } from '@squadhub/shared';

type WorkspaceWithMembership = Workspace & { my_role?: string; my_home_view?: RoleHomeView };

interface WorkspaceState {
  currentWorkspace: WorkspaceWithMembership | null;
  channels: Channel[];
  activeChannelId: string | null;
  setWorkspace: (workspace: WorkspaceWithMembership) => void;
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
