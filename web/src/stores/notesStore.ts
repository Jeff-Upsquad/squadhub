import { create } from 'zustand';

// UI-only state for SquadNotes (selection, tree expand/collapse, recents).
// Persisted data lives in the DB; only the recents list is mirrored to
// localStorage so it survives reloads.

const RECENTS_KEY = 'squadnotes:recents';
const RECENTS_CAP = 12;

function loadRecents(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, RECENTS_CAP) : [];
  } catch {
    return [];
  }
}

function persistRecents(ids: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(ids.slice(0, RECENTS_CAP)));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

interface NotesState {
  activeNoteId: string | null;
  expandedIds: Set<string>;
  recentNoteIds: string[];

  setActiveNote: (id: string | null) => void;
  toggleExpanded: (id: string) => void;
  setExpanded: (id: string, expanded: boolean) => void;
  expandAll: (ids: string[]) => void;
  pushRecent: (id: string) => void;
  removeRecent: (id: string) => void;
}

export const useNotesStore = create<NotesState>((set) => ({
  activeNoteId: null,
  expandedIds: new Set<string>(),
  recentNoteIds: loadRecents(),

  setActiveNote: (id) => set({ activeNoteId: id }),

  toggleExpanded: (id) =>
    set((s) => {
      const next = new Set(s.expandedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedIds: next };
    }),

  setExpanded: (id, expanded) =>
    set((s) => {
      const next = new Set(s.expandedIds);
      if (expanded) next.add(id);
      else next.delete(id);
      return { expandedIds: next };
    }),

  expandAll: (ids) =>
    set((s) => {
      const next = new Set(s.expandedIds);
      ids.forEach((id) => next.add(id));
      return { expandedIds: next };
    }),

  pushRecent: (id) =>
    set((s) => {
      const next = [id, ...s.recentNoteIds.filter((x) => x !== id)].slice(0, RECENTS_CAP);
      persistRecents(next);
      return { recentNoteIds: next };
    }),

  removeRecent: (id) =>
    set((s) => {
      const next = s.recentNoteIds.filter((x) => x !== id);
      persistRecents(next);
      return { recentNoteIds: next };
    }),
}));
