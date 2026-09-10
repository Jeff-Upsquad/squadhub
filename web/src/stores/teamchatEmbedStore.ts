import { create } from 'zustand';

// Unread counts reported by embedded CRM TeamChat iframes (postMessage bridge).
// Used for app-row badges where the data lives in another app's backend and
// the browser can't query it directly.
interface TeamChatEmbedState {
  shcrmUnread: number;
  setShcrmUnread: (n: number) => void;
}

export const useTeamChatEmbedStore = create<TeamChatEmbedState>((set) => ({
  shcrmUnread: 0,
  setShcrmUnread: (n) => set({ shcrmUnread: n }),
}));
