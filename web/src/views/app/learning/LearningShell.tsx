'use client';
import { useCallback, useEffect, useState } from 'react';
import LearningSidebar from './LearningSidebar';
import LearningItemView from './LearningItemView';
import LearningOverview from './LearningOverview';
import { useLearningStore } from '../../../stores/learningStore';

// Resources module shell.
//   • No item open  → a persistent catalog pane (left) + the Resources overview
//     "web page" (right), which carries the cross-content search.
//   • Item open      → the item takes over full-width with its own left nav
//     (course chapters / SOP page tree), matching the Notion/help-center feel.
//
// The overview's search `query` is lifted here so returning from an item lands
// back on the same results.
export default function LearningShell() {
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [sectionAnchor, setSectionAnchor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const learningTarget = useLearningStore((s) => s.target);

  const open = useCallback((itemId: string, lessonId?: string | null) => {
    setActiveItemId(itemId);
    setActiveLessonId(lessonId ?? null);
    setSectionAnchor(null);
  }, []);
  const back = useCallback(() => {
    setActiveItemId(null);
    setActiveLessonId(null);
    setSectionAnchor(null);
  }, []);

  // Apply a navigation target fired from outside the Resources module (e.g. a
  // mirrored task's "Open resource" button). The nonce makes re-firing the same
  // target take effect again.
  useEffect(() => {
    if (!learningTarget) return;
    setActiveItemId(learningTarget.itemId);
    setActiveLessonId(learningTarget.lessonId ?? null);
    setSectionAnchor(learningTarget.sectionAnchor ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learningTarget?.nonce]);

  if (activeItemId) {
    return (
      <div className="h-full overflow-hidden bg-surface">
        <LearningItemView
          itemId={activeItemId}
          initialLessonId={activeLessonId}
          initialSectionAnchor={sectionAnchor}
          onBack={back}
        />
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-1 overflow-hidden md:grid-cols-[300px_1fr]">
      <aside className="hidden h-full min-h-0 flex-col overflow-hidden border-[var(--sh-hair)] bg-[var(--sidebar)] md:flex md:border-r">
        <LearningSidebar activeItemId={activeItemId} onSelectItem={(id) => open(id)} />
      </aside>
      <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
        <LearningOverview query={query} setQuery={setQuery} onSelectItem={open} />
      </section>
    </div>
  );
}
