import type { MeetingEventDetail } from '@squadhub/shared';
import { formatSlotDate, slotTimeLabel } from './meetingUtils';

// The message shown to the right of the guest list once people start responding:
// how many have responded, and the current best slot by Yes votes.
export default function MeetingAvailabilitySummary({ detail }: { detail: MeetingEventDetail }) {
  const total = detail.guests.length;
  const responded = detail.guests.filter((g) => g.responded).length;

  if (responded === 0) {
    return <p className="text-sm text-[#94A3B8]">No responses yet — guests haven’t marked their availability.</p>;
  }

  const votable = detail.slots.filter((s) => !s.slot.is_suggestion || s.suggestion?.status === 'accepted');
  const best = votable.slice().sort((a, b) => b.counts.yes - a.counts.yes)[0];

  return (
    <div className="text-sm text-[#475569]">
      <p>
        <span className="font-semibold text-[#0F172B]">{responded}</span> of {total} responded
      </p>
      {best && best.counts.yes > 0 && (
        <p className="mt-1">
          Best so far:{' '}
          <span className="font-medium text-[#0F172B]">
            {formatSlotDate(best.slot.slot_date)} · {slotTimeLabel(best.slot)}
          </span>{' '}
          <span className="text-[#0a7d55]">({best.counts.yes} yes)</span>
        </p>
      )}
    </div>
  );
}
