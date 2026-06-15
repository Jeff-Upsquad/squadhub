import { usePMStore } from '../../../stores/pmStore';
import {
  useRoutineCardItems,
  useCourseCardItems,
  useMeetingCardItems,
  type SecondaryCardData,
} from '../../../hooks/useSecondaryCards';
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
const RoutineIcon = () => (
  <svg {...icoProps}><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></svg>
);
const CourseIcon = () => (
  <svg {...icoProps}><path d="M3 7l9-4 9 4-9 4-9-4Z" /><path d="M21 7v6" /><path d="M7 9.5V14c0 1 2.2 2.5 5 2.5s5-1.5 5-2.5V9.5" /></svg>
);
const MeetingIcon = () => (
  <svg {...icoProps}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="M9 16l2 2 4-4" /></svg>
);

// A card spec resolves a data source (the hook result) to display chrome. To
// add a new secondary card, add a hook in useSecondaryCards.ts and one entry
// here. Hooks are called unconditionally (fixed order) to satisfy the Rules of
// Hooks — see SecondaryCardRow below.
export interface SecondaryCardConfig {
  key: string;
  name: string;
  icon: React.ReactNode;
  data: SecondaryCardData;
}

// onOpenInbox is part of every Home child's signature for consistency, even
// though this row doesn't use it.
export default function SecondaryCardRow() {
  const setActiveSecondaryCard = usePMStore((s) => s.setActiveSecondaryCard);
  const activeSecondaryCard = usePMStore((s) => s.activeSecondaryCard);

  // Fixed-order hook calls (Rules of Hooks). Each returns already-filtered
  // items (NOT completed AND due today/overdue).
  const routines = useRoutineCardItems();
  const courses = useCourseCardItems();
  const meetings = useMeetingCardItems();

  const cards: SecondaryCardConfig[] = [
    { key: 'routines', name: 'Routines', icon: <RoutineIcon />, data: routines },
    { key: 'courses', name: 'Courses', icon: <CourseIcon />, data: courses },
    { key: 'meetings', name: 'Meetings', icon: <MeetingIcon />, data: meetings },
  ];

  // Only show a card once it has at least one qualifying item. The whole row
  // stays hidden until something lands in it.
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
