import { create } from 'zustand';

/** UI state for Goals surfaces that can be opened from anywhere in the app. */
interface GoalsUIState {
  /** Goal shown in the full-screen view. */
  openGoalId: string | null;
  /** Standalone tab (/app/goals/:id): fills the window, closing leaves for Goals. */
  page: boolean;
  /** Task waiting for "Add to a goal". */
  pickForTaskId: string | null;
  /** Create-goal dialog, optionally pre-linking tasks. */
  create: { taskIds?: string[]; projectId?: string } | null;
  /** Folder/list waiting to be auto-included in a goal. */
  connectSource: { type: 'folder' | 'list'; id: string; name: string } | null;
  /** Bumped to ask MainLayout to switch to the Goals page. */
  goalsViewRequest: number;
  showGoalsView: () => void;
  openGoal: (id: string | null, opts?: { page?: boolean }) => void;
  pickGoalFor: (taskId: string | null) => void;
  startCreate: (prefill: { taskIds?: string[]; projectId?: string } | null) => void;
  setConnectSource: (source: GoalsUIState['connectSource']) => void;
}

export const useGoalsUI = create<GoalsUIState>((set) => ({
  openGoalId: null,
  page: false,
  pickForTaskId: null,
  create: null,
  connectSource: null,
  goalsViewRequest: 0,
  showGoalsView: () => set((s) => ({ goalsViewRequest: s.goalsViewRequest + 1 })),
  openGoal: (id, opts) => set({ openGoalId: id, page: !!id && !!opts?.page }),
  pickGoalFor: (taskId) => set({ pickForTaskId: taskId }),
  startCreate: (prefill) => set({ create: prefill }),
  setConnectSource: (connectSource) => set({ connectSource }),
}));

export function goalTabUrl(goalId: string) {
  return `/app/goals/${encodeURIComponent(goalId)}`;
}
