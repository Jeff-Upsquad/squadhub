import { useState } from 'react';
import { useMyMeetingEvents } from '../../../hooks/useMeetingEvents';
import { useAuthStore } from '../../../stores/authStore';
import { useMeetingPanelStore } from '../../../stores/meetingPanelStore';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { MEETING_ACCENT } from './meetingUtils';
import MeetingDetailPanel from './MeetingDetailPanel';

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-[#eff6ff] text-[#2563eb]',
  confirmed: 'bg-[#ecfdf5] text-[#0a7d55]',
  cancelled: 'bg-red-50 text-red-500',
};
const KIND_LABEL: Record<string, string> = { virtual: 'Virtual', in_person: 'In Person', event: 'Event' };

export default function MeetingsView() {
  const currentUserId = useAuthStore((s) => s.user?.id) || '';
  const openMeetingPanel = useMeetingPanelStore((s) => s.openMeetingPanel);
  const { data: meetings = [], isLoading } = useMyMeetingEvents();
  const [openId, setOpenId] = useState<string | null>(null);
  const isMobile = useIsMobile();

  return (
    <div className={`mmg mx-auto h-full w-full max-w-3xl overflow-y-auto ${isMobile ? 'p-0' : 'p-6'}`}>
      <div className="mtk-phone-head mmg-phone">
        <h1>Meetings</h1>
      </div>
      <div className="mb-5 flex items-center justify-between mmg-desk">
        <div>
          <h1 className="text-xl font-semibold text-[#0F172B]">Meetings</h1>
          <p className="text-sm text-[#64748B]">Propose times, vote on availability, and lock a slot.</p>
        </div>
        <button
          onClick={() => openMeetingPanel()}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: MEETING_ACCENT }}
        >
          + New Meeting
        </button>
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-[#94A3B8]">Loading…</p>
      ) : meetings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#CAD5E2] py-12 text-center">
          <p className="text-sm text-[#64748B]">No meetings yet.</p>
          <button onClick={() => openMeetingPanel()} className="mt-2 text-sm font-medium" style={{ color: MEETING_ACCENT }}>
            Create your first meeting
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {meetings.map((m) => (
            <button
              key={m.id}
              onClick={() => setOpenId(m.id)}
              className="flex w-full items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-4 py-3 text-left hover:border-[#94A3B8]"
            >
              <div>
                <div className="text-sm font-medium text-[#0F172B]">{m.title}</div>
                <div className="mt-0.5 text-xs text-[#64748B]">{KIND_LABEL[m.kind] || m.kind}</div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[m.status] || ''}`}>{m.status}</span>
            </button>
          ))}
        </div>
      )}

      {openId && currentUserId && (
        <MeetingDetailPanel meetingId={openId} currentUserId={currentUserId} onClose={() => setOpenId(null)} />
      )}

      <button type="button" className="mmg-fab" onClick={() => openMeetingPanel()}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Schedule meeting
      </button>
    </div>
  );
}
