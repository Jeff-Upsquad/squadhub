'use client';

import { useActiveHuddle, useHuddlesEnabled, useJoinHuddle, useStartHuddle } from '../../../hooks/useHuddles';
import { useHuddleStore } from '../../../stores/huddleStore';
import type { ChatKind } from '../../../stores/workspaceStore';

// Headset button in the chat header. Idle: starts a huddle in this
// conversation. While one is live here: a green "Join · N" pill (or "Open"
// if you're already in it). Hidden entirely when LiveKit isn't configured.
export default function HuddleHeaderButton({ channelId, kind }: { channelId: string; kind: ChatKind }) {
  const { data: enabled } = useHuddlesEnabled();
  const { data: active } = useActiveHuddle(kind, channelId);
  const start = useStartHuddle();
  const join = useJoinHuddle();
  const session = useHuddleStore((s) => s.session);
  const joinStore = useHuddleStore((s) => s.join);
  const setExpanded = useHuddleStore((s) => s.setExpanded);
  const connecting = useHuddleStore((s) => s.connecting);

  if (!enabled) return null;

  const live = active && !active.huddle.ended_at ? active : null;
  const inThisOne = !!live && session?.huddleId === live.huddle.id;
  const busy = start.isPending || join.isPending || connecting;

  const onClick = async () => {
    if (busy) return;
    try {
      if (inThisOne) {
        setExpanded(true);
        return;
      }
      const creds = live ? await join.mutateAsync(live.huddle.id) : await start.mutateAsync({ kind, channelId });
      await joinStore(creds);
    } catch {
      /* dock shows the error */
    }
  };

  const icon = (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M4 14h3v6H5a1 1 0 0 1-1-1v-5zM17 14h3v5a1 1 0 0 1-1 1h-2v-6z" />
    </svg>
  );

  if (live) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="sqc-pill !border-[#22c55e]/40 !bg-[#22c55e]/10 !text-[#15803d]"
        title={inThisOne ? 'Open the huddle' : 'Join the huddle'}
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22c55e] opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#22c55e]" />
        </span>
        <span className="text-[12px] font-semibold">
          {inThisOne ? 'In huddle' : busy ? 'Joining…' : 'Join huddle'}
          {live.participant_count ? ` · ${live.participant_count}` : ''}
        </span>
      </button>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={busy} className="sqc-pill" title="Start a huddle">
      {icon}
      <span className="text-[12px]">{busy ? 'Starting…' : 'Huddle'}</span>
    </button>
  );
}
