'use client';

import { useCallback, useMemo, useState } from 'react';
import { RoomContext, useLocalParticipant, useParticipants } from '@livekit/components-react';
import { useHuddleStore } from '../../../stores/huddleStore';
import { useAuthStore } from '../../../stores/authStore';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { useHuddle, useHuddleActions, useHuddleSocketSync } from '../../../hooks/useHuddles';
import HuddleCall from './HuddleCall';
import ChatPanel from '../chat/ChatPanel';
import ThreadPanel from '../chat/ThreadPanel';
import './huddle.css';

// Mounted once in MainLayout. Renders the active SquadUp (from huddleStore)
// as either the full-screen call with the call's own thread docked on the
// right — a thread on the "started a SquadUp" card, so what's said during
// the call stays with the call instead of flooding the channel — or, when
// minimised, a floating pill so the call keeps running while the user works
// elsewhere. The LiveKit Room lives in the store, so flipping between the
// two never reconnects.

export function huddleShareUrl(code: string): string {
  if (typeof window === 'undefined') return `/huddle/${code}`;
  return `${window.location.origin}/huddle/${code}`;
}

export default function HuddleDock() {
  useHuddleSocketSync();
  const session = useHuddleStore((s) => s.session);
  const expanded = useHuddleStore((s) => s.expanded);
  const setExpanded = useHuddleStore((s) => s.setExpanded);
  const leave = useHuddleStore((s) => s.leave);
  const error = useHuddleStore((s) => s.error);
  const clearError = useHuddleStore((s) => s.clearError);
  const me = useAuthStore((s) => s.user);
  const channels = useWorkspaceStore((s) => s.channels);
  const dms = useWorkspaceStore((s) => s.dmConversations);
  const { data: detail } = useHuddle(session?.huddleId ?? null);
  const actions = useHuddleActions(session?.huddleId ?? null);
  const [railOpen, setRailOpen] = useState(true);

  const title = useMemo(() => {
    if (!session) return '';
    if (session.kind === 'dm') {
      const dm = dms.find((d) => d.id === session.channelId);
      const others = (dm?.participants || []).filter((p) => p.id !== me?.id);
      const names = others.map((p) => p.display_name).filter(Boolean);
      return names.length ? `SquadUp with ${names.join(', ')}` : 'SquadUp';
    }
    const ch = channels.find((c) => c.id === session.channelId);
    return ch ? `SquadUp in #${ch.name}` : 'SquadUp';
  }, [session, channels, dms, me?.id]);

  const onEnd = useCallback(async () => {
    if (!session) return;
    if (!window.confirm('End the SquadUp for everyone?')) return;
    await actions.end.mutateAsync().catch(() => undefined);
    await leave();
  }, [session, actions.end, leave]);

  if (error) {
    return (
      <div className="hd-pill" role="alert">
        <span className="text-[12.5px]">{error}</span>
        <button type="button" className="hd-ctl" title="Dismiss" onClick={clearError}>
          ✕
        </button>
      </div>
    );
  }
  if (!session) return null;

  const huddle = detail?.huddle ?? session.creds.huddle.huddle;
  const canEnd = huddle.started_by === me?.id || !!me?.is_admin;
  // The call's thread anchor. Falls back to the whole conversation only if
  // the card somehow never got posted (e.g. a row from before threads).
  const cardMessageId = detail?.card_message_id ?? session.creds.huddle.card_message_id ?? null;

  if (!expanded) {
    return (
      <RoomContext.Provider value={session.room}>
        <Pill title={title} onExpand={() => setExpanded(true)} onLeave={leave} />
      </RoomContext.Provider>
    );
  }

  return (
    <div className="hd-overlay">
      <HuddleCall
        room={session.room}
        title={title}
        subtitle={huddle.topic}
        shareUrl={huddleShareUrl(huddle.code)}
        canEnd={canEnd}
        onEnd={onEnd}
        onLeave={leave}
        onMinimize={() => setExpanded(false)}
        railOpen={railOpen}
        onToggleRail={() => setRailOpen((v) => !v)}
        rail={
          <div className="squadhub-chat flex flex-1 flex-col min-h-0 overflow-hidden">
            {cardMessageId ? (
              <ThreadPanel
                parentId={cardMessageId}
                channelId={session.channelId}
                kind={session.kind}
                embedded
                title="SquadUp thread"
              />
            ) : (
              <ChatPanel channelId={session.channelId} kind={session.kind} active />
            )}
          </div>
        }
      />
    </div>
  );
}

function Pill({ title, onExpand, onLeave }: { title: string; onExpand: () => void; onLeave: () => void }) {
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const shown = participants.slice(0, 4);
  return (
    <div className="hd-pill">
      <button type="button" className="flex items-center gap-2 text-left" onClick={onExpand} title="Open SquadUp">
        <span className="hd-pill__avatars">
          {shown.map((p) => {
            let meta: { avatar_url?: string | null } = {};
            try {
              meta = p.metadata ? JSON.parse(p.metadata) : {};
            } catch {
              /* guest */
            }
            const hue = [...p.identity].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
            return (
              <span key={p.identity} style={{ background: meta.avatar_url ? undefined : `hsl(${hue} 60% 45%)` }} title={p.name || p.identity}>
                {meta.avatar_url ? <img src={meta.avatar_url} alt="" /> : (p.name || '?')[0]?.toUpperCase()}
              </span>
            );
          })}
        </span>
        <span className="min-w-0">
          <span className="block max-w-[180px] truncate text-[12.5px] font-semibold">{title}</span>
          <span className="block text-[11px] text-white/60">
            {participants.length} in SquadUp
          </span>
        </span>
      </button>
      <button
        type="button"
        className={`hd-ctl${isMicrophoneEnabled ? ' is-on' : ''}`}
        title={isMicrophoneEnabled ? 'Mute' : 'Unmute'}
        onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => undefined)}
      >
        <svg fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d={isMicrophoneEnabled ? 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3' : 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3M3 3l18 18'} />
        </svg>
      </button>
      <button type="button" className="hd-ctl is-danger" title="Leave SquadUp" onClick={onLeave}>
        <svg fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M16 17l5-5-5-5M21 12H9M13 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8" />
        </svg>
      </button>
    </div>
  );
}
