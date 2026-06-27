import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { MeetingEventDetail } from '@squadhub/shared';
import { useDayPlansRange } from '../../../hooks/useDayPlanner';
import { MEETING_ACCENT, formatSlotDate, minToLabel } from './meetingUtils';

const START = 420; // 7:00
const END = 1260; // 21:00
const PX = 0.6;
const H = (END - START) * PX;

// Compares the proposed slots (highlighted) against the viewer's existing
// scheduled events (light shade) on the same days — reuses the day-planner data.
export default function CheckAvailabilityOverlay({
  detail,
  onClose,
}: {
  detail: MeetingEventDetail;
  onClose: () => void;
}) {
  const dates = useMemo(
    () => Array.from(new Set(detail.slots.map((s) => s.slot.slot_date))).sort(),
    [detail.slots],
  );
  const plansByDate = useDayPlansRange(dates);

  const hours: number[] = [];
  for (let m = START; m <= END; m += 60) hours.push(m);

  const modal = (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#0F172B]">Check Availability</h3>
          <button onClick={onClose} className="text-[#999] hover:text-[#0F172B]">✕</button>
        </div>
        <div className="mb-3 flex items-center gap-4 text-xs text-[#64748B]">
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: MEETING_ACCENT }} /> Proposed slot</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-[#CBD5E1]" /> Your existing event</span>
        </div>

        <div className="flex gap-2">
          {/* hour gutter */}
          <div className="relative w-12 shrink-0" style={{ height: H }}>
            {hours.map((m) => (
              <div key={m} className="absolute right-1 -translate-y-1/2 text-[10px] text-[#94A3B8]" style={{ top: (m - START) * PX }}>
                {minToLabel(m)}
              </div>
            ))}
          </div>

          {/* day columns */}
          <div className="flex flex-1 gap-2 overflow-x-auto">
            {dates.map((date) => {
              const existing = plansByDate[date] || [];
              const proposed = detail.slots.filter((s) => s.slot.slot_date === date);
              const datesOnly = proposed.filter((p) => p.slot.start_min == null);
              return (
                <div key={date} className="min-w-[8rem] flex-1">
                  <div className="mb-1 text-center text-xs font-medium text-[#0F172B]">{formatSlotDate(date)}</div>
                  {datesOnly.length > 0 && (
                    <div className="mb-1 rounded px-1 py-0.5 text-center text-[10px] font-medium text-white" style={{ backgroundColor: MEETING_ACCENT }}>
                      Proposed (all day)
                    </div>
                  )}
                  <div className="relative rounded border border-[#E2E8F0] bg-[#F8FAFC]" style={{ height: H }}>
                    {hours.map((m) => (
                      <div key={m} className="absolute left-0 right-0 border-t border-[#EEF2F6]" style={{ top: (m - START) * PX }} />
                    ))}
                    {/* existing events (shaded) */}
                    {existing.map((p, idx) => (
                      <div
                        key={`e${idx}`}
                        className="absolute left-0.5 right-0.5 overflow-hidden rounded bg-[#CBD5E1]/70 px-1 text-[10px] text-[#475569]"
                        style={{ top: Math.max(0, (p.start_minute - START) * PX), height: Math.max(8, p.duration_minutes * PX) }}
                        title={p.task?.title || 'Busy'}
                      >
                        {p.task?.title || 'Busy'}
                      </div>
                    ))}
                    {/* proposed timed slots (highlight) */}
                    {proposed
                      .filter((p) => p.slot.start_min != null)
                      .map((p) => {
                        const start = p.slot.start_min!;
                        const end = p.slot.end_min ?? start + 30;
                        return (
                          <div
                            key={p.slot.id}
                            className="absolute left-0.5 right-0.5 overflow-hidden rounded px-1 text-[10px] font-medium text-white"
                            style={{ top: Math.max(0, (start - START) * PX), height: Math.max(10, (end - start) * PX), backgroundColor: MEETING_ACCENT }}
                            title={`Proposed ${minToLabel(start)}`}
                          >
                            {minToLabel(start)}
                          </div>
                        );
                      })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
  if (typeof document === 'undefined') return null;
  return createPortal(modal, document.body);
}
