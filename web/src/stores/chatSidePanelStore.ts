import { create } from 'zustand';

// Drives the single, globally-mounted ChatSidePanel — a wide right-docked
// slide-over that hosts the standard ChatPanel for a channel linked to a PM
// container (list / folder / space). Opened from the container header's "Chat"
// button; does NOT touch the workspace's active channel, so the user's main
// chat selection is preserved.
interface ChatSidePanelState {
  isOpen: boolean;
  channelId: string | null;
  containerLabel: string;
  open: (args: { channelId: string; containerLabel: string }) => void;
  close: () => void;
}

export const useChatSidePanelStore = create<ChatSidePanelState>((set) => ({
  isOpen: false,
  channelId: null,
  containerLabel: '',
  open: ({ channelId, containerLabel }) => set({ isOpen: true, channelId, containerLabel }),
  close: () => set({ isOpen: false, channelId: null, containerLabel: '' }),
}));
