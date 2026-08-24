import { PARTNER_USER_TYPES } from '@squadhub/shared';
import { supabaseAdmin } from '../supabase';
import { isWorkspaceAdmin } from '../middleware/permissions';
import { getUserIdsByRoleId } from './roles';

export const SQUAD_MANAGER_ROLE_NAME = 'Squad Manager';

export const DM_DENIED =
  'You can only message people you share a space or channel with.';

const CLIENT_TYPES = new Set(['client', 'client_staff']);
const PARTNER_TYPES = new Set<string>(PARTNER_USER_TYPES);
const IN_CHUNK = 200;

export type DmSide = 'client' | 'partner' | 'internal';

export interface WorkSet {
  spaceIds: Set<string>;
  folderIds: Set<string>;
  listIds: Set<string>;
  channelIds: Set<string>;
}

export interface DmActor {
  id: string;
  userType: string;
  isWorkspaceAdmin: boolean;
  assignedSquadManagerIds: Set<string>;
  work: WorkSet;
  workspaceId: string;
}

export interface DmOther {
  id: string;
  userType: string;
  isSquadManager: boolean;
}

export function emptyWorkSet(): WorkSet {
  return {
    spaceIds: new Set(),
    folderIds: new Set(),
    listIds: new Set(),
    channelIds: new Set(),
  };
}

export function dmSide(userType: string | null | undefined): DmSide | null {
  if (userType && CLIENT_TYPES.has(userType)) return 'client';
  if (userType && PARTNER_TYPES.has(userType)) return 'partner';
  if (userType === 'internal') return 'internal';
  return null;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const id of small) {
    if (large.has(id)) return true;
  }
  return false;
}

export function sharesWork(a: WorkSet, b: WorkSet): boolean {
  return (
    intersects(a.spaceIds, b.spaceIds) ||
    intersects(a.folderIds, b.folderIds) ||
    intersects(a.listIds, b.listIds) ||
    intersects(a.channelIds, b.channelIds)
  );
}

/**
 * Who can start / continue a DM with whom.
 *
 * - Workspace admins can message anyone.
 * - Clients: Squad Managers assigned to them (or on shared work), plus other
 *   client / client-staff on shared work.
 * - Partners: Squad Managers on shared work, plus other partners on shared work.
 * - Internals: anyone on shared work.
 */
export function canDmPair(
  actor: Omit<DmActor, 'work' | 'workspaceId'>,
  other: DmOther,
  shared: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (actor.id === other.id) {
    return { ok: false, reason: 'Cannot DM yourself' };
  }
  if (actor.isWorkspaceAdmin) return { ok: true };

  const aSide = dmSide(actor.userType);
  const bSide = dmSide(other.userType);
  if (!aSide || !bSide) {
    return { ok: false, reason: DM_DENIED };
  }

  if (aSide === 'internal') {
    return shared ? { ok: true } : { ok: false, reason: DM_DENIED };
  }

  if (aSide === 'client') {
    if (other.isSquadManager && (shared || actor.assignedSquadManagerIds.has(other.id))) {
      return { ok: true };
    }
    if (bSide === 'client' && shared) return { ok: true };
    return { ok: false, reason: DM_DENIED };
  }

  if (aSide === 'partner') {
    if (other.isSquadManager && shared) return { ok: true };
    if (bSide === 'partner' && shared) return { ok: true };
    return { ok: false, reason: DM_DENIED };
  }

  return { ok: false, reason: DM_DENIED };
}

async function inChunks<T>(
  ids: string[],
  fn: (chunk: string[]) => Promise<T[] | null | undefined>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const rows = await fn(ids.slice(i, i + IN_CHUNK));
    if (rows?.length) out.push(...rows);
  }
  return out;
}

export async function squadManagerRoleId(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('roles')
    .select('id')
    .eq('name', SQUAD_MANAGER_ROLE_NAME)
    .maybeSingle();
  return data?.id ?? null;
}

async function loadSquadManagerUserIds(roleId: string | null): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!roleId) return ids;
  for (const id of await getUserIdsByRoleId(roleId)) ids.add(id);
  const { data: grants } = await supabaseAdmin
    .from('client_user_access')
    .select('user_id')
    .eq('role_id', roleId);
  for (const row of grants || []) {
    if (row.user_id) ids.add(row.user_id as string);
  }
  return ids;
}

async function assignedSquadManagerIds(userId: string, roleId: string | null): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!roleId) return ids;

  const { data: mine } = await supabaseAdmin
    .from('client_user_access')
    .select('client_id')
    .eq('user_id', userId);
  const clientIds = [...new Set((mine || []).map((r: any) => r.client_id).filter(Boolean))];
  if (clientIds.length === 0) return ids;

  const { data: managers } = await supabaseAdmin
    .from('client_user_access')
    .select('user_id')
    .eq('role_id', roleId)
    .in('client_id', clientIds)
    .neq('user_id', userId);
  for (const row of managers || []) {
    if (row.user_id) ids.add(row.user_id as string);
  }
  return ids;
}

export async function loadWorkSet(userId: string, workspaceId: string): Promise<WorkSet> {
  const work = emptyWorkSet();

  const { data: memberships } = await supabaseAdmin
    .from('resource_memberships')
    .select('resource_type, resource_id')
    .eq('user_id', userId);

  const byType: Record<string, string[]> = { space: [], folder: [], list: [], channel: [] };
  for (const row of memberships || []) {
    const t = row.resource_type as string;
    if (byType[t]) byType[t].push(row.resource_id as string);
  }

  const { data: wsSpaces } = await supabaseAdmin
    .from('spaces')
    .select('id')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null);
  const wsSpaceIds = new Set((wsSpaces || []).map((s: any) => s.id as string));

  for (const id of byType.space) {
    if (wsSpaceIds.has(id)) work.spaceIds.add(id);
  }

  const folders = await inChunks(byType.folder, async (chunk) => {
    const { data } = await supabaseAdmin
      .from('folders')
      .select('id, space_id')
      .is('deleted_at', null)
      .in('id', chunk);
    return data || [];
  });
  for (const f of folders) {
    if (!f.space_id || !wsSpaceIds.has(f.space_id as string)) continue;
    work.folderIds.add(f.id);
    work.spaceIds.add(f.space_id as string);
  }

  const lists = await inChunks(byType.list, async (chunk) => {
    const { data } = await supabaseAdmin
      .from('lists')
      .select('id, space_id, folder_id')
      .is('deleted_at', null)
      .in('id', chunk);
    return data || [];
  });
  for (const l of lists) {
    if (!l.space_id || !wsSpaceIds.has(l.space_id as string)) continue;
    work.listIds.add(l.id);
    if (l.folder_id) work.folderIds.add(l.folder_id as string);
    work.spaceIds.add(l.space_id as string);
  }

  const channels = await inChunks(byType.channel, async (chunk) => {
    const { data } = await supabaseAdmin
      .from('channels')
      .select('id, linked_resource_type, linked_resource_id')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .in('id', chunk);
    return data || [];
  });

  const linkedFolders: string[] = [];
  const linkedLists: string[] = [];
  for (const c of channels) {
    work.channelIds.add(c.id);
    const lt = c.linked_resource_type as string | null;
    const lid = c.linked_resource_id as string | null;
    if (!lt || !lid) continue;
    if (lt === 'space') work.spaceIds.add(lid);
    else if (lt === 'folder') linkedFolders.push(lid);
    else if (lt === 'list') linkedLists.push(lid);
  }

  if (linkedFolders.length) {
    const { data } = await supabaseAdmin
      .from('folders')
      .select('id, space_id')
      .is('deleted_at', null)
      .in('id', linkedFolders);
    for (const f of data || []) {
      if (!f.space_id || !wsSpaceIds.has(f.space_id as string)) continue;
      work.folderIds.add(f.id);
      work.spaceIds.add(f.space_id as string);
    }
  }
  if (linkedLists.length) {
    const { data } = await supabaseAdmin
      .from('lists')
      .select('id, space_id, folder_id')
      .is('deleted_at', null)
      .in('id', linkedLists);
    for (const l of data || []) {
      if (!l.space_id || !wsSpaceIds.has(l.space_id as string)) continue;
      work.listIds.add(l.id);
      if (l.folder_id) work.folderIds.add(l.folder_id as string);
      work.spaceIds.add(l.space_id as string);
    }
  }

  return work;
}

export async function loadDmActor(userId: string, workspaceId: string): Promise<DmActor | null> {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id, user_type, status')
    .eq('id', userId)
    .maybeSingle();
  if (!user || user.status !== 'active') return null;

  const roleId = await squadManagerRoleId();
  const [admin, assigned, work] = await Promise.all([
    isWorkspaceAdmin(userId),
    assignedSquadManagerIds(userId, roleId),
    loadWorkSet(userId, workspaceId),
  ]);

  return {
    id: userId,
    userType: user.user_type as string,
    isWorkspaceAdmin: admin,
    assignedSquadManagerIds: assigned,
    work,
    workspaceId,
  };
}

export async function canActorDm(
  actor: DmActor,
  otherUserId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (actor.id === otherUserId) return { ok: false, reason: 'Cannot DM yourself' };

  const { data: other } = await supabaseAdmin
    .from('users')
    .select('id, user_type, status')
    .eq('id', otherUserId)
    .maybeSingle();
  if (!other || other.status !== 'active') {
    return { ok: false, reason: "That person isn't available." };
  }

  const roleId = await squadManagerRoleId();
  const managers = await loadSquadManagerUserIds(roleId);
  const otherWork = actor.isWorkspaceAdmin
    ? emptyWorkSet()
    : await loadWorkSet(otherUserId, actor.workspaceId);

  return canDmPair(
    actor,
    {
      id: other.id,
      userType: other.user_type as string,
      isSquadManager: managers.has(other.id),
    },
    actor.isWorkspaceAdmin ? true : sharesWork(actor.work, otherWork),
  );
}

async function usersOnResources(
  resourceType: string,
  resourceIds: string[],
): Promise<string[]> {
  const rows = await inChunks(resourceIds, async (chunk) => {
    const { data } = await supabaseAdmin
      .from('resource_memberships')
      .select('user_id')
      .eq('resource_type', resourceType)
      .in('resource_id', chunk);
    return data || [];
  });
  return rows.map((r: any) => r.user_id as string).filter(Boolean);
}

async function overlappingUserIds(actor: DmActor): Promise<Set<string>> {
  const ids = new Set<string>();
  const add = (userIds: string[]) => {
    for (const id of userIds) {
      if (id !== actor.id) ids.add(id);
    }
  };

  const spaceIds = [...actor.work.spaceIds];
  const folderIds = new Set(actor.work.folderIds);
  const listIds = new Set(actor.work.listIds);
  const channelIds = new Set(actor.work.channelIds);

  if (spaceIds.length) {
    add(await usersOnResources('space', spaceIds));
    const { data: folders } = await supabaseAdmin
      .from('folders')
      .select('id')
      .is('deleted_at', null)
      .in('space_id', spaceIds);
    for (const f of folders || []) folderIds.add(f.id);
  }

  if (folderIds.size) {
    add(await usersOnResources('folder', [...folderIds]));
    const { data: lists } = await supabaseAdmin
      .from('lists')
      .select('id')
      .is('deleted_at', null)
      .in('folder_id', [...folderIds]);
    for (const l of lists || []) listIds.add(l.id);
  }

  if (spaceIds.length) {
    const { data: lists } = await supabaseAdmin
      .from('lists')
      .select('id')
      .is('deleted_at', null)
      .in('space_id', spaceIds);
    for (const l of lists || []) listIds.add(l.id);
  }

  if (listIds.size) {
    add(await usersOnResources('list', [...listIds]));
  }

  const linkedChannelIds: string[] = [];
  const pullLinked = async (type: string, resourceIds: string[]) => {
    const rows = await inChunks(resourceIds, async (chunk) => {
      const { data } = await supabaseAdmin
        .from('channels')
        .select('id')
        .eq('workspace_id', actor.workspaceId)
        .is('deleted_at', null)
        .eq('linked_resource_type', type)
        .in('linked_resource_id', chunk);
      return data || [];
    });
    for (const c of rows) linkedChannelIds.push(c.id);
  };
  if (spaceIds.length) await pullLinked('space', spaceIds);
  if (folderIds.size) await pullLinked('folder', [...folderIds]);
  if (listIds.size) await pullLinked('list', [...listIds]);
  for (const id of linkedChannelIds) channelIds.add(id);

  if (channelIds.size) {
    add(await usersOnResources('channel', [...channelIds]));
  }

  return ids;
}

export interface DmContact {
  id: string;
  display_name: string;
  avatar_url: string | null;
  user_type: string;
  role: { name: string; color: string | null } | null;
}

async function attachRoles(users: DmContact[], workspaceId: string): Promise<void> {
  if (users.length === 0) return;
  const { data: members } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id, role:role_id(name, color)')
    .eq('workspace_id', workspaceId)
    .in('user_id', users.map((u) => u.id));
  const roleByUser = new Map<string, { name: string; color: string | null } | null>();
  for (const m of (members || []) as any[]) {
    if (!roleByUser.has(m.user_id)) roleByUser.set(m.user_id, m.role || null);
  }
  for (const u of users) {
    u.role = roleByUser.get(u.id) || null;
  }
}

export async function listDmContacts(
  userId: string,
  workspaceId: string,
  q: string,
  limit: number,
): Promise<DmContact[]> {
  const actor = await loadDmActor(userId, workspaceId);
  if (!actor) return [];

  let allowedIds: string[] | null = null;
  if (!actor.isWorkspaceAdmin) {
    const overlap = await overlappingUserIds(actor);
    const candidateIds = new Set(overlap);
    for (const id of actor.assignedSquadManagerIds) candidateIds.add(id);

    const roleId = await squadManagerRoleId();
    const managers = await loadSquadManagerUserIds(roleId);

    const people = await inChunks([...candidateIds], async (chunk) => {
      const { data } = await supabaseAdmin
        .from('users')
        .select('id, user_type, status')
        .in('id', chunk)
        .eq('status', 'active');
      return data || [];
    });

    allowedIds = [];
    for (const p of people) {
      if (p.id === actor.id) continue;
      const verdict = canDmPair(
        actor,
        {
          id: p.id,
          userType: p.user_type as string,
          isSquadManager: managers.has(p.id),
        },
        overlap.has(p.id),
      );
      if (verdict.ok) allowedIds.push(p.id);
    }

    if (allowedIds.length === 0) return [];
  }

  let query = supabaseAdmin
    .from('users')
    .select('id, display_name, avatar_url, user_type')
    .eq('status', 'active')
    .neq('id', userId)
    .order('display_name', { ascending: true })
    .limit(limit);

  if (allowedIds) {
    query = query.in('id', allowedIds);
  } else {
    const { data: members } = await supabaseAdmin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId);
    const memberIds = [...new Set((members || []).map((m: any) => m.user_id).filter(Boolean))];
    if (memberIds.length === 0) return [];
    query = query.in('id', memberIds);
  }

  if (q) query = query.ilike('display_name', `%${q}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const users = (data || []) as DmContact[];
  await attachRoles(users, workspaceId);
  return users;
}

export async function isDmParticipant(userId: string, conversationId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('dm_participants')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

export async function otherDmParticipantIds(
  conversationId: string,
  userId: string,
): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('dm_participants')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .neq('user_id', userId);
  return (data || []).map((r: any) => r.user_id as string).filter(Boolean);
}
