import { supabaseAdmin } from '../supabase';

/**
 * Time blocks ("work blocks") are tasks whose task_types.key is 'work_block'.
 * They belong on calendar surfaces only (day planner, side-rail calendar,
 * time-tracking calendar) — never in task lists or review queues. Resolve the
 * type ids once per request so those endpoints can drop such rows cheaply.
 */
export async function getWorkBlockTaskTypeIds(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('task_types')
    .select('id')
    .eq('key', 'work_block');
  if (error) {
    console.error('[workBlockTasks] task_types lookup failed:', error);
    return new Set();
  }
  return new Set(((data || []) as any[]).map((t) => t.id));
}

/** True when the row is a time-block task (task_type_id belongs to the set). */
export function isWorkBlockTaskRow(task: { task_type_id?: string | null }, wbTypeIds: Set<string>): boolean {
  return !!task.task_type_id && wbTypeIds.has(task.task_type_id);
}
