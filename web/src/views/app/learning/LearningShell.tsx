'use client';
import { useCallback, useEffect } from 'react';
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
  const activeItemId = useLearningStore((s) => s.activeItemId);
  const activeLessonId = useLearningStore((s) => s.activeLessonId);
  const sectionAnchor = useLearningStore((s) => s.sectionAnchor);
  const query = useLearningStore((s) => s.query);
  const setActiveItem = useLearningStore((s) => s.setActiveItem);
  const setQuery = useLearningStore((s) => s.setQuery);
  const learningTarget = useLearningStore((s) => s.target);

  const open = useCallback(
    (itemId: string, lessonId?: string | null) => {
      setActiveItem(itemId, lessonId ?? null, null);
    },
    [setActiveItem],
  );
  const back = useCallback(() => {
    setActiveItem(null, null, null);
  }, [setActiveItem]);

  // Apply a navigation target fired from outside the Resources module (e.g. a
  // mirrored task's "Open resource" button). The nonce makes re-firing the same
  // target take effect again.
  useEffect(() => {
    if (!learningTarget) return;
    setActiveItem(learningTarget.itemId, learningTarget.lessonId ?? null, learningTarget.sectionAnchor ?? null);
  }, [learningTarget?.nonce, setActiveItem]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Catalog sidebar is rendered by MainLayout's outer module sidebar (same
  // container/width/height as Home) so the side menu doesn't jump in width or
  // height when switching to Resources. This shell only renders the overview.
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      <LearningOverview query={query} setQuery={setQuery} onSelectItem={open} />
    </div>
  );
}
