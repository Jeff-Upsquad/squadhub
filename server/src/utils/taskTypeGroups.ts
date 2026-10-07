import { supabaseAdmin } from '../supabase';
import type { TaskType, TaskTypeGroupEntityType } from '@squadhub/shared';

/**
 * Task-type-group helpers shared by admin routes and PM task endpoints.
 *
 * Resolution precedence (nearest wins):
 *   list assignment > folder assignment > space assignment >
 *   template assignment (via folder.client_space_template_id) >
 *   default group (is_default) > null
 */

export async function getGroupTaskTypes(groupId: string): Promise<TaskType[]> {
  const { data: items, error } = await supabaseAdmin
    .from('task_type_group_items')
    .select('*, task_types(*)')
    .eq('group_id', groupId)
    .order('position', { ascending: true });

  if (error) throw new Error(error.message);

  return (items || [])
    .filter((it: any) => !!it.task_types)
    .map((it: any) => ({
      ...it.task_types,
      position: it.position ?? it.task_types.position,
    }));
}

/** Fetch an enabled group by key with ordered task types (null when missing/disabled). */
export async function getGroupByKey(key: string) {
  const { data: group } = await supabaseAdmin
    .from('task_type_groups')
    .select('*')
    .eq('key', key)
    .eq('is_enabled', true)
    .maybeSingle();

  if (!group) return null;

  return {
    ...(group as any),
    task_types: await getGroupTaskTypes((group as any).id),
  };
}

export async function upsertAssignment(
  groupId: string,
  entityType: TaskTypeGroupEntityType,
  entityId: string,
  createdBy?: string,
) {
  // One group per entity: remove any existing assignment for this entity first.
  await supabaseAdmin
    .from('task_type_group_assignments')
    .delete()
    .eq('entity_type', entityType)
    .eq('entity_id', entityId);

  const { data, error } = await supabaseAdmin
    .from('task_type_group_assignments')
    .insert({
      group_id: groupId,
      entity_type: entityType,
      entity_id: entityId,
      created_by: createdBy || null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function getAssignmentFor(
  entityType: TaskTypeGroupEntityType,
  entityId: string,
) {
  const { data } = await supabaseAdmin
    .from('task_type_group_assignments')
    .select('*, task_type_groups(*)')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle();
  return data as any;
}

/**
 * Resolve the effective task type group for a task container.
 * Pass whichever ids are known; nearest assignment wins.
 */
export async function resolveEffectiveTaskTypeGroup(opts: {
  spaceId?: string;
  folderId?: string | null;
  listId?: string | null;
}): Promise<{ assignment: any; task_types: TaskType[] } | null> {
  const { spaceId, folderId, listId } = opts;

  let folder: any = null;
  let list: any = null;

  if (listId) {
    const { data } = await supabaseAdmin
      .from('lists')
      .select('id, space_id, folder_id')
      .eq('id', listId)
      .maybeSingle();
    list = data;
  }
  const resolvedFolderId = folderId || list?.folder_id || null;
  const resolvedSpaceId = spaceId || list?.space_id || null;

  if (resolvedFolderId) {
    const { data } = await supabaseAdmin
      .from('folders')
      .select('id, space_id, client_space_template_id')
      .eq('id', resolvedFolderId)
      .maybeSingle();
    folder = data;
  }
  const finalSpaceId = resolvedSpaceId || folder?.space_id || null;

  // 1. list-level
  if (listId) {
    const a = await getAssignmentFor('list', listId);
    if (a && a.task_type_groups?.is_enabled) {
      return { assignment: a, task_types: await getGroupTaskTypes(a.group_id) };
    }
  }

  // 2. folder-level
  const fid = resolvedFolderId || folder?.id;
  if (fid) {
    const a = await getAssignmentFor('folder', fid);
    if (a && a.task_type_groups?.is_enabled) {
      return { assignment: a, task_types: await getGroupTaskTypes(a.group_id) };
    }
  }

  // 3. space-level
  if (finalSpaceId) {
    const a = await getAssignmentFor('space', finalSpaceId);
    if (a && a.task_type_groups?.is_enabled) {
      return { assignment: a, task_types: await getGroupTaskTypes(a.group_id) };
    }
  }

  // 4. template-level (future templated spaces inherit from here)
  const tplId = folder?.client_space_template_id || null;
  if (tplId) {
    const a = await getAssignmentFor('template', tplId);
    if (a && a.task_type_groups?.is_enabled) {
      return { assignment: a, task_types: await getGroupTaskTypes(a.group_id) };
    }
  }

  // 5. default group fallback
  const { data: def } = await supabaseAdmin
    .from('task_type_groups')
    .select('*')
    .eq('is_default', true)
    .eq('is_enabled', true)
    .limit(1)
    .maybeSingle();

  if (def) {
    return {
      assignment: { group_id: (def as any).id, task_type_groups: def, is_default_fallback: true },
      task_types: await getGroupTaskTypes((def as any).id),
    };
  }

  return null;
}
