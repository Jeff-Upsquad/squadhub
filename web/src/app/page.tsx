import type { Metadata } from 'next';
import SquadHubLanding from './landing/SquadHubLanding';

export const metadata: Metadata = {
  title: 'SquadHub — The shared workspace for your team’s best work.',
  description: 'Bring your tasks, conversations, calendar, and knowledge together. SquadHub is the shared workspace that keeps your team moving in the same direction.',
};

export default function Home() {
  return <SquadHubLanding />;
}
