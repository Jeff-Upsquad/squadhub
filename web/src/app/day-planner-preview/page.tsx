import type { Metadata } from 'next';
import DayPlannerPreview from './DayPlannerPreview';

export const metadata: Metadata = {
  title: 'Day Planner · SquadHub preview',
  description: 'The real Day Planner view running against in-memory sample data.',
};

export default function DayPlannerPreviewPage() {
  return <DayPlannerPreview />;
}
