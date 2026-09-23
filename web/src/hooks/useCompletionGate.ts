import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SpaceStatus, Task, TaskChecklist } from '@squadhub/shared';
import api from '../services/api';
import { statusIsComplete } from '../views/app/pm/taskHelpers';

export interface IncompleteGateState {
  rect: DOMRect;
  taskId: string;
  subtasks: number;
  checklist: number;
}

export interface NoAssigneeGateState {
  rect: DOMRect;
  taskId: string;
}

export interface AssignGateState {
  rect: DOMRect;
  taskId: string;
}

/**
 * Shared completion gate — the same check TaskRow / TaskDetailPanel run when a
 * task is checked off, extracted so every checkbox surface behaves identically:
 *
 * 1. Blocking: open subtasks / unchecked checklist items stop the completion
 *    and show IncompleteItemsDialog (no complete-anyway; the server enforces
 *    the same rule as a backstop).
 * 2. Advisory: completing with nobody assigned asks first (assign to me /
 *    someone else / complete as-is) via NoAssigneeCompleteDialog.
 *
 * List rows don't carry subtask/checklist data, so the gate fetches both at
 * click time (cached under the same keys the detail panel uses) and fails open
 * on fetch errors. The no-assignee prompt mounts immediately so a simple
 * checkbox click never feels laggy waiting on those requests.
 */
export function useCompletionGate(opts: {
  statuses?: SpaceStatus[];
  onComplete: (taskId: string, assigneeIds?: string[]) => void;
}) {
  const { statuses = [], onComplete } = opts;
  const qc = useQueryClient();
  const [incomplete, setIncomplete] = useState<IncompleteGateState | null>(null);
  const [noAssignee, setNoAssignee] = useState<NoAssigneeGateState | null>(null);
  const [assignAnchor, setAssignAnchor] = useState<AssignGateState | null>(null);

  const closeAll = useCallback(() => {
    setIncomplete(null);
    setNoAssignee(null);
    setAssignAnchor(null);
  }, []);

  const closeIncomplete = useCallback(() => setIncomplete(null), []);
  const closeNoAssignee = useCallback(() => setNoAssignee(null), []);
  const closeAssign = useCallback(() => setAssignAnchor(null), []);

  /**
   * Run the gate for a complete-checkbox click. Returns true when the task was
   * completed immediately, false when a prompt was shown instead (or the task
   * was blocked). The caller owns re-opening (done -> todo flips straight back
   * with no prompt) and any fade/celebration animation.
   */
  const requestComplete = useCallback(
    async (task: Pick<Task, 'id' | 'assignees'>, e: React.MouseEvent): Promise<boolean> => {
      // Capture the anchor now — e.currentTarget is gone after the await below.
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const needsAssigneePrompt = (task.assignees?.length ?? 0) === 0;
      if (needsAssigneePrompt) setNoAssignee({ rect, taskId: task.id });
      // Rows outside the list module (Home panels, preview) don't carry the
      // space's statuses, so resolve custom done/closed status NAMES from the
      // cached space queries — same source useTasks' statusMeansComplete uses.
      // Without this a subtask on a custom done status would read as "open".
      let effective = statuses;
      if (effective.length === 0) {
        const collected: SpaceStatus[] = [];
        for (const [, data] of qc.getQueriesData({ queryKey: ['space'] })) {
          const list = (data as { space_statuses?: SpaceStatus[] } | null)?.space_statuses;
          if (Array.isArray(list)) collected.push(...list);
        }
        effective = collected;
      }
      try {
        const [detail, checklists] = await Promise.all([
          qc.fetchQuery<Task>({
            queryKey: ['task', task.id],
            queryFn: async () => (await api.get(`/pm/tasks/${task.id}`)).data.data,
            staleTime: 10_000,
          }),
          qc.fetchQuery<TaskChecklist[]>({
            queryKey: ['checklists', task.id],
            queryFn: async () => (await api.get(`/pm/tasks/${task.id}/checklists`)).data.data,
            staleTime: 10_000,
          }),
        ]);
        const openSubtasks = (detail?.subtasks || []).filter(
          (s) => !statusIsComplete((s as any).status as string | undefined, effective),
        ).length;
        const openChecklist = (checklists || [])
          .flatMap((c) => c.items || [])
          .filter((i) => !i.is_done).length;
        if (openSubtasks > 0 || openChecklist > 0) {
          // The blocking explanation replaces the fast no-assignee prompt.
          setNoAssignee(null);
          setIncomplete({ rect, taskId: task.id, subtasks: openSubtasks, checklist: openChecklist });
          return false;
        }
      } catch {
        /* fail open — the server-side gate still blocks */
      }
      if (needsAssigneePrompt) {
        setNoAssignee({ rect, taskId: task.id });
        return false;
      }
      onComplete(task.id);
      return true;
    },
    [onComplete, qc, statuses],
  );

  const assignToMe = useCallback(
    (taskId: string, meId?: string | null) => {
      if (meId) onComplete(taskId, [meId]);
      else onComplete(taskId);
      setNoAssignee(null);
    },
    [onComplete],
  );

  const moveToAssignOther = useCallback(() => {
    setNoAssignee((prev) => {
      if (prev) setAssignAnchor(prev);
      return null;
    });
  }, []);

  const completeAnyway = useCallback(
    (taskId: string) => {
      onComplete(taskId);
      setNoAssignee(null);
    },
    [onComplete],
  );

  const completeWithAssignees = useCallback(
    (taskId: string, ids: string[]) => {
      onComplete(taskId, ids);
      setAssignAnchor(null);
    },
    [onComplete],
  );

  return {
    incomplete,
    noAssignee,
    assignAnchor,
    requestComplete,
    assignToMe,
    moveToAssignOther,
    completeAnyway,
    completeWithAssignees,
    closeAll,
    closeIncomplete,
    closeNoAssignee,
    closeAssign,
  };
}
