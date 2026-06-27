import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MEETING_ACCENT, timeStrToMin } from './meetingUtils';

// Small modal to propose an alternate date/time.
export default function SuggestSlotPopover({
  durationMin,
  onClose,
  onSubmit,
}: {
  durationMin: number | null;
  onClose: () => void;
  onSubmit: (input: { slot_date: string; start_min?: number | null; end_min?: number | null }) => void;
}) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('17:00');
  const [withTime, setWithTime] = useState(durationMin != null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return;
    const start = withTime ? timeStrToMin(time) : null;
    const end = start != null && durationMin ? start + durationMin : null;
    onSubmit({ slot_date: date, start_min: start, end_min: end });
    onClose();
  };

  const modal = (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-xs rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-2xl">
        <h3 className="mb-3 text-sm font-semibold text-[#0F172B]">Suggest a time</h3>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mb-3 w-full rounded-lg border border-[#CAD5E2] bg-[#F8FAFC] px-3 py-2 text-sm" />
        <label className="mb-2 flex items-center gap-2 text-sm text-[#475569]">
          <input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} /> Include a time
        </label>
        {withTime && (
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mb-3 w-full rounded-lg border border-[#CAD5E2] bg-[#F8FAFC] px-3 py-2 text-sm" />
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[#CAD5E2] px-3 py-1.5 text-sm text-[#666]">Cancel</button>
          <button type="submit" disabled={!date} className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50" style={{ backgroundColor: MEETING_ACCENT }}>Suggest</button>
        </div>
      </form>
    </div>
  );
  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
