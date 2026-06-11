import { supabaseAdmin } from '../supabase';
import { taskRecurrenceOccursOn, type TaskRecurrence } from '@squadhub/shared';
import { todayIST, formatTimeIST } from '../utils/ist';

// Spawns concrete task copies from routine templates (tasks with a non-null
// `recurrence` rule). Idempotency is guaranteed by the partial unique index
// uq_tasks_routine_instance on (recurring_parent_id, recurrence_instance_date),
// so the midnight cron, the boot catch-up sweep, and manual "Run now" can all
// fire for the same date without creating duplicates.

export type SpawnOutcome = 'created' | 'exists' | 'error';

// Mirrors the default-status logic in POST /pm/tasks: catalog-driven 'task'
// type starts at 'open'; every other type still uses legacy 'todo'.
async function defaultStatusForType(taskTypeId: string | null): Promise<string> {
  if (taskTypeId) {
    const { data: t } = await supabaseAdmin
      .from('task_types')
      .select('key')
      .eq('id', taskTypeId)
      .maybeSingle();
    if ((t as any)?.key === 'task') return 'open';
  }
  return 'todo';
}

// Instance due date: the occurrence date at the template's due time-of-day
// (IST). Templates without a due time get end-of-business 6 PM IST.
function instanceDueDate(template: any, dateStr: string): string {
  let hhmm = '18:00';
  if (template.due_date) {
    hhmm = formatTimeIST(new Date(template.due_date));
  }
  return new Date(`${dateStr}T${hhmm}:00+05:30`).toISOString();
}

// Per-client sequential display number — same behaviour as POST /pm/tasks.
async function resolveDisplayNumber(listId: string): Promise<number | null> {
  const { data: parentList } = await supabaseAdmin
    .from('lists')
    .select('folder_id')
    .eq('id', listId)
    .single();
  if (!parentList?.folder_id) return null;
  const { data: parentFolder } = await supabaseAdmin
    .from('folders')
    .select('client_id')
    .eq('id', parentList.folder_id)
    .single();
  if (!parentFolder?.client_id) return null;
  const { data: n, error } = await supabaseAdmin.rpc(
    'increment_client_task_counter',
    { p_client_id: parentFolder.client_id },
  );
  if (error) {
    console.warn('[routineSpawner] increment_client_task_counter failed:', error);
    return null;
  }
  return typeof n === 'number' ? n : null;
}

// Copy the template's checklists onto a freshly spawned instance, with all
// items reset to unchecked. Item-level due dates are intentionally dropped
// (they'd be stale on every cycle); per-item assignees are kept.
async function copyChecklists(templateId: string, instanceId: string, createdBy: string): Promise<void> {
  const { data: checklists } = await supabaseAdmin
    .from('task_checklists')
    .select('id, title, position')
    .eq('task_id', templateId)
    .order('position');
  if (!checklists || checklists.length === 0) return;

  const { data: items } = await supabaseAdmin
    .from('task_checklist_items')
    .select('checklist_id, content, position, assigned_to')
    .in('checklist_id', checklists.map((c: any) => c.id))
    .order('position');

  for (const cl of checklists as any[]) {
    const { data: newCl, error: clErr } = await supabaseAdmin
      .from('task_checklists')
      .insert({ task_id: instanceId, title: cl.title, position: cl.position, created_by: createdBy })
      .select('id')
      .single();
    if (clErr || !newCl) {
      console.warn('[routineSpawner] checklist copy failed:', clErr?.message);
      continue;
    }
    const clItems = (items || []).filter((i: any) => i.checklist_id === cl.id);
    if (clItems.length > 0) {
      const { error: itemsErr } = await supabaseAdmin.from('task_checklist_items').insert(
        clItems.map((i: any) => ({
          checklist_id: (newCl as any).id,
          content: i.content,
          position: i.position,
          assigned_to: i.assigned_to,
          is_done: false,
        })),
      );
      if (itemsErr) console.warn('[routineSpawner] checklist items copy failed:', itemsErr.message);
    }
  }
}

// Create the concrete task copy for one (template, date) pair.
export async function spawnRoutineInstance(template: any, dateStr: string): Promise<SpawnOutcome> {
  // Cheap pre-check; the unique index still catches races.
  const { data: existing } = await supabaseAdmin
    .from('tasks')
    .select('id')
    .eq('recurring_parent_id', template.id)
    .eq('recurrence_instance_date', dateStr)
    .maybeSingle();
  if (existing) return 'exists';

  const status = await defaultStatusForType(template.task_type_id ?? null);
  const displayNumber = await resolveDisplayNumber(template.list_id);

  const insertData: Record<string, any> = {
    list_id: template.list_id,
    title: template.title,
    description: template.description ?? null,
    status,
    priority: template.priority || 'none',
    due_date: instanceDueDate(template, dateStr),
    task_type_id: template.task_type_id ?? null,
    assignee_ids: template.assignee_ids || [],
    time_estimate: template.time_estimate ?? null,
    metadata: template.metadata || {},
    created_by: template.created_by,
    recurring_parent_id: template.id,
    recurrence_instance_date: dateStr,
  };
  if (displayNumber != null) insertData.display_number = displayNumber;

  const { data: instance, error } = await supabaseAdmin
    .from('tasks')
    .insert(insertData)
    .select('id')
    .single();

  if (error) {
    // 23505 = unique_violation: another worker spawned this occurrence first.
    if ((error as any).code === '23505') return 'exists';
    console.error(`[routineSpawner] spawn failed for template ${template.id} on ${dateStr}:`, error.message);
    return 'error';
  }

  await copyChecklists(template.id, (instance as any).id, template.created_by);
  return 'created';
}

// Sweep all active templates and spawn every instance whose rule fires on
// `dateStr` (defaults to today in IST). Called by the midnight cron, the
// boot catch-up, and nothing else.
export async function spawnDueRoutineInstances(dateStr?: string): Promise<{ checked: number; spawned: number }> {
  const date = dateStr || todayIST();
  const { data: templates, error } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .not('recurrence', 'is', null)
    .eq('recurrence_paused', false);

  if (error) {
    console.error('[routineSpawner] template scan failed:', error.message);
    return { checked: 0, spawned: 0 };
  }

  let spawned = 0;
  const due = (templates || []).filter((t: any) =>
    taskRecurrenceOccursOn(t.recurrence as TaskRecurrence, date),
  );
  for (const template of due) {
    const outcome = await spawnRoutineInstance(template, date);
    if (outcome === 'created') spawned++;
  }
  if (due.length > 0 || spawned > 0) {
    console.log(`[routineSpawner] ${date}: ${due.length} routine(s) due, ${spawned} instance(s) spawned`);
  }
  return { checked: due.length, spawned };
}
