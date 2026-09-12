import { create } from 'zustand';
import { Room, RoomEvent } from 'livekit-client';
import type { HuddleJoinCredentials } from '@squadhub/shared';
import type { ChatKind } from './workspaceStore';
import { leaveHuddleRequest } from '../hooks/useHuddles';

// The one call the user can be in at a time. Owns the LiveKit `Room` so the
// media connection survives navigation — HuddleDock (mounted once in
// MainLayout) renders whatever session is here as either the full stage or
// the collapsed pill; switching between them never reconnects.

export interface HuddleSession {
  huddleId: string;
  kind: ChatKind;
  channelId: string;
  creds: HuddleJoinCredentials;
  room: Room;
}

interface HuddleState {
  session: HuddleSession | null;
  expanded: boolean;
  connecting: boolean;
  error: string | null;
  join: (creds: HuddleJoinCredentials) => Promise<void>;
  leave: () => Promise<void>;
  setExpanded: (v: boolean) => void;
  clearError: () => void;
}

export const useHuddleStore = create<HuddleState>((set, get) => ({
  session: null,
  expanded: true,
  connecting: false,
  error: null,

  join: async (creds) => {
    const prev = get().session;
    if (prev?.huddleId === creds.huddle.huddle.id) {
      set({ expanded: true });
      return;
    }
    if (prev) await get().leave();

    const room = new Room({ adaptiveStream: true, dynacast: true });
    const h = creds.huddle.huddle;
    const session: HuddleSession = {
      huddleId: h.id,
      kind: h.dm_conversation_id ? 'dm' : 'channel',
      channelId: (h.dm_conversation_id || h.channel_id) as string,
      creds,
      room,
    };
    set({ connecting: true, error: null, session, expanded: true });

    // The server tearing the room down (huddle ended / last person left)
    // shows up here as a disconnect — drop the session so the pill vanishes.
    room.on(RoomEvent.Disconnected, () => {
      if (get().session?.room === room) set({ session: null, connecting: false });
    });

    try {
      await room.connect(creds.url, creds.token);
      // Slack-style defaults: mic on, camera off.
      await room.localParticipant.setMicrophoneEnabled(true).catch(() => undefined);
      set({ connecting: false });
    } catch (err: any) {
      console.error('[huddle] connect failed:', err);
      room.disconnect().catch(() => undefined);
      set({ session: null, connecting: false, error: err?.message || 'Could not connect to the huddle' });
      await leaveHuddleRequest(h.id);
    }
  },

  leave: async () => {
    const s = get().session;
    if (!s) return;
    set({ session: null, connecting: false });
    try {
      await s.room.disconnect();
    } finally {
      await leaveHuddleRequest(s.huddleId);
    }
  },

  setExpanded: (v) => set({ expanded: v }),
  clearError: () => set({ error: null }),
}));
