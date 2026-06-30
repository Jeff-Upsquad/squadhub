import { usePMStore } from '../../../stores/pmStore';
import { useSecondaryCards, type SecondaryCardData } from '../../../hooks/useSecondaryCards';
import SecondaryCardPanel from './SecondaryCardPanel';

const icoProps = {
  width: 12,
  height: 12,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
};

const GoArrow = () => (
  <svg className="go" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 17 17 7M7 7h10v10" />
  </svg>
);

// Icons (12px, stroke) — one per card type.
const UrgentIcon = () => (
  <svg {...icoProps}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
);
const RecordingIcon = () => (
  <svg {...icoProps}><path d="m22 8-6 4 6 4V8Z" /><rect x="2" y="6" width="14" height="12" rx="2" /></svg>
);
const MeetingIcon = () => (
  <svg {...icoProps}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="M9 16l2 2 4-4" /></svg>
);
const CallIcon = () => (
  <svg {...icoProps}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" /></svg>
);

// A card spec resolves a data source (the hook result) to display chrome. To
// add a card, add it to useSecondaryCards and one entry here.
export interface SecondaryCardConfig {
  key: string;
  name: string;
  eyebrow: string;
  icon: React.ReactNode;
  data: SecondaryCardData;
}

// The Home "disappearing cards" row: a second stat-row under the main one. Each
// card appears only once it has at least one qualifying task and the whole row
// stays hidden until something lands in it. Clicking a card opens a slide-in
// list panel (SecondaryCardPanel).
export default function SecondaryCardRow() {
  const setActiveSecondaryCard = usePMStore((s) => s.setActiveSecondaryCard);
  const activeSecondaryCard = usePMStore((s) => s.activeSecondaryCard);
  const { urgent, recordings, meetings, calls } = useSecondaryCards();

  const cards: SecondaryCardConfig[] = [
    { key: 'urgent', name: 'Urgent', eyebrow: 'Priority: urgent', icon: <UrgentIcon />, data: urgent },
    { key: 'recordings', name: 'Recordings', eyebrow: 'Label: recording', icon: <RecordingIcon />, data: recordings },
    { key: 'meetings', name: 'Meetings', eyebrow: 'Label: meeting', icon: <MeetingIcon />, data: meetings },
    { key: 'calls', name: 'Calls', eyebrow: 'Label: calls', icon: <CallIcon />, data: calls },
  ];

  const visible = cards.filter((c) => c.data.items.length > 0);
  const activeCard = cards.find((c) => c.key === activeSecondaryCard) || null;

  if (visible.length === 0) {
    // Still render the panel so an open card can close cleanly if its last item
    // was just completed; the panel returns null when nothing is active.
    return <SecondaryCardPanel card={activeCard} />;
  }

  return (
    <>
      <div className="hm-stats hm-stats-secondary">
        {visible.map((c) => {
          const items = c.data.items;
          const hasOverdue = items.some((i) => i.overdue);
          return (
            <div
              key={c.key}
              className="hm-stat"
              data-alert={hasOverdue}
              role="button"
              tabIndex={0}
              onClick={() => setActiveSecondaryCard(c.key)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveSecondaryCard(c.key); } }}
            >
              <div className="lbl">
                {c.icon}
                {c.name}
                {hasOverdue && <span className="ping" />}
              </div>
              <div className="val">{items.length}</div>
              <GoArrow />
            </div>
          );
        })}
      </div>

      <SecondaryCardPanel card={activeCard} />
    </>
  );
}
