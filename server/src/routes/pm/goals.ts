import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  PARTNER_USER_TYPES,
  getTaskStatusCategory,
  goalProgress,
  effectiveGoalStatus,
  wouldCreateGoalCycle,
  type AccessLevel,
  type Goal,
  type GoalProject,
  type GoalSource,
  type GoalTask,
} from '@squadhub/shared';
import { supabaseAdmin as db } from '../../supabase';
import { requireAuth } from '../../middleware/auth';
import { requireUserType } from '../../middleware/userType';
import { logTaskActivity, type TaskActivityEvent } from '../../utils/taskActivity';
import { validateWorkRange } from '../../utils/taskWorkRange';

// Goals link existing workspace tasks (they never move them). Every read goes
// through loadGoals(), which resolves all visible goals — direct links,
// auto-included folders/lists, access and progress — in a fixed number of
// bulk queries, independent of how many goals or tasks there are.
const router = Router();
router.use(requireAuth);
// Mounted at /pm before personal tasks, checklists and attachments. Keep this
// gate scoped to our own paths so Goals cannot block those other routers.
router.use(['/goals', '/goal-projects', '/goals-containers'],
  requireUserType('internal', ...PARTNER_USER_TYPES, 'client', 'client_staff'));

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

const route = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    try {
      const data = await fn(req, res);
      if (!res.headersSent) res.json({ success: true, data: data ?? null });
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status
        : e instanceof z.ZodError ? 400
        : e?.code === '23505' ? 409
        : /cycle/i.test(e?.message || '') ? 400
        : 500;
      if (status === 500) console.error('[pm/goals]', e);
      res.status(status).json({
        success: false,
        error: e instanceof z.ZodError ? e.issues[0]?.message || 'Invalid request'
          : status === 400 && /cycle/i.test(e?.message || '') ? 'This connection would create a circular dependency'
          : status === 409 ? 'That already exists'
          : status === 500 ? 'Goals are temporarily unavailable'
          : e.message,
      });
    }
  };

// ── Query helpers ──────────────────────────────────────────────────────────

/** Read every row of a query, paging past PostgREST's row cap. */
async function rows<T = any>(query: any): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const r = await query.range(from, from + size - 1);
    if (r.error) throw r.error;
    out.push(...(r.data || []));
    if ((r.data || []).length < size) return out;
  }
}

/** `.in(column, ids)` in URL-safe chunks. `build` receives a fresh query each time. */
async function rowsIn<T = any>(ids: Iterable<string>, build: (chunk: string[]) => any): Promise<T[]> {
  const unique = [...new Set(ids)].filter(Boolean);
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += 150) out.push(...(await rows<T>(build(unique.slice(i, i + 150)))));
  return out;
}

async function one<T = any>(query: any): Promise<T | null> {
  const r = await query.maybeSingle();
  if (r.error) throw r.error;
  return r.data ?? null;
}

async function exec(query: any) {
  const r = await query;
  if (r.error) throw r.error;
  return r.data;
}

const TASK_COLS = 'id, title, status, priority, display_number, parent_task_id, list_id, assignee_ids, work_date, start_date, due_date, metadata, recurrence';

// ── Workspace tree + access ────────────────────────────────────────────────

interface ListRow { id: string; name: string; folder_id: string | null; space_id: string; created_by: string | null; is_locked: boolean | null; deleted_at: string | null }
interface FolderRow { id: string; name: string; parent_folder_id: string | null; space_id: string; created_by: string | null; is_locked: boolean | null; deleted_at: string | null }
interface SpaceRow { id: string; name: string; color: string | null; workspace_id: string; created_by: string | null; is_locked: boolean | null; deleted_at: string | null }

/** Lazily-loaded slice of the space → folder → list tree. */
class Tree {
  lists = new Map<string, ListRow>();
  folders = new Map<string, FolderRow>();
  spaces = new Map<string, SpaceRow>();

  async load({ lists = [], folders = [] }: { lists?: Iterable<string>; folders?: Iterable<string> }) {
    const listIds = [...lists].filter((id) => !this.lists.has(id));
    for (const l of await rowsIn<ListRow>(listIds, (c) => db.from('lists')
      .select('id, name, folder_id, space_id, created_by, is_locked, deleted_at').in('id', c).order('id'))) {
      this.lists.set(l.id, l);
    }
    // Walk folder parents until the chain is complete (usually 1–2 levels).
    let pending = new Set<string>([...folders, ...[...this.lists.values()].map((l) => l.folder_id!).filter(Boolean)]);
    while (pending.size) {
      const need = [...pending].filter((id) => !this.folders.has(id));
      pending = new Set();
      for (const f of await rowsIn<FolderRow>(need, (c) => db.from('folders')
        .select('id, name, parent_folder_id, space_id, created_by, is_locked, deleted_at').in('id', c).order('id'))) {
        this.folders.set(f.id, f);
        if (f.parent_folder_id && !this.folders.has(f.parent_folder_id)) pending.add(f.parent_folder_id);
      }
    }
    const spaceIds = [...this.lists.values(), ...this.folders.values()]
      .map((r) => r.space_id).filter((id) => id && !this.spaces.has(id));
    for (const s of await rowsIn<SpaceRow>(spaceIds, (c) => db.from('spaces')
      .select('id, name, color, workspace_id, created_by, is_locked, deleted_at').in('id', c).order('id'))) {
      this.spaces.set(s.id, s);
    }
  }

  /** Folder ancestry, nearest first. */
  folderChain(folderId: string | null): FolderRow[] {
    const chain: FolderRow[] = [];
    const seen = new Set<string>();
    for (let f = folderId ? this.folders.get(folderId) : undefined; f && !seen.has(f.id); f = f.parent_folder_id ? this.folders.get(f.parent_folder_id) : undefined) {
      seen.add(f.id);
      chain.push(f);
    }
    return chain;
  }

  /** A live list inside `workspaceId` (not deleted anywhere up the chain). */
  liveList(listId: string, workspaceId: string): ListRow | null {
    const l = this.lists.get(listId);
    const s = l && this.spaces.get(l.space_id);
    if (!l || l.deleted_at || !s || s.deleted_at || s.workspace_id !== workspaceId) return null;
    if (this.folderChain(l.folder_id).some((f) => f.deleted_at)) return null;
    return l;
  }

  locked(listId: string): boolean {
    const l = this.lists.get(listId);
    if (!l) return false;
    return !!(l.is_locked || this.folderChain(l.folder_id).some((f) => f.is_locked) || this.spaces.get(l.space_id)?.is_locked);
  }
}

/**
 * Resource access for several users at once, mirroring checkResourceAccess():
 * workspace admins get manager; otherwise creator or direct membership on the
 * list, then its folder, then the space.
 */
class Access {
  private roles = new Map<string, string>();
  private grants = new Map<string, AccessLevel>();
  private cache = new Map<string, AccessLevel | null>();

  constructor(private workspaceId: string, private tree: Tree) {}

  async load(userIds: Iterable<string>) {
    const users = [...new Set(userIds)].filter((u) => !this.roles.has(u));
    if (!users.length) return;
    const members = await rowsIn<{ user_id: string; role: string }>(users, (c) => db.from('workspace_members')
      .select('user_id, role').eq('workspace_id', this.workspaceId).in('user_id', c).order('user_id'));
    for (const u of users) this.roles.set(u, '');
    for (const m of members) this.roles.set(m.user_id, m.role || 'member');
    const needGrants = users.filter((u) => this.roles.get(u) && !this.isAdmin(u));
    const grants = await rowsIn<any>(needGrants, (c) => db.from('resource_memberships')
      .select('user_id, resource_type, resource_id, access_level').in('user_id', c).order('id'));
    for (const g of grants) this.grants.set(`${g.user_id}:${g.resource_type}:${g.resource_id}`, g.access_level);
  }

  isMember(user: string) { return !!this.roles.get(user); }
  isAdmin(user: string) { return ['admin', 'super_admin'].includes(this.roles.get(user) || ''); }

  level(user: string, type: 'list' | 'folder' | 'space', id: string): AccessLevel | null {
    const key = `${user}:${type}:${id}`;
    if (!this.cache.has(key)) this.cache.set(key, this.resolve(user, type, id));
    return this.cache.get(key)!;
  }

  canEdit(user: string, listId: string) {
    const level = this.level(user, 'list', listId);
    return level === 'member' || level === 'manager';
  }

  private resolve(user: string, type: 'list' | 'folder' | 'space', id: string): AccessLevel | null {
    if (!this.isMember(user)) return null;
    const t = this.tree;
    const row = type === 'list' ? t.lists.get(id) : type === 'folder' ? t.folders.get(id) : t.spaces.get(id);
    const space = row && t.spaces.get(type === 'space' ? id : (row as ListRow | FolderRow).space_id);
    if (!row || !space || space.workspace_id !== this.workspaceId) return null;
    if (this.isAdmin(user)) return 'manager';
    const grant = (rType: string, r: { id: string; created_by: string | null }): AccessLevel | null =>
      r.created_by === user ? 'manager' : this.grants.get(`${user}:${rType}:${r.id}`) ?? null;
    if (type === 'list') {
      const own = grant('list', row as ListRow);
      if (own) return own;
    }
    // Like checkResourceAccess: a list inherits from its own folder, a folder
    // from its space — parent folders don't cascade.
    const folder = type === 'folder' ? row as FolderRow : type === 'list' && (row as ListRow).folder_id ? t.folders.get((row as ListRow).folder_id!) : undefined;
    if (folder) {
      const level = grant('folder', folder);
      if (level) return level;
    }
    return grant('space', space);
  }
}

// ── Loading goals ──────────────────────────────────────────────────────────

const toDay = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null);

function canSeeGoal(g: any, user: string, access: Access, projects: Map<string, GoalProject>) {
  return access.isAdmin(user)
    || g.created_by === user
    || (g.assignee_ids || []).includes(user)
    || projects.get(g.project_id)?.created_by === user;
}

function hasDates(t: any) {
  return !!(t.work_date || t.start_date || t.due_date || t.metadata?.work_end_date);
}

interface Loaded {
  projects: GoalProject[];
  goals: Goal[];
  access: Access;
  tree: Tree;
}

/** Folder sources expand to every nested folder's lists. */
async function resolveSourceLists(sources: any[], tree: Tree): Promise<Map<string, Set<string>>> {
  const bySource = new Map<string, Set<string>>();
  const folderSources = sources.filter((s) => s.resource_type === 'folder');
  for (const s of sources.filter((s) => s.resource_type === 'list')) bySource.set(s.id, new Set([s.resource_id]));
  if (!folderSources.length) return bySource;

  await tree.load({ folders: folderSources.map((s) => s.resource_id) });
  const spaceIds = [...new Set(folderSources.map((s) => tree.folders.get(s.resource_id)?.space_id).filter(Boolean))] as string[];
  const allFolders = await rowsIn<FolderRow>(spaceIds, (c) => db.from('folders')
    .select('id, name, parent_folder_id, space_id, created_by, is_locked, deleted_at').in('space_id', c).is('deleted_at', null).order('id'));
  for (const f of allFolders) tree.folders.set(f.id, f);
  const children = new Map<string, string[]>();
  for (const f of allFolders) {
    if (!f.parent_folder_id) continue;
    children.set(f.parent_folder_id, [...(children.get(f.parent_folder_id) || []), f.id]);
  }
  const folderSets = new Map<string, Set<string>>();
  for (const s of folderSources) {
    const set = new Set<string>([s.resource_id]);
    const stack = [s.resource_id];
    while (stack.length) for (const c of children.get(stack.pop()!) || []) if (!set.has(c)) { set.add(c); stack.push(c); }
    folderSets.set(s.id, set);
  }
  const allFolderIds = new Set([...folderSets.values()].flatMap((s) => [...s]));
  const lists = await rowsIn<ListRow>(allFolderIds, (c) => db.from('lists')
    .select('id, name, folder_id, space_id, created_by, is_locked, deleted_at').in('folder_id', c).is('deleted_at', null).order('id'));
  for (const l of lists) tree.lists.set(l.id, l);
  for (const [sourceId, folders] of folderSets) {
    bySource.set(sourceId, new Set(lists.filter((l) => l.folder_id && folders.has(l.folder_id)).map((l) => l.id)));
  }
  return bySource;
}

async function loadGoals(workspaceId: string, viewer: string, onlyGoalId?: string): Promise<Loaded> {
  const tree = new Tree();
  const access = new Access(workspaceId, tree);
  await access.load([viewer]);
  if (!access.isMember(viewer)) fail(403, 'You do not have access to this workspace');

  const [projectRows, goalRows] = await Promise.all([
    rows<GoalProject>(db.from('goal_projects').select('id, workspace_id, name, color, created_by, created_at')
      .eq('workspace_id', workspaceId).order('created_at')),
    rows<any>((onlyGoalId
      ? db.from('goals').select('*').eq('workspace_id', workspaceId).eq('id', onlyGoalId)
      : db.from('goals').select('*').eq('workspace_id', workspaceId)).order('created_at', { ascending: false })),
  ]);
  const projects = new Map(projectRows.map((p) => [p.id, p]));
  const visible = goalRows.filter((g) => canSeeGoal(g, viewer, access, projects));
  const visibleProjects = projectRows.filter((p) => access.isAdmin(viewer) || p.created_by === viewer
    || visible.some((g) => g.project_id === p.id));
  if (!visible.length) return { projects: visibleProjects, goals: [], access, tree };

  const goalIds = visible.map((g) => g.id);
  const [links, sources, deps] = await Promise.all([
    rowsIn<any>(goalIds, (c) => db.from('goal_tasks').select('goal_id, task_id, scheduled, is_direct').in('goal_id', c).order('task_id')),
    rowsIn<any>(goalIds, (c) => db.from('goal_sources').select('id, goal_id, resource_type, resource_id').in('goal_id', c).order('id')),
    rowsIn<any>(goalIds, (c) => db.from('goal_dependencies').select('id, goal_id, from_task_id, to_task_id, from_endpoint, to_endpoint').in('goal_id', c).order('id')),
  ]);

  // Auto-included containers → their lists → their tasks (incl. secondary list memberships).
  const sourceLists = await resolveSourceLists(sources, tree);
  const allSourceListIds = new Set([...sourceLists.values()].flatMap((s) => [...s]));
  const [sourceTasks, secondary] = await Promise.all([
    rowsIn<any>(allSourceListIds, (c) => db.from('tasks').select(TASK_COLS).in('list_id', c).is('recurrence', null).order('id')),
    rowsIn<any>(allSourceListIds, (c) => db.from('task_list_links').select('task_id, list_id').in('list_id', c).order('id')),
  ]);
  const taskById = new Map<string, any>(sourceTasks.map((t) => [t.id, t]));
  const directIds = links.filter((l) => l.is_direct).map((l) => l.task_id);
  const missing = [...directIds, ...secondary.map((s) => s.task_id)].filter((id) => !taskById.has(id));
  for (const t of await rowsIn<any>(missing, (c) => db.from('tasks').select(TASK_COLS).in('id', c).order('id'))) {
    if (!t.recurrence) taskById.set(t.id, t);
  }
  // list id → task ids in it (primary list or a secondary list membership)
  const tasksByList = new Map<string, string[]>();
  const addToList = (listId: string, taskId: string) => tasksByList.set(listId, [...(tasksByList.get(listId) || []), taskId]);
  for (const t of sourceTasks) addToList(t.list_id, t.id);
  for (const s of secondary) addToList(s.list_id, s.task_id);

  await tree.load({ lists: [...taskById.values()].map((t) => t.list_id), folders: [] });
  await tree.load({ lists: sources.filter((s) => s.resource_type === 'list').map((s) => s.resource_id), folders: sources.filter((s) => s.resource_type === 'folder').map((s) => s.resource_id) });
  await access.load(visible.map((g) => g.created_by));

  const statusSpaceIds = [...new Set([...taskById.values()].map((t) => tree.lists.get(t.list_id)?.space_id).filter(Boolean))] as string[];
  const statuses = await rowsIn<any>(statusSpaceIds, (c) => db.from('space_statuses').select('space_id, name, category').in('space_id', c).order('id'));
  const categoryOf = new Map(statuses.map((s) => [`${s.space_id}::${s.name}`, s.category as string]));

  const sourceMeta = (s: any): GoalSource => {
    const isList = s.resource_type === 'list';
    const row = isList ? tree.lists.get(s.resource_id) : tree.folders.get(s.resource_id);
    const space = row ? tree.spaces.get(row.space_id) : undefined;
    const parentFolder = isList ? (row as ListRow | undefined)?.folder_id : (row as FolderRow | undefined)?.parent_folder_id;
    const path = [space?.name, parentFolder ? tree.folders.get(parentFolder)?.name : null].filter(Boolean).join(' / ');
    return { id: s.id, goal_id: s.goal_id, resource_type: s.resource_type, resource_id: s.resource_id, name: row?.name || 'Deleted container', path };
  };

  const goals: Goal[] = visible.map((g) => {
    const goalLinks = links.filter((l) => l.goal_id === g.id);
    const linkOf = new Map(goalLinks.map((l) => [l.task_id, l]));
    const goalSources = sources.filter((s) => s.goal_id === g.id);
    // task id → source ids that include it
    const included = new Map<string, string[]>();
    for (const l of goalLinks) if (l.is_direct) included.set(l.task_id, []);
    for (const s of goalSources) {
      const live = s.resource_type === 'list' ? tree.liveList(s.resource_id, workspaceId) : tree.folders.get(s.resource_id);
      if (!live || (live as any).deleted_at || !access.level(g.created_by, s.resource_type, s.resource_id)) continue;
      for (const listId of sourceLists.get(s.id) || []) {
        for (const id of tasksByList.get(listId) || []) included.set(id, [...(included.get(id) || []), s.id]);
      }
    }

    const counted: GoalTask[] = [];
    let hidden = 0;
    const visibleTasks: GoalTask[] = [];
    for (const [taskId, sourceIds] of included) {
      const t = taskById.get(taskId);
      if (!t) continue;
      const list = tree.liveList(t.list_id, workspaceId);
      // Progress is authoritative for the goal creator: only their accessible tasks count.
      if (!list || !access.level(g.created_by, 'list', list.id)) continue;
      const space = tree.spaces.get(list.space_id)!;
      const category = categoryOf.get(`${space.id}::${t.status}`) || getTaskStatusCategory(t.status) || String(t.status || '').toLowerCase();
      const link = linkOf.get(taskId);
      const task: GoalTask = {
        id: t.id,
        title: t.title,
        status: t.status,
        completed: category === 'done' || category === 'closed',
        priority: t.priority ?? null,
        display_number: t.display_number ?? null,
        parent_task_id: t.parent_task_id ?? null,
        list_id: list.id,
        list_name: list.name,
        folder_name: list.folder_id ? tree.folders.get(list.folder_id)?.name ?? null : null,
        space_id: space.id,
        space_name: space.name,
        space_color: space.color ?? null,
        assignee_ids: t.assignee_ids || [],
        work_date: t.work_date ?? null,
        work_end_date: t.metadata?.work_end_date ?? null,
        start_date: t.start_date ?? null,
        due_date: t.due_date ?? null,
        scheduled: link ? !!link.scheduled : hasDates(t),
        can_edit: false,
        direct: !!link?.is_direct,
        source_ids: [...new Set(sourceIds)],
      };
      counted.push(task);
      if (access.level(viewer, 'list', list.id)) {
        visibleTasks.push({ ...task, can_edit: access.canEdit(viewer, list.id) && !tree.locked(list.id) });
      } else {
        hidden++;
      }
    }
    const progress = goalProgress(counted);
    const ids = new Set(visibleTasks.map((t) => t.id));
    return {
      id: g.id,
      workspace_id: g.workspace_id,
      project_id: g.project_id,
      name: g.name,
      description: g.description || '',
      status: effectiveGoalStatus(g.status, progress.task_count, progress.completed_count),
      stored_status: g.status,
      priority: g.priority,
      assignee_ids: g.assignee_ids || [],
      labels: g.labels || [],
      work_start_date: toDay(g.work_start_date),
      work_end_date: toDay(g.work_end_date),
      start_date: toDay(g.start_date),
      due_date: toDay(g.due_date),
      created_by: g.created_by,
      created_at: g.created_at,
      updated_at: g.updated_at,
      tasks: visibleTasks,
      dependencies: deps.filter((d) => d.goal_id === g.id && ids.has(d.from_task_id) && ids.has(d.to_task_id)),
      sources: goalSources.map(sourceMeta),
      ...progress,
      hidden_task_count: hidden,
    };
  });

  return { projects: visibleProjects, goals, access, tree };
}

// ── Guards ─────────────────────────────────────────────────────────────────

async function goalFor(user: string, goalId: string) {
  const g = await one<any>(db.from('goals').select('id, workspace_id, project_id, created_by, assignee_ids, work_start_date, work_end_date, start_date, due_date').eq('id', uuid.parse(goalId)));
  if (!g) fail(404, 'Goal not found');
  const loaded = await loadGoals(g.workspace_id, user, g.id);
  const goal = loaded.goals[0];
  if (!goal) fail(403, 'You do not have access to this goal');
  return { ...loaded, goal, row: g };
}

async function projectFor(user: string, projectId: string, access?: Access) {
  const p = await one<GoalProject>(db.from('goal_projects').select('id, workspace_id, name, color, created_by, created_at').eq('id', uuid.parse(projectId)));
  if (!p) fail(404, 'Project not found');
  const acc = access || new Access(p!.workspace_id, new Tree());
  await acc.load([user]);
  if (!acc.isMember(user)) fail(403, 'You do not have access to this workspace');
  return { project: p!, access: acc };
}

/** Owner/admin can always add goals; others only to projects they already work in. */
async function assertCanUseProject(user: string, project: GoalProject, access: Access) {
  if (access.isAdmin(user) || project.created_by === user) return;
  const goals = await rows<any>(db.from('goals').select('id, created_by, assignee_ids').eq('project_id', project.id).order('id'));
  if (!goals.some((g) => g.created_by === user || (g.assignee_ids || []).includes(user))) {
    fail(403, 'You can only add goals to your own projects');
  }
}

async function assertMembers(ids: string[], workspaceId: string) {
  if (!ids.length) return;
  const members = await rowsIn<any>(ids, (c) => db.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).in('user_id', c).order('user_id'));
  if (new Set(members.map((m) => m.user_id)).size !== new Set(ids).size) fail(400, 'Assignees must be workspace members');
}

function assertRange(start: string | null | undefined, end: string | null | undefined, label: string) {
  if (start && end && Date.parse(end) < Date.parse(start)) fail(400, `${label} end must be on or after its start`);
}

// ── Schemas ────────────────────────────────────────────────────────────────

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid date')
  .refine((s) => {
    const date = new Date(`${s}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
  }, 'Choose a valid date');
/** Task dates accept a day or a full timestamp (timed work dates keep their time). */
const taskDate = z.string().refine((s) => Number.isFinite(Date.parse(s)), 'Choose a valid date').nullable();
const goalInput = z.object({
  project_id: uuid,
  name: z.string().trim().min(1, 'Give your goal a name').max(500),
  description: z.string().max(20000).default(''),
  status: z.enum(['planned', 'in_progress', 'on_hold']).default('planned'),
  priority: z.enum(['emergency', 'urgent', 'high', 'normal', 'low', 'none']).default('normal'),
  assignee_ids: z.array(uuid).max(50).default([]),
  labels: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  work_start_date: day.nullable().default(null),
  work_end_date: day.nullable().default(null),
  start_date: day.nullable().default(null),
  due_date: day.nullable().default(null),
});
const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'Choose a valid color');

// ── Routes ─────────────────────────────────────────────────────────────────

router.get('/goals', route(async (req) => {
  const { projects, goals } = await loadGoals(uuid.parse(req.query.workspace_id), req.userId!);
  return { projects, goals };
}));

// Folders and lists the viewer can open — choices for auto-including a container.
router.get('/goals-containers', route(async (req) => {
  const workspaceId = uuid.parse(req.query.workspace_id);
  const tree = new Tree();
  const access = new Access(workspaceId, tree);
  await access.load([req.userId!]);
  if (!access.isMember(req.userId!)) fail(403, 'You do not have access to this workspace');
  const spaces = await rows<SpaceRow>(db.from('spaces').select('id, name, color, workspace_id, created_by, is_locked, deleted_at')
    .eq('workspace_id', workspaceId).is('deleted_at', null).order('position'));
  for (const s of spaces) tree.spaces.set(s.id, s);
  const spaceIds = spaces.map((s) => s.id);
  const [folders, lists] = await Promise.all([
    rowsIn<FolderRow>(spaceIds, (c) => db.from('folders').select('id, name, parent_folder_id, space_id, created_by, is_locked, deleted_at').in('space_id', c).is('deleted_at', null).order('position')),
    rowsIn<ListRow>(spaceIds, (c) => db.from('lists').select('id, name, folder_id, space_id, created_by, is_locked, deleted_at').in('space_id', c).is('deleted_at', null).order('position')),
  ]);
  for (const f of folders) tree.folders.set(f.id, f);
  for (const l of lists) tree.lists.set(l.id, l);
  const spaceName = (id: string) => tree.spaces.get(id)?.name || '';
  return [
    ...folders.filter((f) => access.level(req.userId!, 'folder', f.id)).map((f) => ({
      type: 'folder' as const, id: f.id, name: f.name,
      path: [spaceName(f.space_id), f.parent_folder_id ? tree.folders.get(f.parent_folder_id)?.name : null].filter(Boolean).join(' / '),
    })),
    ...lists.filter((l) => tree.liveList(l.id, workspaceId) && access.level(req.userId!, 'list', l.id)).map((l) => ({
      type: 'list' as const, id: l.id, name: l.name,
      path: [spaceName(l.space_id), l.folder_id ? tree.folders.get(l.folder_id)?.name : null].filter(Boolean).join(' / '),
    })),
  ];
}));

// Standalone tabs load the goal's workspace before anything else.
router.get('/goals/:id/context', route(async (req) => {
  const { goal } = await goalFor(req.userId!, String(req.params.id));
  return one(db.from('workspaces').select('*').eq('id', goal.workspace_id));
}));

router.post('/goal-projects', route(async (req) => {
  const body = z.object({ workspace_id: uuid, name: z.string().trim().min(1, 'Name your project').max(160), color: color.default('#7c5cff') }).parse(req.body);
  const access = new Access(body.workspace_id, new Tree());
  await access.load([req.userId!]);
  if (!access.isMember(req.userId!)) fail(403, 'You do not have access to this workspace');
  return one(db.from('goal_projects').insert({ ...body, created_by: req.userId }).select('id, workspace_id, name, color, created_by, created_at'));
}));

router.patch('/goal-projects/:id', route(async (req) => {
  const { project, access } = await projectFor(req.userId!, String(req.params.id));
  if (project.created_by !== req.userId && !access.isAdmin(req.userId!)) fail(403, 'Only the project owner can change it');
  const body = z.object({ name: z.string().trim().min(1).max(160).optional(), color: color.optional() }).parse(req.body);
  return one(db.from('goal_projects').update({ ...body, updated_at: new Date().toISOString() }).eq('id', project.id).select('id, workspace_id, name, color, created_by, created_at'));
}));

router.delete('/goal-projects/:id', route(async (req) => {
  const { project, access } = await projectFor(req.userId!, String(req.params.id));
  if (project.created_by !== req.userId && !access.isAdmin(req.userId!)) fail(403, 'Only the project owner can delete it');
  await exec(db.from('goal_projects').delete().eq('id', project.id));
}));

router.post('/goals', route(async (req) => {
  const { task_ids = [], ...input } = goalInput.extend({ task_ids: z.array(uuid).max(50).optional() }).parse(req.body);
  const { project, access } = await projectFor(req.userId!, input.project_id);
  await assertCanUseProject(req.userId!, project, access);
  assertRange(input.work_start_date, input.work_end_date, 'Work');
  assertRange(input.start_date, input.due_date, 'Due date range');
  await assertMembers(input.assignee_ids, project.workspace_id);
  const goal = await one<any>(db.from('goals')
    .insert({ ...input, workspace_id: project.workspace_id, created_by: req.userId })
    .select('id'));
  if (task_ids.length) await linkTasks(req.userId!, goal.id, task_ids);
  const { goals } = await loadGoals(project.workspace_id, req.userId!, goal.id);
  return goals[0];
}));

router.patch('/goals/:id', route(async (req) => {
  const { goal, access } = await goalFor(req.userId!, String(req.params.id));
  const patch = goalInput.partial().parse(req.body);
  if (patch.project_id && patch.project_id !== goal.project_id) {
    const { project } = await projectFor(req.userId!, patch.project_id, access);
    if (project.workspace_id !== goal.workspace_id) fail(400, 'Project must be in this workspace');
    await assertCanUseProject(req.userId!, project, access);
  }
  const next = { ...goal, ...patch };
  assertRange(next.work_start_date, next.work_end_date, 'Work');
  assertRange(next.start_date, next.due_date, 'Due date range');
  if (patch.assignee_ids) await assertMembers(patch.assignee_ids, goal.workspace_id);
  await exec(db.from('goals').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', goal.id));
  const { goals } = await loadGoals(goal.workspace_id, req.userId!, goal.id);
  return goals[0] ?? null;
}));

router.delete('/goals/:id', route(async (req) => {
  const { goal, access, projects } = await goalFor(req.userId!, String(req.params.id));
  const projectOwner = projects.find((p) => p.id === goal.project_id)?.created_by;
  if (![goal.created_by, projectOwner].includes(req.userId!) && !access.isAdmin(req.userId!)) {
    fail(403, 'Only the goal creator can delete it');
  }
  await exec(db.from('goals').delete().eq('id', goal.id));
}));

/** Link tasks the actor AND the goal creator can both open. Returns linked/skipped. */
async function linkTasks(user: string, goalId: string, taskIds: string[]) {
  const g = await one<any>(db.from('goals').select('id, workspace_id, created_by').eq('id', goalId));
  const tasks = await rowsIn<any>(taskIds, (c) => db.from('tasks').select(TASK_COLS).in('id', c).order('id'));
  const tree = new Tree();
  const access = new Access(g.workspace_id, tree);
  await Promise.all([tree.load({ lists: tasks.map((t) => t.list_id) }), access.load([user, g.created_by])]);
  const existing = await rowsIn<any>(taskIds, (c) => db.from('goal_tasks').select('task_id, scheduled').eq('goal_id', goalId).in('task_id', c).order('task_id'));
  const skipped: { id: string; reason: string }[] = [];
  const upserts: any[] = [];
  for (const id of new Set(taskIds)) {
    const t = tasks.find((x) => x.id === id);
    if (!t || !tree.liveList(t.list_id, g.workspace_id)) { skipped.push({ id, reason: 'Task not found' }); continue; }
    if (t.recurrence) { skipped.push({ id, reason: 'Routine templates can’t be linked — link a routine’s task instead' }); continue; }
    if (!access.level(user, 'list', t.list_id)) { skipped.push({ id, reason: 'You don’t have access to this task' }); continue; }
    if (!access.level(g.created_by, 'list', t.list_id)) { skipped.push({ id, reason: 'The goal creator doesn’t have access to this task' }); continue; }
    const prior = existing.find((e) => e.task_id === id);
    upserts.push({ goal_id: goalId, task_id: id, is_direct: true, scheduled: prior ? prior.scheduled : hasDates(t), created_by: user });
  }
  if (upserts.length) await exec(db.from('goal_tasks').upsert(upserts, { onConflict: 'goal_id,task_id' }));
  return { linked: upserts.map((u) => u.task_id), skipped };
}

router.post('/goals/:id/tasks', route(async (req) => {
  const { goal } = await goalFor(req.userId!, String(req.params.id));
  const body = z.object({ task_ids: z.array(uuid).min(1).max(50) }).parse(req.body);
  const result = await linkTasks(req.userId!, goal.id, body.task_ids);
  if (!result.linked.length && result.skipped.length) fail(403, result.skipped[0].reason);
  return result;
}));

router.delete('/goals/:id/tasks/:taskId', route(async (req) => {
  const { goal } = await goalFor(req.userId!, String(req.params.id));
  const taskId = uuid.parse(req.params.taskId);
  const t = goal.tasks.find((x) => x.id === taskId);
  if (t?.source_ids.length) {
    // Still included by a container: keep the anchor row (placement/dependencies), drop the manual link.
    await exec(db.from('goal_tasks').update({ is_direct: false }).eq('goal_id', goal.id).eq('task_id', taskId));
  } else {
    await exec(db.from('goal_tasks').delete().eq('goal_id', goal.id).eq('task_id', taskId));
  }
}));

// Place a task on (or off) the timeline and/or change its dates. Dates belong to
// the task itself, so this mirrors PUT /pm/tasks/:id: edit access, unlocked
// list, merged metadata, stale day-plan cleanup and the activity feed.
router.patch('/goals/:id/tasks/:taskId/schedule', route(async (req) => {
  const { goal, tree } = await goalFor(req.userId!, String(req.params.id));
  const taskId = uuid.parse(req.params.taskId);
  const body = z.object({
    scheduled: z.boolean().optional(),
    work_date: taskDate.optional(),
    work_end_date: taskDate.optional(),
    start_date: taskDate.optional(),
    due_date: taskDate.optional(),
  }).parse(req.body);
  const gt = goal.tasks.find((t) => t.id === taskId);
  if (!gt) fail(404, 'This task isn’t part of the goal');
  const { scheduled, work_end_date, ...fields } = body;
  const datesChanged = Object.keys(fields).length > 0 || work_end_date !== undefined;
  let updated: any = null;
  if (datesChanged) {
    if (!gt!.can_edit) fail(403, tree.locked(gt!.list_id) ? 'This task’s list is locked' : 'You need edit access to change this task’s dates');
    const prior = await one<any>(db.from('tasks').select('work_date, start_date, due_date, metadata').eq('id', taskId));
    const nextWork = fields.work_date !== undefined ? fields.work_date : prior.work_date;
    const nextWorkEnd = work_end_date !== undefined ? work_end_date : prior.metadata?.work_end_date;
    try { validateWorkRange(nextWork, nextWorkEnd); } catch { fail(400, 'Work end must be on or after work start'); }
    assertRange(fields.start_date !== undefined ? fields.start_date : prior.start_date, fields.due_date !== undefined ? fields.due_date : prior.due_date, 'Due date range');
    const metadata = work_end_date !== undefined ? { ...(prior.metadata || {}), work_end_date } : undefined;
    updated = await one<any>(db.from('tasks')
      .update({ ...fields, ...(metadata ? { metadata } : {}), last_modified_by: req.userId })
      .eq('id', taskId)
      .select('id, work_date, start_date, due_date, metadata'));
    if (fields.work_date && fields.work_date !== prior.work_date) {
      try {
        await exec(db.from('task_day_plans').delete().eq('task_id', taskId).eq('user_id', req.userId!));
      } catch (e) { console.error('[pm/goals] stale day-plan cleanup failed:', e); }
    }
    const events: TaskActivityEvent[] = [];
    for (const f of ['work_date', 'start_date', 'due_date'] as const) {
      if (fields[f] !== undefined && (prior[f] ?? null) !== (fields[f] ?? null)) {
        events.push({ event_type: 'field_change', field: f, old_value: prior[f] ?? null, new_value: fields[f] ?? null });
      }
    }
    if (metadata && (prior.metadata?.work_end_date ?? null) !== (work_end_date ?? null)) {
      events.push({ event_type: 'field_change', field: 'metadata', old_value: null, new_value: null });
    }
    try { await logTaskActivity(taskId, req.userId!, events); } catch (e) { console.error('[pm/goals] activity log failed:', e); }
  }
  const link = await one<any>(db.from('goal_tasks').select('is_direct, scheduled').eq('goal_id', goal.id).eq('task_id', taskId));
  await exec(db.from('goal_tasks').upsert({
    goal_id: goal.id,
    task_id: taskId,
    scheduled: scheduled ?? (datesChanged ? true : link?.scheduled ?? gt!.scheduled),
    is_direct: link?.is_direct ?? false,
  }, { onConflict: 'goal_id,task_id' }));
  return updated && {
    id: taskId,
    work_date: updated.work_date,
    work_end_date: updated.metadata?.work_end_date ?? null,
    start_date: updated.start_date,
    due_date: updated.due_date,
  };
}));

router.post('/goals/:id/dependencies', route(async (req) => {
  const { goal } = await goalFor(req.userId!, String(req.params.id));
  const body = z.object({
    from_task_id: uuid,
    to_task_id: uuid,
    from_endpoint: z.enum(['start', 'end']).default('end'),
    to_endpoint: z.enum(['start', 'end']).default('start'),
  }).parse(req.body);
  const ids = new Set(goal.tasks.map((t) => t.id));
  if (!ids.has(body.from_task_id) || !ids.has(body.to_task_id)) fail(400, 'Both tasks must be part of this goal');
  if (body.from_task_id === body.to_task_id) fail(400, 'A task can’t depend on itself');
  const edges = await rows<any>(db.from('goal_dependencies').select('from_task_id, to_task_id').eq('goal_id', goal.id).order('id'));
  if (edges.some((e) => e.from_task_id === body.from_task_id && e.to_task_id === body.to_task_id)) fail(409, 'These tasks are already connected');
  if (wouldCreateGoalCycle(edges, body.from_task_id, body.to_task_id)) fail(400, 'This connection would create a circular dependency');
  // Container-included tasks need anchor rows for the composite foreign keys.
  await exec(db.from('goal_tasks').upsert(
    [body.from_task_id, body.to_task_id].map((task_id) => ({ goal_id: goal.id, task_id, scheduled: true, is_direct: false })),
    { onConflict: 'goal_id,task_id', ignoreDuplicates: true },
  ));
  return one(db.from('goal_dependencies').insert({ ...body, goal_id: goal.id }).select('id, goal_id, from_task_id, to_task_id, from_endpoint, to_endpoint'));
}));

router.delete('/goals/:id/dependencies/:depId', route(async (req) => {
  const { goal } = await goalFor(req.userId!, String(req.params.id));
  await exec(db.from('goal_dependencies').delete().eq('goal_id', goal.id).eq('id', uuid.parse(req.params.depId)));
}));

router.post('/goals/:id/sources', route(async (req) => {
  const { goal, access, tree } = await goalFor(req.userId!, String(req.params.id));
  const body = z.object({ resource_type: z.enum(['folder', 'list']), resource_id: uuid }).parse(req.body);
  await tree.load(body.resource_type === 'list' ? { lists: [body.resource_id] } : { folders: [body.resource_id] });
  await access.load([goal.created_by]);
  const row = body.resource_type === 'list' ? tree.lists.get(body.resource_id) : tree.folders.get(body.resource_id);
  if (!row || row.deleted_at) fail(404, 'Container not found');
  if (!access.level(req.userId!, body.resource_type, body.resource_id) || !access.level(goal.created_by, body.resource_type, body.resource_id)) {
    fail(403, 'Both you and the goal creator need access to this ' + body.resource_type);
  }
  await exec(db.from('goal_sources').upsert({ ...body, goal_id: goal.id }, { onConflict: 'goal_id,resource_type,resource_id', ignoreDuplicates: true }));
}));

router.delete('/goals/:id/sources/:sourceId', route(async (req) => {
  const { goal } = await goalFor(req.userId!, String(req.params.id));
  await exec(db.from('goal_sources').delete().eq('goal_id', goal.id).eq('id', uuid.parse(req.params.sourceId)));
}));

export default router;
