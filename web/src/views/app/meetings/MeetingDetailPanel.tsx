import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMeetingEvent, useMeetingActions } from '../../../hooks/useMeetingEvents';
import { useTabsStore } from '../../../stores/tabsStore';
import { buildExternalSnapshot } from '../../../lib/tabSnapshots';
import { MEETING_ACCENT, avatarColor, initialOf } from './meetingUtils';
import MeetingSlotRow from './MeetingSlotRow';
import MeetingAvailabilitySummary from './MeetingAvailabilitySummary';
import SuggestSlotPopover from './SuggestSlotPopover';
import CheckAvailabilityOverlay from './CheckAvailabilityOverlay';

const KIND_LABEL: Record<string, string> = { virtual: 'Virtual Meeting', in_person: 'In Person', event: 'Event' };

export default function MeetingDetailPanel({
  meetingId,
  currentUserId,
  onClose,
}: {
  meetingId: string;
  currentUserId: string;
  onClose: () => void;
}) {
  const { data: detail, isLoading } = useMeetingEvent(meetingId);
  const actions = useMeetingActions(meetingId);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [availOpen, setAvailOpen] = useState(false);

  const isHost = !!detail && detail.event.created_by === currentUserId;
  const readOnly = !!detail && detail.event.status !== 'open';

  const body = (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="my-8 w-full max-w-lg rounded-xl border border-[#E2E8F0] bg-white p-6 shadow-2xl">
        {isLoading || !detail ? (
          <p className="py-8 text-center text-sm text-[#94A3B8]">Loading…</p>
        ) : (
          <>
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-lg font-semibold text-[#0F172B]">{detail.event.title}</h2>
              <button onClick={onClose} className="text-[#999] hover:text-[#0F172B]">✕</button>
            </div>

            <span className="mb-4 inline-block rounded-md px-3 py-1.5 text-sm font-medium text-white" style={{ backgroundColor: MEETING_ACCENT }}>
              {KIND_LABEL[detail.event.kind] || detail.event.kind}
            </span>
            {detail.event.status === 'cancelled' && (
              <span className="mb-4 ml-2 inline-block rounded-md bg-red-50 px-3 py-1.5 text-sm font-medium text-red-600">Cancelled</span>
            )}
            {detail.event.status === 'confirmed' && (
              <span className="mb-4 ml-2 inline-block rounded-md bg-[#ecfdf5] px-3 py-1.5 text-sm font-medium text-[#0a7d55]">Confirmed</span>
            )}

            {/* Guests + availability summary */}
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-[#666] font-[family-name:var(--font-mono)]">Guests</h3>
                <div className="rounded-lg bg-[#F8FAFC] p-2">
                  {detail.guests.map((g) => (
                    <div key={g.user_id} className="flex items-center gap-2 px-1 py-1 text-sm">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: avatarColor(g.user_id) }}>
                        {initialOf(g.user?.display_name)}
                      </span>
                      <span className="flex-1 text-[#0F172B]">
                        {g.user?.display_name || 'Member'}
                        {g.user_id === currentUserId && ' (you)'}
                      </span>
                      <span
                        title={g.responded ? 'Marked availability' : 'No response yet'}
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: g.responded ? MEETING_ACCENT : '#CBD5E1' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center">
                <MeetingAvailabilitySummary detail={detail} />
              </div>
            </div>

            {/* Meeting link — opens inside the app as a new tab. */}
            {detail.event.link_url && (
              <div className="mb-4">
                <h3 className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-[#666] font-[family-name:var(--font-mono)]">Meeting Link</h3>
                <button
                  type="button"
                  onClick={() => {
                    useTabsStore.getState().openInNewTab(buildExternalSnapshot(detail.event.link_url!, detail.event.title));
                    onClose();
                  }}
                  className="block w-full truncate rounded-lg border border-[#CAD5E2] bg-[#F8FAFC] px-3 py-2 text-left text-sm text-[#2962FF] hover:underline"
                >
                  {detail.event.link_url}
                </button>
              </div>
            )}

            {/* Agenda */}
            {detail.event.agenda && (
              <div className="mb-4">
                <h3 className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-[#666] font-[family-name:var(--font-mono)]">Agenda</h3>
                <p className="whitespace-pre-wrap text-sm text-[#334155]">{detail.event.agenda}</p>
              </div>
            )}

            {/* Slots */}
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-[#666] font-[family-name:var(--font-mono)]">Time Slots</h3>
                <button onClick={() => setAvailOpen(true)} className="rounded-md border border-[#CAD5E2] px-2 py-1 text-xs font-medium text-[#0F172B] hover:border-[#94A3B8]">
                  Check Availability
                </button>
              </div>
              <div className="space-y-2">
                {detail.slots.map((s) => (
                  <MeetingSlotRow
                    key={s.slot.id}
                    summary={s}
                    isHost={isHost}
                    readOnly={readOnly}
                    confirmed={detail.event.confirmed_slot_id === s.slot.id}
                    onVote={(slotId, vote) => actions.vote.mutate({ slotId, vote })}
                    onRespond={(slotId, response) => actions.respondSuggestion.mutate({ slotId, response })}
                    onSuggestOpen={() => setSuggestOpen(true)}
                    onConfirm={(slotId) => actions.confirm.mutate(slotId)}
                  />
                ))}
              </div>
            </div>

            {/* Footer actions */}
            {isHost && detail.event.status === 'open' && (
              <div className="flex justify-end gap-3 border-t border-[#E2E8F0] pt-4">
                <button onClick={() => actions.cancel.mutate()} className="rounded-lg border border-[#CAD5E2] px-4 py-2 text-sm text-[#666] hover:border-red-400 hover:text-red-500">
                  Cancel meeting
                </button>
              </div>
            )}

            {suggestOpen && (
              <SuggestSlotPopover
                durationMin={detail.event.duration_min}
                onClose={() => setSuggestOpen(false)}
                onSubmit={(input) => actions.suggest.mutate(input)}
              />
            )}
            {availOpen && <CheckAvailabilityOverlay detail={detail} onClose={() => setAvailOpen(false)} />}
          </>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(body, document.body);
}
