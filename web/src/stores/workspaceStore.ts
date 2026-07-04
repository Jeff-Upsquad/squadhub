import { create } from 'zustand';
import type { Workspace, Channel, DmConversation } from '@squadhub/shared';

type WorkspaceWithMembership = Workspace & { my_role?: string };

export type ChatKind = 'channel' | 'dm';

// A request to scroll a conversation to a specific message (from search).
// `nonce` makes re-selecting the same message re-fire the jump; `parentId` is
// set when the target is a thread reply, so ChatPanel opens the thread instead.
export interface MessageJumpTarget {
  conversationId: string;
  kind: ChatKind;
  messageId: string;
  parentId: string | null;
  nonce: number;
}

interface WorkspaceState {
  currentWorkspace: WorkspaceWithMembership | null;
  channels: Channel[];
  dmConversations: DmConversation[];
  activeChannelId: string | null;
  activeChannelKind: ChatKind;
  activeThreadParentId: string | null;
  messageJumpTarget: MessageJumpTarget | null;
  setWorkspace: (workspace: WorkspaceWithMembership) => void;
  setChannels: (channels: Channel[]) => void;
  setDmConversations: (dms: DmConversation[]) => void;
  setActiveChannel: (channelId: string | null, kind?: ChatKind) => void;
  setActiveThread: (parentId: string | null) => void;
  requestMessageJump: (target: Omit<MessageJumpTarget, 'nonce'>) => void;
  clearMessageJump: () => void;
  reset: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  currentWorkspace: null,
  channels: [],
  dmConversations: [],
  activeChannelId: null,
  activeChannelKind: 'channel',
  activeThreadParentId: null,
  messageJumpTarget: null,

  setWorkspace: (workspace) => set({ currentWorkspace: workspace }),
  setChannels: (channels) => set({ channels }),
  setDmConversations: (dms) => set({ dmConversations: dms }),
  setActiveChannel: (channelId, kind = 'channel') => set({
    activeChannelId: channelId,
    activeChannelKind: kind,
    activeThreadParentId: null, // close thread when switching conversation
  }),
  setActiveThread: (parentId) => set({ activeThreadParentId: parentId }),
  requestMessageJump: (target) =>
    set((s) => ({
      messageJumpTarget: { ...target, nonce: (s.messageJumpTarget?.nonce ?? 0) + 1 },
    })),
  clearMessageJump: () => set({ messageJumpTarget: null }),
  reset: () => set({
    currentWorkspace: null,
    channels: [],
    dmConversations: [],
    activeChannelId: null,
    activeChannelKind: 'channel',
    activeThreadParentId: null,
    messageJumpTarget: null,
  }),
}));
