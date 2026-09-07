import { useLearningStore } from '../stores/learningStore';

export function openSopResource(itemId: string, lessonId?: string | null) {
  if (!itemId) return;
  useLearningStore.getState().setLearningTarget({
    itemId,
    lessonId: lessonId || null,
    sectionAnchor: null,
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('squadhub:open-resource'));
  }
}

export function sopTargetFromNotification(n: { type?: string; metadata?: Record<string, any> | null }) {
  if (n.type !== 'sop_flag' && n.type !== 'sop_strike') return null;
  const itemId = n.metadata?.item_id as string | undefined;
  if (!itemId) return null;
  return { itemId, lessonId: (n.metadata?.lesson_id as string | null) || null };
}
