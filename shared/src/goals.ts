// ============================================================
// Goals — outcomes tracked through existing workspace tasks
// ============================================================

/** Stored statuses. `achieved` is derived: every included task is complete. */
export type GoalStoredStatus = 'planned' | 'in_progress' | 'on_hold';
export type GoalStatus = GoalStoredStatus | 'achieved';
export type GoalPriority = 'emergency' | 'urgent' | 'high' | 'normal' | 'low' | 'none';
export type GoalEndpoint = 'start' | 'end';

export interface GoalProject {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  created_by: string;
  created_at: string;
}

export interface GoalDependency {
  id: string;
  goal_id: string;
  from_task_id: string;
  to_task_id: string;
  from_endpoint: GoalEndpoint;
  to_endpoint: GoalEndpoint;
}

/** A folder or list whose tasks are automatically included in a goal. */
export interface GoalSource {
  id: string;
  goal_id: string;
  resource_type: 'folder' | 'list';
  resource_id: string;
  name: string;
  path: string;
}

export interface GoalTask {
  id: string;
  title: string;
  status: string;
  completed: boolean;
  priority: string | null;
  display_number: number | null;
  parent_task_id: string | null;
  list_id: string;
  list_name: string;
  folder_name: string | null;
  space_id: string;
  space_name: string;
  space_color: string | null;
  assignee_ids: string[];
  /** Raw task timestamps — `work_date` is the work start. */
  work_date: string | null;
  work_end_date: string | null;
  start_date: string | null;
  due_date: string | null;
  /** Placed on this goal's timeline (otherwise it waits in the task tray). */
  scheduled: boolean;
  /** The viewer can change this task's dates/status. */
  can_edit: boolean;
  /** Linked by a person (vs. only pulled in by an auto-included container). */
  direct: boolean;
  /** Auto-included containers this task comes from. */
  source_ids: string[];
}

export interface Goal {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  description: string;
  /** Effective status — `achieved` once every included task is complete. */
  status: GoalStatus;
  stored_status: GoalStoredStatus;
  priority: GoalPriority;
  assignee_ids: string[];
  labels: string[];
  work_start_date: string | null;
  work_end_date: string | null;
  start_date: string | null;
  due_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  tasks: GoalTask[];
  dependencies: GoalDependency[];
  sources: GoalSource[];
  task_count: number;
  completed_count: number;
  progress: number;
  /** Included tasks the viewer can't open (still counted in progress). */
  hidden_task_count: number;
}

export interface GoalsData {
  projects: GoalProject[];
  goals: Goal[];
}

export interface GoalInput {
  project_id: string;
  name: string;
  description: string;
  status: GoalStoredStatus;
  priority: GoalPriority;
  assignee_ids: string[];
  labels: string[];
  work_start_date: string | null;
  work_end_date: string | null;
  start_date: string | null;
  due_date: string | null;
}

export function goalProgress(tasks: Pick<GoalTask, 'completed'>[]) {
  const completed_count = tasks.filter((t) => t.completed).length;
  return {
    task_count: tasks.length,
    completed_count,
    progress: tasks.length ? Math.round((completed_count / tasks.length) * 100) : 0,
  };
}

export function effectiveGoalStatus(
  status: GoalStoredStatus,
  taskCount: number,
  completedCount: number,
): GoalStatus {
  return taskCount > 0 && completedCount === taskCount ? 'achieved' : status;
}

/** Would adding from → to close a loop in the dependency graph? */
export function wouldCreateGoalCycle(
  edges: Pick<GoalDependency, 'from_task_id' | 'to_task_id'>[],
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  const visited = new Set<string>();
  const pending = [to];
  while (pending.length) {
    const id = pending.pop()!;
    if (id === from) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const e of edges) if (e.from_task_id === id) pending.push(e.to_task_id);
  }
  return false;
}
