import { useState } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { useMeetingEvent, useMeetingActions } from '../../../hooks/useMeetingEvents';
import { MEETING_ACCENT } from '../meetings/meetingUtils';
import MeetingSlotRow from '../meetings/MeetingSlotRow';
import MeetingDetailPanel from '../meetings/MeetingDetailPanel';

const KIND_LABEL: Record<string, string> = { virtual: 'Virtual Meeting', in_person: 'In Person', event: 'Event' };

// Compact interactive meeting poll rendered inline in a chat message. Shares the
// live meeting state (per-meeting socket room) with the mini-app detail view.
export default function MeetingPollCard({ meetingEventId }: { meetingEventId: string }) {
  const currentUserId = useAuthStore((s) => s.user?.id) || '';
  const { data: detail, isLoading } = useMeetingEvent(meetingEventId);
  const actions = useMeetingActions(meetingEventId);
  const [open, setOpen] = useState(false);

  if (isLoading || !detail) {
    return <div className="mt-1 max-w-md rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-xs text-[#94A3B8]">Loading meeting…</div>;
  }

  const isHost = detail.event.created_by === currentUserId;
  const readOnly = detail.event.status !== 'open';

  return (
    <div className="mt-1 max-w-md rounded-xl border border-[#E2E8F0] bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-md px-2 py-0.5 text-[11px] font-medium text-white" style={{ backgroundColor: MEETING_ACCENT }}>
            {KIND_LABEL[detail.event.kind] || detail.event.kind}
          </span>
          <span className="text-sm font-semibold text-[#0F172B]">{detail.event.title}</span>
        </div>
        {detail.event.status !== 'open' && (
          <span className="text-xs font-medium capitalize text-[#64748B]">{detail.event.status}</span>
        )}
      </div>

      {detail.event.link_url && detail.event.status === 'confirmed' && (
        <a href={detail.event.link_url} target="_blank" rel="noopener noreferrer" className="mb-2 block truncate text-xs text-[#2962FF] hover:underline">
          {detail.event.link_url}
        </a>
      )}

      <div className="space-y-1.5">
        {detail.slots.slice(0, 4).map((s) => (
          <MeetingSlotRow
            key={s.slot.id}
            summary={s}
            isHost={isHost}
            readOnly={readOnly}
            confirmed={detail.event.confirmed_slot_id === s.slot.id}
            onVote={(slotId, vote) => actions.vote.mutate({ slotId, vote })}
            onRespond={(slotId, response) => actions.respondSuggestion.mutate({ slotId, response })}
            onConfirm={(slotId) => actions.confirm.mutate(slotId)}
          />
        ))}
      </div>

      <button onClick={() => setOpen(true)} className="mt-2 text-xs font-medium" style={{ color: MEETING_ACCENT }}>
        Open details{detail.slots.length > 4 ? ` (+${detail.slots.length - 4} more)` : ''}
      </button>

      {open && currentUserId && (
        <MeetingDetailPanel meetingId={meetingEventId} currentUserId={currentUserId} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
