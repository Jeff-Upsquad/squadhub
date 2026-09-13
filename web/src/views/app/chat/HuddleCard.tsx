import { useHuddle, useJoinHuddle } from '../../../hooks/useHuddles';
import { useHuddleStore } from '../../../stores/huddleStore';
import { useAuthStore } from '../../../stores/authStore';
import { MEETING_ACCENT } from '../meetings/meetingUtils';

// The "X started a SquadUp" card inside a chat message. Live while the SquadUp
// runs (who's in it, Join), then collapses to a one-line "ended" summary.

function durationLabel(startIso: string, endIso: string | null): string {
  const ms = (endIso ? Date.parse(endIso) : Date.now()) - Date.parse(startIso);
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function Avatar({ name, url, seed }: { name: string; url: string | null; seed: string }) {
  const hue = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  return (
    <span
      className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-[7px] border-2 border-white text-[10px] font-bold text-white"
      style={{ background: url ? undefined : `hsl(${hue} 60% 45%)`, marginLeft: -6 }}
      title={name}
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : name[0]?.toUpperCase()}
    </span>
  );
}

export default function HuddleCard({ huddleId }: { huddleId: string }) {
  const me = useAuthStore((s) => s.user?.id);
  const { data: detail, isLoading } = useHuddle(huddleId);
  const join = useJoinHuddle();
  const session = useHuddleStore((s) => s.session);
  const joinStore = useHuddleStore((s) => s.join);
  const setExpanded = useHuddleStore((s) => s.setExpanded);
  const connecting = useHuddleStore((s) => s.connecting);

  if (isLoading || !detail) {
    return <div className="mt-1 max-w-md rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#94A3B8]">Loading SquadUp…</div>;
  }

  const { huddle, starter, participants } = detail;
  const ended = !!huddle.ended_at;
  const inThisOne = session?.huddleId === huddle.id;
  const starterName = starter?.id === me ? 'You' : starter?.display_name || 'Someone';

  if (ended) {
    return (
      <div className="mt-1 inline-flex max-w-md items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 text-xs text-[#64748B]">
        <span aria-hidden>🎧</span>
        <span>
          SquadUp ended · lasted {durationLabel(huddle.started_at, huddle.ended_at)}
          {huddle.topic ? ` · ${huddle.topic}` : ''}
        </span>
      </div>
    );
  }

  const onJoin = async () => {
    if (inThisOne) {
      setExpanded(true);
      return;
    }
    try {
      const creds = await join.mutateAsync(huddle.id);
      await joinStore(creds);
    } catch {
      /* the dock surfaces connection errors */
    }
  };

  return (
    <div className="mt-1 max-w-md rounded-xl border border-[#E2E8F0] bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="relative grid h-8 w-8 place-items-center rounded-lg text-white" style={{ backgroundColor: MEETING_ACCENT }} aria-hidden>
          🎧
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#22c55e]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[#0F172B]">
            {starterName} started a SquadUp{huddle.topic ? ` · ${huddle.topic}` : ''}
          </div>
          <div className="text-xs text-[#64748B]">
            {participants.length ? `${participants.length} in the SquadUp · ` : 'Nobody in yet · '}
            {durationLabel(huddle.started_at, null)}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="flex pl-1.5">
          {participants.slice(0, 6).map((p) => (
            <Avatar key={p.identity} name={p.display_name} url={p.avatar_url} seed={p.identity} />
          ))}
          {participants.length > 6 && <span className="ml-1 self-center text-[11px] text-[#64748B]">+{participants.length - 6}</span>}
        </span>
        <button
          type="button"
          onClick={onJoin}
          disabled={join.isPending || connecting}
          className="rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: inThisOne ? '#0F172B' : MEETING_ACCENT }}
        >
          {inThisOne ? 'Open' : join.isPending || connecting ? 'Joining…' : 'Join'}
        </button>
      </div>
    </div>
  );
}
