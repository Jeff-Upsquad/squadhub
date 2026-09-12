'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  RoomContext,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useTracks,
} from '@livekit/components-react';
import { ConnectionState, Room, Track } from 'livekit-client';
import '@livekit/components-styles';
import './huddle.css';

// The call surface itself — participant tiles + the control bar — shared by
// the in-app dock (HuddleDock) and the public guest page. It never connects
// or disconnects; the caller owns the Room and passes it in connected.

export interface HuddleCallProps {
  room: Room;
  title: string;
  subtitle?: string | null;
  shareUrl?: string | null;
  // Shown for the person who started it (and admins): ends for everyone.
  canEnd?: boolean;
  onEnd?: () => void;
  onLeave: () => void;
  onMinimize?: () => void;
  // Optional right-hand rail (the chat, in-app).
  rail?: ReactNode;
  railOpen?: boolean;
  onToggleRail?: () => void;
}

function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg className={className || 'h-[18px] w-[18px]'} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3',
  micOff: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3M3 3l18 18',
  cam: 'M15 10l4.5-2.5v9L15 14M4 6h11v12H4z',
  camOff: 'M15 10l4.5-2.5v9L15 14M4 6h11v12H4zM3 3l18 18',
  screen: 'M4 5h16v11H4zM8 20h8M12 16v4',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  minimize: 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7',
  chat: 'M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z',
  leave: 'M16 17l5-5-5-5M21 12H9M13 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8',
};

function CtlButton({
  on,
  danger,
  title,
  onClick,
  disabled,
  children,
}: {
  on?: boolean;
  danger?: boolean;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`hd-ctl${on ? ' is-on' : ''}${danger ? ' is-danger' : ''}`}
    >
      {children}
    </button>
  );
}

function Stage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  return (
    <GridLayout tracks={tracks} className="hd-grid">
      <ParticipantTile />
    </GridLayout>
  );
}

export default function HuddleCall(props: HuddleCallProps) {
  const { room, title, subtitle, shareUrl, canEnd, onEnd, onLeave, onMinimize, rail, railOpen, onToggleRail } = props;
  return (
    <RoomContext.Provider value={room}>
      <div className="hd-call" data-lk-theme="default">
        <div className="hd-main">
          <Header title={title} subtitle={subtitle} />
          <Stage />
          <Controls
            shareUrl={shareUrl}
            canEnd={canEnd}
            onEnd={onEnd}
            onLeave={onLeave}
            onMinimize={onMinimize}
            railOpen={railOpen}
            onToggleRail={rail ? onToggleRail : undefined}
          />
        </div>
        {rail && railOpen && <aside className="hd-rail">{rail}</aside>}
        <RoomAudioRenderer />
      </div>
    </RoomContext.Provider>
  );
}

function Header({ title, subtitle }: { title: string; subtitle?: string | null }) {
  const participants = useParticipants();
  const state = useConnectionState();
  const label =
    state === ConnectionState.Connected
      ? `${participants.length} in huddle`
      : state === ConnectionState.Reconnecting
        ? 'Reconnecting…'
        : 'Connecting…';
  return (
    <div className="hd-header">
      <span className="hd-live" aria-hidden />
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold text-white">{title}</div>
        <div className="truncate text-[11.5px] text-white/60">{subtitle ? `${subtitle} · ` : ''}{label}</div>
      </div>
    </div>
  );
}

function Controls({
  shareUrl,
  canEnd,
  onEnd,
  onLeave,
  onMinimize,
  railOpen,
  onToggleRail,
}: Pick<HuddleCallProps, 'shareUrl' | 'canEnd' | 'onEnd' | 'onLeave' | 'onMinimize' | 'railOpen' | 'onToggleRail'>) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(t);
  }, [notice]);

  // WKWebView (the Mac desktop app) has no getDisplayMedia — hide the button
  // rather than let it fail on click.
  const canShareScreen = useMemo(
    () => typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices,
    [],
  );

  const toggle = useCallback(
    async (what: 'mic' | 'cam' | 'screen') => {
      setBusy(what);
      try {
        if (what === 'mic') await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
        if (what === 'cam') await localParticipant.setCameraEnabled(!isCameraEnabled);
        if (what === 'screen') await localParticipant.setScreenShareEnabled(!isScreenShareEnabled, { audio: true });
      } catch (err: any) {
        if (err?.name === 'NotAllowedError') setNotice(what === 'screen' ? 'Screen share cancelled' : 'Permission denied — check your browser settings');
        else setNotice(err?.message || 'Could not switch device');
      } finally {
        setBusy(null);
      }
    },
    [localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled],
  );

  const copyLink = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setNotice('Huddle link copied');
    } catch {
      setNotice(shareUrl);
    }
  }, [shareUrl]);

  return (
    <div className="hd-controls">
      {notice && <div className="hd-notice">{notice}</div>}
      <div className="hd-ctl-group">
        <CtlButton on={isMicrophoneEnabled} title={isMicrophoneEnabled ? 'Mute' : 'Unmute'} onClick={() => toggle('mic')} disabled={busy === 'mic'}>
          <Icon d={isMicrophoneEnabled ? ICONS.mic : ICONS.micOff} />
        </CtlButton>
        <CtlButton on={isCameraEnabled} title={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'} onClick={() => toggle('cam')} disabled={busy === 'cam'}>
          <Icon d={isCameraEnabled ? ICONS.cam : ICONS.camOff} />
        </CtlButton>
        {canShareScreen && (
          <CtlButton on={isScreenShareEnabled} title={isScreenShareEnabled ? 'Stop sharing' : 'Share screen'} onClick={() => toggle('screen')} disabled={busy === 'screen'}>
            <Icon d={ICONS.screen} />
          </CtlButton>
        )}
        {shareUrl && (
          <CtlButton title="Copy huddle link" onClick={copyLink}>
            <Icon d={ICONS.link} />
          </CtlButton>
        )}
        {onToggleRail && (
          <CtlButton on={!!railOpen} title={railOpen ? 'Hide chat' : 'Show chat'} onClick={onToggleRail}>
            <Icon d={ICONS.chat} />
          </CtlButton>
        )}
        {onMinimize && (
          <CtlButton title="Minimise" onClick={onMinimize}>
            <Icon d={ICONS.minimize} />
          </CtlButton>
        )}
      </div>
      <div className="hd-ctl-group">
        {canEnd && onEnd && (
          <button type="button" className="hd-end" onClick={onEnd} title="End the huddle for everyone">
            End for all
          </button>
        )}
        <button type="button" className="hd-leave" onClick={onLeave}>
          <Icon d={ICONS.leave} className="h-4 w-4" />
          Leave
        </button>
      </div>
    </div>
  );
}
