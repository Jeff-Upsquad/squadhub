import { create } from 'zustand';
import type { Workspace, Channel, DmConversation } from '@squadhub/shared';

type WorkspaceWithMembership = Workspace & { my_role?: string };

export type ChatKind = 'channel' | 'dm';

interface WorkspaceState {
  currentWorkspace: WorkspaceWithMembership | null;
  channels: Channel[];
  dmConversations: DmConversation[];
  activeChannelId: string | null;
  activeChannelKind: ChatKind;
  activeThreadParentId: string | null;
  setWorkspace: (workspace: WorkspaceWithMembership) => void;
  setChannels: (channels: Channel[]) => void;
  setDmConversations: (dms: DmConversation[]) => void;
  setActiveChannel: (channelId: string | null, kind?: ChatKind) => void;
  setActiveThread: (parentId: string | null) => void;
  reset: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  currentWorkspace: null,
  channels: [],
  dmConversations: [],
  activeChannelId: null,
  activeChannelKind: 'channel',
  activeThreadParentId: null,

  setWorkspace: (workspace) => set({ currentWorkspace: workspace }),
  setChannels: (channels) => set({ channels }),
  setDmConversations: (dms) => set({ dmConversations: dms }),
  setActiveChannel: (channelId, kind = 'channel') => set({
    activeChannelId: channelId,
    activeChannelKind: kind,
    activeThreadParentId: null, // close thread when switching conversation
  }),
  setActiveThread: (parentId) => set({ activeThreadParentId: parentId }),
  reset: () => set({
    currentWorkspace: null,
    channels: [],
    dmConversations: [],
    activeChannelId: null,
    activeChannelKind: 'channel',
    activeThreadParentId: null,
  }),
}));
