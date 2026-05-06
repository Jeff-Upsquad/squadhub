import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TaskPriority } from '@squadhub/shared';

const MAX_DRAFTS = 10;

export type SerializableDraft = {
  title: string;
  description: string;
  status: string;
  priority: TaskPriority;
  assignee_ids: string[];
  work_date: string | null;
  start_date: string | null;
  due_date: string | null;
  task_type_id: string | null;
  time_estimate: number | null;
  subtasks: { id: string; title: string }[];
  checklists: {
    id: string;
    title: string;
    items: { id: string; content: string; is_done: boolean }[];
  }[];
};

export type SavedDraft = {
  id: string;
  draft: SerializableDraft;
  savedAt: number;
  spaceId: string | null;
  listId: string | null;
};

interface DraftTaskState {
  drafts: SavedDraft[];
  saveDraft: (draft: SerializableDraft, spaceId: string | null, listId: string | null) => string;
  removeDraft: (id: string) => void;
  clearAll: () => void;
}

export const useDraftTaskStore = create<DraftTaskState>()(
  persist(
    (set, get) => ({
      drafts: [],

      saveDraft: (draft, spaceId, listId) => {
        const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const saved: SavedDraft = { id, draft, savedAt: Date.now(), spaceId, listId };
        set((state) => {
          let next = [...state.drafts, saved];
          if (next.length > MAX_DRAFTS) {
            next.sort((a, b) => a.savedAt - b.savedAt);
            next = next.slice(next.length - MAX_DRAFTS);
          }
          return { drafts: next };
        });
        return id;
      },

      removeDraft: (id) =>
        set((state) => ({ drafts: state.drafts.filter((d) => d.id !== id) })),

      clearAll: () => set({ drafts: [] }),
    }),
    {
      name: 'squadhub-draft-tasks',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ drafts: state.drafts }),
      version: 1,
    },
  ),
);
