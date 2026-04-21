'use client';
import { useState } from 'react';
import LearningHome from './LearningHome';
import LearningItemView from './LearningItemView';

export default function LearningShell() {
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  if (activeItemId) {
    return (
      <LearningItemView
        itemId={activeItemId}
        onBack={() => setActiveItemId(null)}
      />
    );
  }

  return <LearningHome onOpenItem={(id) => setActiveItemId(id)} />;
}
