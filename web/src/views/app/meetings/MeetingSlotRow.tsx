import type { MeetingSlotSummary, MeetingVoteValue, MeetingVoterRef } from '@squadhub/shared';
import { MEETING_ACCENT, formatSlotDate, slotTimeLabel } from './meetingUtils';

function namesOf(voters: MeetingVoterRef[]): string {
  return voters.map((v) => v.display_name || 'Someone').join(', ');
}

function VoteButton({
  label,
  count,
  voters,
  active,
  onClick,
  disabled,
}: {
  label: string;
  count: number;
  voters: MeetingVoterRef[];
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={count > 0 ? namesOf(voters) : undefined}
      className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition disabled:opacity-50 ${
        active ? 'border-transparent text-white' : 'border-[#CAD5E2] bg-white text-[#0F172B] hover:border-[#94A3B8]'
      }`}
      style={active ? { backgroundColor: MEETING_ACCENT } : undefined}
    >
      <span>{label}</span>
      {count > 0 && (
        <span
          className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-white/25' : 'bg-[#E2E8F0] text-[#475569]'}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default function MeetingSlotRow({
  summary,
  isHost,
  readOnly,
  confirmed,
  onVote,
  onSuggestOpen,
  onRespond,
  onConfirm,
}: {
  summary: MeetingSlotSummary;
  isHost: boolean;
  readOnly?: boolean;
  confirmed?: boolean;
  onVote: (slotId: string, vote: MeetingVoteValue) => void;
  onSuggestOpen?: () => void;
  onRespond?: (slotId: string, response: 'confirm' | 'reject') => void;
  onConfirm?: (slotId: string) => void;
}) {
  const { slot, counts, voters, my_vote } = summary;
  const isSuggestion = slot.is_suggestion && summary.suggestion;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
        confirmed ? 'border-[#0a7d55] bg-[#ecfdf5]' : 'border-[#E2E8F0] bg-[#F8FAFC]'
      }`}
    >
      <div className="min-w-[8rem]">
        <div className="text-sm font-medium text-[#0F172B]">{slotTimeLabel(slot)}</div>
        <div className="text-xs text-[#64748B]">
          {formatSlotDate(slot.slot_date)}
          {isSuggestion && summary.suggestion?.suggested_by && (
            <> · suggested by {summary.suggestion.suggested_by.display_name || 'someone'}</>
          )}
        </div>
      </div>

      {confirmed ? (
        <span className="rounded-md bg-[#0a7d55] px-2 py-1 text-xs font-semibold text-white">Confirmed</span>
      ) : isSuggestion ? (
        <div className="flex items-center gap-1.5">
          {summary.suggestion?.status === 'rejected' ? (
            <span className="text-xs font-medium text-red-500">Rejected</span>
          ) : (
            <>
              <VoteButton
                label="Confirm"
                count={summary.suggestion?.confirms.length ?? 0}
                voters={summary.suggestion?.confirms ?? []}
                active={summary.suggestion?.my_response === 'confirm'}
                onClick={() => onRespond?.(slot.id, 'confirm')}
                disabled={readOnly}
              />
              <VoteButton
                label="Reject"
                count={summary.suggestion?.rejects.length ?? 0}
                voters={summary.suggestion?.rejects ?? []}
                active={summary.suggestion?.my_response === 'reject'}
                onClick={() => onRespond?.(slot.id, 'reject')}
                disabled={readOnly}
              />
              {isHost && <span className="ml-1 text-[10px] text-[#94A3B8]">host confirm promotes</span>}
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <VoteButton label="Yes" count={counts.yes} voters={voters.yes} active={my_vote === 'yes'} onClick={() => onVote(slot.id, 'yes')} disabled={readOnly} />
          <VoteButton label="No" count={counts.no} voters={voters.no} active={my_vote === 'no'} onClick={() => onVote(slot.id, 'no')} disabled={readOnly} />
          <VoteButton label="May be" count={counts.maybe} voters={voters.maybe} active={my_vote === 'maybe'} onClick={() => onVote(slot.id, 'maybe')} disabled={readOnly} />
          {onSuggestOpen && !readOnly && (
            <button type="button" onClick={onSuggestOpen} className="rounded-md border border-dashed border-[#CAD5E2] px-2 py-1 text-xs text-[#475569] hover:border-[#94A3B8]">
              Suggest
            </button>
          )}
          {isHost && onConfirm && (
            <button type="button" onClick={() => onConfirm(slot.id)} className="rounded-md px-2 py-1 text-xs font-medium text-white" style={{ backgroundColor: MEETING_ACCENT }}>
              Lock
            </button>
          )}
        </div>
      )}
    </div>
  );
}
