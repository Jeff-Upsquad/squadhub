'use client';
import { useState } from 'react';
import LearningSidebar from './LearningSidebar';
import LearningItemView from './LearningItemView';
import LearningOverview from './LearningOverview';

// Learning module shell — a responsive master-detail layout that matches the
// rest of the app's "module sidebar + content panel" pattern.
//   • Desktop: a persistent menu pane (left) + content panel (right).
//   • Mobile: the menu fills the screen until an item is opened, then the
//     content panel takes over with a back affordance.
export default function LearningShell() {
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  return (
    <div className="grid h-full grid-cols-1 overflow-hidden md:grid-cols-[300px_1fr]">
      {/* Menu pane */}
      <aside
        className={`h-full min-h-0 flex-col overflow-hidden border-[var(--sh-hair)] bg-[var(--sidebar)] md:flex md:border-r ${
          activeItemId ? 'hidden' : 'flex'
        }`}
      >
        <LearningSidebar activeItemId={activeItemId} onSelectItem={setActiveItemId} />
      </aside>

      {/* Content panel */}
      <section
        className={`h-full min-h-0 flex-col overflow-hidden bg-surface md:flex ${
          activeItemId ? 'flex' : 'hidden md:flex'
        }`}
      >
        {activeItemId ? (
          <LearningItemView itemId={activeItemId} onBack={() => setActiveItemId(null)} />
        ) : (
          <LearningOverview onSelectItem={setActiveItemId} />
        )}
      </section>
    </div>
  );
}
