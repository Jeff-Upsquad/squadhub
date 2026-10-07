import { supabaseAdmin } from '../supabase';
import { registerTaskStatusDefs, statusGroupRowToTaskDef, isSystemStatus } from '@squadhub/shared';

/**
 * Status-group helpers shared by the admin routes and the PM creation hooks.
 *
 * Resolution precedence (nearest wins):
 *   list assignment > folder assignment > space assignment >
 *   template assignment (via folder.client_space_template_id) >
 *   default group (is_default) > null
 */

export type StatusGroupEntityType = 'space' | 'folder' | 'list' | 'template';

export async function getGroupStatuses(groupId: string) {
  const { data, error } = await supabaseAdmin
    .from('status_group_statuses')
    .select('*')
    .eq('group_id', groupId)
    .order('position', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((s: any) => ({
    ...s,
    is_system: isSystemStatus(s),
  }));
}

/** Fetch an enabled group by key with ordered statuses (null when missing/disabled). */
export async function getGroupByKey(key: string) {
  const { data: group } = await supabaseAdmin
    .from('status_groups')
    .select('*')
    .eq('key', key)
    .eq('is_enabled', true)
    .maybeSingle();
  if (!group) return null;
  return {
    ...(group as any),
    statuses: await getGroupStatuses((group as any).id),
  };
}

/**
 * Load the managed Task Workflow rows into the shared override registry so
 * server-side getTaskStatusDef / getTaskStatusCategory calls (board
 * grouping, completion checks) resolve admin-managed values. Static
 * catalog remains the fallback. Never throws — call sites degrade to the
 * static catalog when the table is missing or unreachable.
 */
export async function loadTaskStatusOverrides(): Promise<void> {
  try {
    const group = await getGroupByKey('task_workflow');
    const rows = group?.statuses || [];
    // Empty registry when the group is missing/disabled so every call
    // site falls back to the static catalog uniformly.
    registerTaskStatusDefs(
      [...rows]
        .sort((a: any, b: any) => a.position - b.position)
        .map((r: any) => statusGroupRowToTaskDef(r))
        .filter((d) => !!d.key),
    );
  } catch (e) {
    console.error('[statusGroups] task workflow override load failed:', e);
  }
}

/** Clone a group's statuses into a space's space_statuses (replaces existing). */
export async function syncSpaceToGroup(spaceId: string, groupId: string) {
  const statuses = await getGroupStatuses(groupId);
  const { error: delErr } = await supabaseAdmin
    .from('space_statuses')
    .delete()
    .eq('space_id', spaceId);
  if (delErr) throw new Error(delErr.message);

  if (statuses.length === 0) return [];

  const rows = statuses.map((s: any) => ({
    space_id: spaceId,
    name: s.name,
    color: s.color,
    position: s.position,
    is_default: s.is_default,
    category: s.category,
  }));
  const { data, error } = await supabaseAdmin
    .from('space_statuses')
    .insert(rows)
    .select('*');
  if (error) throw new Error(error.message);
  return (data || []) as any[];
}

export async function upsertAssignment(
  groupId: string,
  entityType: StatusGroupEntityType,
  entityId: string,
  createdBy?: string,
) {
  // One group per entity: remove any existing assignment for this entity first.
  await supabaseAdmin
    .from('status_group_assignments')
    .delete()
    .eq('entity_type', entityType)
    .eq('entity_id', entityId);

  const { data, error } = await supabaseAdmin
    .from('status_group_assignments')
    .insert({
      group_id: groupId,
      entity_type: entityType,
      entity_id: entityId,
      created_by: createdBy || null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Space-level apply takes effect on boards immediately.
  if (entityType === 'space') {
    await syncSpaceToGroup(entityId, groupId);
  }
  return data;
}

/** Apply a group and sync space boards when the target is (or owns) a space. */
export async function applyGroupToEntity(
  groupId: string,
  entityType: StatusGroupEntityType,
  entityId: string,
  createdBy?: string,
) {
  const assignment = await upsertAssignment(groupId, entityType, entityId, createdBy);
  return assignment;
}

export async function getAssignmentFor(
  entityType: StatusGroupEntityType,
  entityId: string,
) {
  const { data } = await supabaseAdmin
    .from('status_group_assignments')
    .select('*, status_groups(*)')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle();
  return data as any;
}

export async function syncAllSpacesForGroup(groupId: string) {
  const { data: assignments } = await supabaseAdmin
    .from('status_group_assignments')
    .select('entity_id')
    .eq('group_id', groupId)
    .eq('entity_type', 'space');
  if (!assignments || assignments.length === 0) return;
  for (const a of assignments) {
    try {
      await syncSpaceToGroup(a.entity_id, groupId);
    } catch (e) {
      console.error(`[statusGroups] Failed to sync space ${a.entity_id} to group ${groupId}:`, e);
    }
  }
}

/**
 * Resolve the effective group for a task container.
 * Pass whichever ids are known; nearest assignment wins.
 */
export async function resolveEffectiveGroup(opts: {
  spaceId?: string;
  folderId?: string | null;
  listId?: string | null;
}): Promise<{ assignment: any; statuses: any[] } | null> {
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
    if (a && a.status_groups?.is_enabled !== false) return { assignment: a, statuses: await getGroupStatuses(a.group_id) };
  }
  // 2. folder-level
  const fid = resolvedFolderId || folder?.id;
  if (fid) {
    const a = await getAssignmentFor('folder', fid);
    if (a && a.status_groups?.is_enabled !== false) return { assignment: a, statuses: await getGroupStatuses(a.group_id) };
  }
  // 3. space-level
  if (finalSpaceId) {
    const a = await getAssignmentFor('space', finalSpaceId);
    if (a && a.status_groups?.is_enabled !== false) return { assignment: a, statuses: await getGroupStatuses(a.group_id) };
  }
  // 4. template-level (future design/editor spaces inherit from here)
  const tplId = folder?.client_space_template_id || null;
  if (tplId) {
    const a = await getAssignmentFor('template', tplId);
    if (a && a.status_groups?.is_enabled !== false) return { assignment: a, statuses: await getGroupStatuses(a.group_id) };
  } else if (fid) {
    // Folder row may not have been fetched with template above (list path);
    // already covered. Skip extra query.
  }
  // 5. default group fallback
  const { data: def } = await supabaseAdmin
    .from('status_groups')
    .select('*')
    .eq('is_default', true)
    .limit(1)
    .maybeSingle();
  if (def) {
    return {
      assignment: { group_id: (def as any).id, status_groups: def, is_default_fallback: true },
      statuses: await getGroupStatuses((def as any).id),
    };
  }
  return null;
}

/** True when a space still carries the untouched 3-row seed (safe to auto-sync). */
export async function spaceHasSeedStatuses(spaceId: string) {
  const { data } = await supabaseAdmin
    .from('space_statuses')
    .select('name')
    .eq('space_id', spaceId);
  if (!data) return true;
  const names = new Set(data.map((r: any) => r.name));
  return (
    data.length === 3 &&
    names.has('To Do') &&
    names.has('In Progress') &&
    names.has('Done')
  );
}
