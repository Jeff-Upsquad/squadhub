import { create } from 'zustand';

// Learning (Resources) navigation target, persisted so a mirrored task's
// "Open resource" button can jump straight to a specific item page/subpage/
// section from anywhere in the app. A `nonce` bump lets re-opening the same
// target re-fire (e.g. scroll to a section the user scrolled past).
export interface LearningTarget {
  itemId: string;
  lessonId?: string | null;
  sectionAnchor?: string | null;
  sectionLabel?: string | null;
  nonce: number;
}

interface LearningState {
  target: LearningTarget | null;
  setLearningTarget: (t: Omit<LearningTarget, 'nonce'> | null) => void;
  clearLearningTarget: () => void;
}

export const useLearningStore = create<LearningState>()((set, get) => ({
  target: null,
  setLearningTarget: (t) => {
    if (!t) {
      set({ target: null });
      return;
    }
    // Always bump the nonce so re-firing the same target still re-applies
    // (e.g. scrolling to a different section of the same page).
    const nonce = (get().target?.nonce ?? 0) + 1;
    set({ target: { ...t, nonce } });
  },
  clearLearningTarget: () => set({ target: null }),
}));
