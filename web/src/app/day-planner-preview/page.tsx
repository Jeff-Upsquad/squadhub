import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import DayPlannerPreview from './DayPlannerPreview';

export const metadata: Metadata = {
  title: 'Day Planner · SquadHub preview',
  description: 'The real Day Planner view running against in-memory sample data.',
};

// Local review only. The preview swaps in a mock API and a stand-in user,
// which must never touch a real signed-in session, so production builds 404.
export default function DayPlannerPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DayPlannerPreview />;
}
