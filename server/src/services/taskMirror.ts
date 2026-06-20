import { supabaseAdmin } from '../supabase';

// Mirrors the Home "disappearing card" sources — Courses (lms_assignments) and
// Meetings (meetings) — into real `tasks` rows so they behave like any other
// task (Home lists, counts, My Tasks) instead of living behind a separate chip.
//
// Each mirror task lives in the owning user's personal space DEFAULT list (the
// same space/list MyTasksView renders), is assigned to that user, and links back
// to its source via (source_kind, source_id, source_user_id). A meeting fans out
// to one task per participant. Completion is TASK-ONLY: we never write status
// back to the meeting/course, and re-syncing an existing mirror NEVER touches its
// status (so a user's "done" sticks and isn't resurrected).
//
// Routines are NOT handled here — they're already real tasks; their "Routine"
// type is a display-only label (see TaskRow / TaskDetailPanel), which avoids
// breaking the catalog-vs-space status coupling on existing recurring instances.

const PERSONAL_SPACE_NAME = 'Personal';
const PERSONAL_DEFAULT_LIST = 'Tasks';

type MirrorKind = 'course' | 'meeting';

// ---- caches (task types + per-space open status rarely change) --------------
let typeIdCache: Record<string, string> | null = null;
const openStatusCache = new Map<string, string>();

async function getTypeId(key: string): Promise<string | null> {
  if (!typeIdCache) {
    const { data } = await supabaseAdmin.from('task_types').select('id, key');
    typeIdCache = {};
    for (const t of data || []) typeIdCache[(t as any).key] = (t as any).id;
  }
  return typeIdCache[key] ?? null;
}

// First non-done status of a space (personal spaces seed "To Do"/"In Progress"/
// "Done"). Custom-type tasks store a space_status NAME, so a mirror task must use
// a real one to render + be completable.
async function getOpenStatusName(spaceId: string): Promise<string> {
  const cached = openStatusCache.get(spaceId);
  if (cached) return cached;
  const { data } = await supabaseAdmin
    .from('space_statuses')
    .select('name, category, position')
    .eq('space_id', spaceId)
    .order('position');
  const list = (data || []) as Array<{ name: string; category: string }>;
  const open = list.find((s) => s.category !== 'done' && s.category !== 'closed');
  const name = open?.name || list[0]?.name || 'To Do';
  openStatusCache.set(spaceId, name);
  return name;
}

async function resolveWorkspaceId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .order('id')
    .limit(1)
    .maybeSingle();
  return (data as any)?.workspace_id ?? null;
}

// ---- personal space / list provisioning (shared with GET /pm/personal) ------

// Get-or-create the caller's private personal space. Mirrors the logic that used
// to live inline in GET /pm/personal (kept idempotent — repeat calls return the
// same space; the unique index resolves create races). Returns the space id.
export async function getOrCreatePersonalSpaceId(
  userId: string,
  workspaceId?: string,
): Promise<string | null> {
  const wsId = workspaceId || (await resolveWorkspaceId(userId));
  if (!wsId) return null;

  const findSpace = () =>
    supabaseAdmin
      .from('spaces')
      .select('id')
      .eq('workspace_id', wsId)
      .eq('created_by', userId)
      .eq('kind', 'personal')
      .is('deleted_at', null)
      .order('position')
      .order('id')
      .limit(1);

  const { data: found } = await findSpace();
  if (found?.[0]) return (found[0] as any).id;

  const { count } = await supabaseAdmin
    .from('spaces')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', wsId);

  const { data: inserted, error } = await supabaseAdmin
    .from('spaces')
    .insert({
      workspace_id: wsId,
      name: PERSONAL_SPACE_NAME,
      color: '#6366f1',
      icon: 'user',
      kind: 'personal',
      is_private: true,
      created_by: userId,
      position: count || 0,
    })
    .select('id')
    .single();

  if (error || !inserted) {
    // A concurrent request may have created it first — re-select the winner.
    const { data: retry } = await findSpace();
    if (retry?.[0]) return (retry[0] as any).id;
    console.error('[taskMirror] personal space create failed:', error?.message);
    return null;
  }

  const spaceId = (inserted as any).id;
  await supabaseAdmin.from('resource_memberships').insert({
    resource_type: 'space',
    resource_id: spaceId,
    user_id: userId,
    access_level: 'manager',
  });
  return spaceId;
}

// Get-or-create the personal space's default list (first by position, else a
// 'Tasks' list at position 0). This is the list MyTasksView renders, so mirror
// tasks placed here show up in My Tasks as well as Home.
export async function getOrCreatePersonalDefaultListId(
  spaceId: string,
  userId: string,
): Promise<string | null> {
  const { data: existing } = await supabaseAdmin
    .from('lists')
    .select('id')
    .eq('space_id', spaceId)
    .is('deleted_at', null)
    .order('position')
    .limit(1)
    .maybeSingle();
  if (existing) return (existing as any).id;

  const { data: inserted, error } = await supabaseAdmin
    .from('lists')
    .insert({
      space_id: spaceId,
      folder_id: null,
      name: PERSONAL_DEFAULT_LIST,
      is_private: true,
      created_by: userId,
      position: 0,
    })
    .select('id')
    .single();

  if (error || !inserted) {
    const { data: retry } = await supabaseAdmin
      .from('lists')
      .select('id')
      .eq('space_id', spaceId)
      .is('deleted_at', null)
      .order('position')
      .limit(1)
      .maybeSingle();
    if (retry) return (retry as any).id;
    console.error('[taskMirror] personal list create failed:', error?.message);
    return null;
  }

  const listId = (inserted as any).id;
  await supabaseAdmin.from('resource_memberships').insert({
    resource_type: 'list',
    resource_id: listId,
    user_id: userId,
    access_level: 'manager',
  });
  return listId;
}

// Resolve the (list, status) a mirror task for this user should be created in.
async function personalTarget(
  userId: string,
): Promise<{ listId: string; status: string } | null> {
  const spaceId = await getOrCreatePersonalSpaceId(userId);
  if (!spaceId) return null;
  const listId = await getOrCreatePersonalDefaultListId(spaceId, userId);
  if (!listId) return null;
  const status = await getOpenStatusName(spaceId);
  return { listId, status };
}

// ---- core upsert ------------------------------------------------------------

async function upsertMirrorTask(opts: {
  kind: MirrorKind;
  sourceId: string;
  userId: string;
  title: string;
  dueDate: string | null;
}): Promise<void> {
  const { kind, sourceId, userId, title, dueDate } = opts;

  const { data: existing } = await supabaseAdmin
    .from('tasks')
    .select('id, title, due_date')
    .eq('source_kind', kind)
    .eq('source_id', sourceId)
    .eq('source_user_id', userId)
    .maybeSingle();

  if (existing) {
    // Only refresh presentation fields. NEVER touch status — a user who ticked
    // the mirror task off should keep it done (Task-only completion).
    const patch: Record<string, any> = {};
    if ((existing as any).title !== title) patch.title = title;
    if (((existing as any).due_date ?? null) !== (dueDate ?? null)) patch.due_date = dueDate;
    if (Object.keys(patch).length) {
      await supabaseAdmin.from('tasks').update(patch).eq('id', (existing as any).id);
    }
    return;
  }

  const target = await personalTarget(userId);
  if (!target) return;
  const typeId = await getTypeId(kind);

  const { error } = await supabaseAdmin.from('tasks').insert({
    list_id: target.listId,
    title,
    status: target.status,
    priority: 'none',
    due_date: dueDate,
    assignee_ids: [userId],
    created_by: userId,
    task_type_id: typeId,
    source_kind: kind,
    source_id: sourceId,
    source_user_id: userId,
  });
  // 23505 = another worker created the same mirror first; harmless.
  if (error && (error as any).code !== '23505') {
    console.error(`[taskMirror] insert ${kind} task failed:`, error.message);
  }
}

async function deleteMirrorsForSource(kind: MirrorKind, sourceId: string): Promise<void> {
  await supabaseAdmin.from('tasks').delete().eq('source_kind', kind).eq('source_id', sourceId);
}

// Remove mirror tasks of `kind` for a source whose owner set no longer applies.
async function pruneSourceOwners(
  kind: MirrorKind,
  sourceId: string,
  keepUserIds: string[],
): Promise<void> {
  const keep = new Set(keepUserIds);
  const { data: rows } = await supabaseAdmin
    .from('tasks')
    .select('id, source_user_id')
    .eq('source_kind', kind)
    .eq('source_id', sourceId);
  const stale = (rows || [])
    .filter((r: any) => !keep.has(r.source_user_id))
    .map((r: any) => r.id);
  if (stale.length) await supabaseAdmin.from('tasks').delete().in('id', stale);
}

// ---- per-entity sync --------------------------------------------------------

export async function mirrorMeeting(meetingId: string): Promise<void> {
  const { data: meeting } = await supabaseAdmin
    .from('meetings')
    .select('id, title, scheduled_at, status, attendee_ids, created_by')
    .eq('id', meetingId)
    .maybeSingle();

  // Gone or no longer scheduled (done/cancelled) → drop all its mirror tasks.
  if (!meeting || (meeting as any).status !== 'scheduled') {
    await deleteMirrorsForSource('meeting', meetingId);
    return;
  }

  const participants = Array.from(
    new Set<string>(
      [(meeting as any).created_by, ...((meeting as any).attendee_ids || [])].filter(
        Boolean,
      ) as string[],
    ),
  );

  for (const uid of participants) {
    await upsertMirrorTask({
      kind: 'meeting',
      sourceId: meetingId,
      userId: uid,
      title: (meeting as any).title,
      dueDate: (meeting as any).scheduled_at,
    });
  }

  // Attendee removed since last sync → remove their now-orphaned mirror task.
  await pruneSourceOwners('meeting', meetingId, participants);
}

export async function mirrorCourseAssignment(assignmentId: string): Promise<void> {
  const { data: a } = await supabaseAdmin
    .from('lms_assignments')
    .select('id, user_id, status, due_date, item:lms_items(id, title, status)')
    .eq('id', assignmentId)
    .maybeSingle();

  const item = (a as any)?.item;
  const active =
    !!a &&
    (a as any).status !== 'completed' &&
    !!(a as any).due_date &&
    !!item &&
    item.status === 'published';

  if (!active) {
    await deleteMirrorsForSource('course', assignmentId);
    return;
  }

  await upsertMirrorTask({
    kind: 'course',
    sourceId: assignmentId,
    userId: (a as any).user_id,
    title: item.title,
    dueDate: (a as any).due_date,
  });
}

// Mirror every assignment for a course item (used after publish / resync).
export async function mirrorCourseItem(itemId: string): Promise<void> {
  const { data: assignments } = await supabaseAdmin
    .from('lms_assignments')
    .select('id')
    .eq('item_id', itemId);
  for (const a of assignments || []) await mirrorCourseAssignment((a as any).id);
}

// ---- full reconcile (boot backfill + drift correction) ----------------------

async function cleanupOrphans(kind: MirrorKind, validIds: string[]): Promise<number> {
  const valid = new Set(validIds);
  const { data: rows } = await supabaseAdmin
    .from('tasks')
    .select('id, source_id')
    .eq('source_kind', kind);
  const stale = (rows || [])
    .filter((r: any) => !valid.has(r.source_id))
    .map((r: any) => r.id);
  if (stale.length) await supabaseAdmin.from('tasks').delete().in('id', stale);
  return stale.length;
}

export async function reconcileAllMirrors(): Promise<{ meetings: number; courses: number }> {
  // Meetings: all currently scheduled.
  const { data: meetings } = await supabaseAdmin
    .from('meetings')
    .select('id')
    .eq('status', 'scheduled');
  const meetingIds = (meetings || []).map((m: any) => m.id);
  for (const id of meetingIds) await mirrorMeeting(id);
  await cleanupOrphans('meeting', meetingIds);

  // Courses: assigned, not completed, with a due date (item-published is checked
  // per-row inside mirrorCourseAssignment).
  const { data: assignments } = await supabaseAdmin
    .from('lms_assignments')
    .select('id')
    .neq('status', 'completed')
    .not('due_date', 'is', null);
  const assignmentIds = (assignments || []).map((a: any) => a.id);
  for (const id of assignmentIds) await mirrorCourseAssignment(id);
  await cleanupOrphans('course', assignmentIds);

  return { meetings: meetingIds.length, courses: assignmentIds.length };
}
