import { create } from 'zustand';

// Drives the single, globally-mounted MeetingCreatePanel slide-over so it can be
// opened from anywhere: the list "+ New Task" dropdown, the chat composer, the
// Meetings mini-app, or by switching a task's type to "Meeting".
export interface MeetingPanelContext {
  channelId?: string | null;
  channelKind?: 'channel' | 'dm' | null;
  initialTitle?: string;
  // When opened from a task list (the "+ New Task" dropdown or the Meeting task
  // type), scope the guest picker to people with access to this list.
  listId?: string | null;
}

interface MeetingPanelState {
  isOpen: boolean;
  ctx: MeetingPanelContext;
  openMeetingPanel: (ctx?: MeetingPanelContext) => void;
  closeMeetingPanel: () => void;
}

export const useMeetingPanelStore = create<MeetingPanelState>((set) => ({
  isOpen: false,
  ctx: {},
  openMeetingPanel: (ctx = {}) => set({ isOpen: true, ctx }),
  closeMeetingPanel: () => set({ isOpen: false, ctx: {} }),
}));
