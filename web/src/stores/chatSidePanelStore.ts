import { create } from 'zustand';

// Drives the single, globally-mounted ChatSidePanel — a wide right-docked
// slide-over that hosts the standard ChatPanel for a channel linked to a PM
// container (list / folder / space) or a CRM entity chat. Opened from the
// container header's "Chat" button or the CRM Chats sidebar; does NOT touch
// the workspace's active channel, so the user's main chat selection is preserved.
interface ChatSidePanelState {
  isOpen: boolean;
  channelId: string | null;
  containerLabel: string;
  /** When true, show Close chat (hides from CRM Chats until a new message). */
  isCrmChat: boolean;
  open: (args: { channelId: string; containerLabel: string; isCrmChat?: boolean }) => void;
  close: () => void;
}

export const useChatSidePanelStore = create<ChatSidePanelState>((set) => ({
  isOpen: false,
  channelId: null,
  containerLabel: '',
  isCrmChat: false,
  open: ({ channelId, containerLabel, isCrmChat }) =>
    set({ isOpen: true, channelId, containerLabel, isCrmChat: !!isCrmChat }),
  close: () => set({ isOpen: false, channelId: null, containerLabel: '', isCrmChat: false }),
}));
