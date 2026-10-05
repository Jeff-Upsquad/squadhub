import type { Metadata } from 'next';
import TaskTypesPreviewView from './TaskTypesPreviewView';

export const metadata: Metadata = {
  title: 'Task Types · SquadHub Preview',
  description: 'Searchable, grouped task types dropdown and directory preview.',
};

export default function TaskTypesPreviewPage() {
  return <TaskTypesPreviewView />;
}
