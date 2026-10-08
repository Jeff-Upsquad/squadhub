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

export function slugify(s: string): string {
  return (s || 'status').toLowerCase()
    .replace(/[^a-z0-9_\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/^[^a-z]+/, '') || 'status';
}

/** Resolve live inheritance, preserving source ids for read-only admin rows, applying replacements and toggle states. */
export function composeGroupStatuses(
  group: any,
  local: any[],
  inherited: any[] = [],
  options?: { includeDisabled?: boolean },
) {
  const disabledKeys: string[] = Array.isArray(group?.disabled_status_keys)
    ? group.disabled_status_keys
    : [];
  const replacements: Record<string, any> =
    group?.status_replacements && typeof group.status_replacements === 'object'
      ? group.status_replacements
      : {};

  const base = inherited.map((s: any) => {
    const lookupKey = s.key || s.id;
    const replacement =
      (s.key && replacements[s.key]) ||
      (s.id && replacements[s.id]) ||
      replacements[lookupKey];

    if (replacement) {
      const repKey = replacement.key || slugify(replacement.name);
      const isDisabled = disabledKeys.includes(repKey);

      return {
        ...s,
        id: replacement.id || `rep_${group?.id || 'grp'}_${s.key || s.id}`,
        group_id: group?.id || s.group_id,
        name: replacement.name,
        key: repKey,
        color: replacement.color || s.color,
        category: replacement.category || s.category,
        section: replacement.section !== undefined ? replacement.section : s.section,
        section_label: replacement.section_label !== undefined ? replacement.section_label : s.section_label,
        section_emoji: replacement.section_emoji !== undefined ? replacement.section_emoji : s.section_emoji,
        description: replacement.description !== undefined ? replacement.description : s.description,
        is_inherited: true,
        is_system: false,
        is_replacement: true,
        replaces_key: s.key,
        replaces_name: s.name,
        replaces_id: s.id,
        original_status: s,
        is_disabled: isDisabled,
      };
    }

    const keysToCheck = [s.key, s.id, lookupKey].filter(Boolean);
    const isDisabled = disabledKeys.some((k) => keysToCheck.includes(k));

    return {
      ...s,
      is_inherited: true,
      is_replacement: false,
      is_disabled: isDisabled,
    };
  });

  const localRows = local
    .filter((s: any) => !base.some((b: any) =>
      (b.key && b.key === s.key) || b.name.toLowerCase() === s.name.toLowerCase()))
    .map((s: any) => {
      const keysToCheck = [s.key, s.id].filter(Boolean);
      const isDisabled = disabledKeys.some((k) => keysToCheck.includes(k));
      return {
        ...s,
        is_inherited: false,
        is_system: group?.key === 'task_workflow' || isSystemStatus(s),
        // The primary group owns the initial status in linked workflows.
        is_default: group?.base_group_id ? false : s.is_default,
        is_replacement: false,
        is_disabled: isDisabled,
      };
    });

  const all = [...base, ...localRows].map((s, position) => ({ ...s, position }));

  if (options?.includeDisabled) {
    return all;
  }

  return all.filter((s) => !s.is_disabled).map((s, position) => ({ ...s, position }));
}

export async function getGroupStatuses(
  groupId: string,
  visited = new Set<string>(),
  options?: { includeDisabled?: boolean },
): Promise<any[]> {
  if (visited.has(groupId)) throw new Error('Circular status group inheritance');
  visited.add(groupId);
  const { data: group, error: groupError } = await supabaseAdmin
    .from('status_groups').select('*').eq('id', groupId).maybeSingle();
  if (groupError) throw new Error(groupError.message);
  if (!group) return [];
  const { data, error } = await supabaseAdmin
    .from('status_group_statuses').select('*').eq('group_id', groupId)
    .order('position', { ascending: true });
  if (error) throw new Error(error.message);
  const inherited = group.base_group_id ? await getGroupStatuses(group.base_group_id, visited, { includeDisabled: false }) : [];
  const sections = await getGroupSections(group);
  return composeGroupStatuses(group, data || [], inherited, options).map((s: any) => {
    const section = sections.find((sec: any) => sec.key === s.section);
    return section ? { ...s, section_label: section.label, section_emoji: section.emoji } : s;
  });
}

export async function getGroupSections(group: any) {
  const { data: base, error } = group.base_group_id
    ? await supabaseAdmin.from('status_groups').select('custom_sections').eq('id', group.base_group_id).maybeSingle()
    : { data: null, error: null };
  if (error) throw new Error(error.message);
  return [...(base?.custom_sections || []), ...(group.custom_sections || [])];
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
    effective_sections: await getGroupSections(group),
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
    const { data: groups } = await supabaseAdmin
      .from('status_groups')
      .select('id, key')
      .eq('is_enabled', true);
    const defs: any[] = [];
    for (const g of [...(groups || [])].sort((a: any, b: any) => Number(a.key === 'task_workflow') - Number(b.key === 'task_workflow'))) {
      const statuses = await getGroupStatuses(g.id);
      defs.push(
        ...statuses
          .sort((a: any, b: any) => a.position - b.position)
          .map((r: any) => statusGroupRowToTaskDef(r))
          .filter((d: any) => !!d.key),
      );
    }
    registerTaskStatusDefs(defs);
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
  const { data: children, error: childError } = await supabaseAdmin
    .from('status_groups').select('id').eq('base_group_id', groupId);
  if (childError) throw new Error(childError.message);
  const { data: assignments, error } = await supabaseAdmin
    .from('status_group_assignments')
    .select('entity_id, group_id')
    .in('group_id', [groupId, ...(children || []).map((g: any) => g.id)])
    .eq('entity_type', 'space');
  if (error) throw new Error(error.message);
  if (!assignments || assignments.length === 0) return;
  for (const a of assignments) {
    try {
      await syncSpaceToGroup(a.entity_id, a.group_id);
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

// ---- Task status normalization -------------------------------------------
// Tasks store a free-form TEXT status, so 'OPEN' vs 'open' splits boards into
// two groups (groupByStatus keys on the raw string). This resolves the
// effective group for the target list (list > folder > space > template >
// default) plus the space's space_statuses, then maps any casing variant back
// to its canonical value:
//
//   - task_workflow-style rows: key is canonical ('open'); name ('OPEN') maps to it
//   - space_statuses rows: name is canonical ('In Progress')
//   - legacy categories: todo->open, active->in_progress, done/closed->closed
//
// Returns the canonical status to store, or null when the value matches
// nothing (caller should 400).

const LEGACY_STATUS_ALIASES: Record<string, string> = {
  todo: 'open',
  active: 'in_progress',
  done: 'closed',
};

export async function normalizeTaskStatusForList(
  listId: string | null | undefined,
  raw: string | null | undefined,
): Promise<string | null> {
  if (!raw) return null;
  const input = raw.trim();
  if (!input) return null;
  const lower = input.toLowerCase();

  // Legacy shorthands first — always safe.
  if (LEGACY_STATUS_ALIASES[lower]) return LEGACY_STATUS_ALIASES[lower];

  try {
    const effective = await resolveEffectiveGroup({ listId: listId || null });
    const rows: any[] = effective?.statuses || [];

    // 1. Exact key match (case-sensitive canonical).
    for (const s of rows) {
      if (s.key && s.key === input) return s.key;
    }
    // 2. Case-insensitive key or name match -> canonical key.
    for (const s of rows) {
      if (s.key && s.key.toLowerCase() === lower) return s.key;
      if (s.name && s.name.toLowerCase() === lower) return s.key || s.name;
    }

    // 3. Space-level custom statuses (tasks store the NAME here).
    let spaceId: string | null = null;
    if (listId) {
      const { data: list } = await supabaseAdmin
        .from('lists')
        .select('space_id')
        .eq('id', listId)
        .maybeSingle();
      spaceId = (list as any)?.space_id || null;
    }
    if (spaceId) {
      const { data: spaceRows } = await supabaseAdmin
        .from('space_statuses')
        .select('name')
        .eq('space_id', spaceId);
      for (const r of (spaceRows || []) as { name: string }[]) {
        if (r.name === input) return r.name;
      }
      for (const r of (spaceRows || []) as { name: string }[]) {
        if (r.name && r.name.toLowerCase() === lower) return r.name;
      }
    }

    // 4. Static catalog fallback (covers default-fallback + offline groups).
    const { TASK_STATUS_CATALOG } = await import('@squadhub/shared');
    for (const d of TASK_STATUS_CATALOG as { key: string; label: string }[]) {
      if (d.key === input) return d.key;
      if (d.key.toLowerCase() === lower) return d.key;
      if ((d.label || '').toLowerCase() === lower) return d.key;
    }
  } catch (e) {
    console.error('[statusGroups] normalizeTaskStatusForList failed:', e);
  }

  // Unknown status — let the caller decide (400 with allowed list).
  // As a last resort, if it looks like an all-caps key variant, lowercase it
  // so 'OPEN' can never create a second bucket again.
  if (/^[A-Z0-9_ ]+$/.test(input) && input.length <= 40) {
    return lower.replace(/\s+/g, '_');
  }
  return null;
}

/** Default status for a list: the effective group's is_default row, else 'open'. */
export async function defaultTaskStatusForList(listId: string | null | undefined): Promise<string> {
  try {
    const effective = await resolveEffectiveGroup({ listId: listId || null });
    const rows: any[] = effective?.statuses || [];
    const def = rows.find((s) => s.is_default && s.key) || rows.find((s) => s.key);
    if (def?.key) return def.key;
  } catch (e) {
    console.error('[statusGroups] defaultTaskStatusForList failed:', e);
  }
  return 'open';
}
