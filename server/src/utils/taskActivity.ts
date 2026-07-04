import { supabaseAdmin } from '../supabase';
import { getWorkspaceIdForTask } from './labels';

// One row in the task activity feed (migration 147). The detail panel's
// "Activity" section renders these as human sentences.
//
// Value shapes by event:
//   field_change (scalar: title/description/status/priority/*_date) -> raw value
//   field_change field='task_type_id'                                -> {id, name}
//   field_change field='time_tracked' (SECONDS) / 'recurrence' / 'metadata'
//   assignee_added / assignee_removed                                -> {id, name}
//   label_added / label_removed                                      -> {id, name}
//   list_link_added / list_link_removed                              -> {id, name}
//   moved                                                            -> {id, name}
//   subtask_added / subtask_removed                                  -> {id, title}
//   attachment_added / attachment_removed                            -> {name}
//   focus_set / focus_cleared                                        -> (no values)
//   snooze_set (ISO string) / snooze_cleared                         -> new_value / (none)
//   reviewed / unreviewed / comment_deleted / created               -> (no values)
//
// time_estimate is intentionally NOT logged here — it has its own audit table
// (task_estimate_changes, migration 134) which the read endpoint folds into the
// same feed, so logging it here too would double-count it. time_tracked writes
// from the running timer go through PUT /pm/tasks/:id and are also NOT logged
// (per-tick noise); only the manual "Logged" edit (PATCH /time-tracked) is.
export type TaskActivityEvent = {
  event_type: string;
  field?: string | null;
  old_value?: unknown;
  new_value?: unknown;
};

// Append activity rows for a task. Best-effort and fully isolated: a logging
// failure must NEVER fail the originating mutation (matching the estimate-audit
// pattern in PUT /pm/tasks/:id). Resolves the task's workspace once for the
// whole batch.
export async function logTaskActivity(
  taskId: string,
  userId: string | null,
  events: TaskActivityEvent[],
): Promise<void> {
  if (!events.length) return;
  try {
    const workspaceId = await getWorkspaceIdForTask(taskId);
    const rows = events.map((e) => ({
      task_id: taskId,
      user_id: userId,
      workspace_id: workspaceId,
      event_type: e.event_type,
      field: e.field ?? null,
      old_value: e.old_value === undefined ? null : e.old_value,
      new_value: e.new_value === undefined ? null : e.new_value,
    }));
    const { error } = await supabaseAdmin.from('task_activity').insert(rows);
    if (error) console.error('task_activity insert failed:', error);
  } catch (err) {
    console.error('task_activity logging failed:', err);
  }
}
