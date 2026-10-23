import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

const store = vi.hoisted(() => ({ tables: {} as Record<string, any[]> }));
// requireAuth verifies ?workspace_id membership and binds it as req.workspaceId.
vi.mock('../middleware/auth', () => ({ requireAuth: (req: any, _res: any, next: any) => { req.userId = 'me'; req.workspaceId = req.query.workspace_id; next(); } }));
vi.mock('../middleware/userType', () => ({ requireUserType: () => (_req: any, _res: any, next: any) => next() }));
vi.mock('../supabase', () => ({ supabaseAdmin: { from: (table: string) => {
  const filters: ((row: any) => boolean)[] = [];
  let max = Infinity;
  const execute = async () => ({ data: (store.tables[table] || []).filter(r => filters.every(f => f(r))).slice(0, max), error: null });
  const query: any = {
    select: () => query,
    eq: (key: string, value: any) => { filters.push(r => r[key] === value); return query; },
    is: (key: string, value: any) => { filters.push(r => (r[key] ?? null) === value); return query; },
    in: (key: string, values: any[]) => { filters.push(r => values.includes(r[key])); return query; },
    ilike: (key: string, pattern: string) => {
      // The route escapes literal SQL wildcard characters; emulate their
      // literal match here rather than treating percent/underscore as text.
      const literal = pattern.slice(1, -1).replace(/\\([\\%_])/g, '$1').toLowerCase();
      filters.push(r => typeof r[key] === 'string' && r[key].toLowerCase().includes(literal));
      return query;
    },
    order: () => query,
    limit: (value: number) => { max = value; return query; },
    maybeSingle: async () => ({ data: (await execute()).data[0] ?? null, error: null }),
    then: (resolve: any, reject: any) => execute().then(resolve, reject),
  };
  return query;
} } }));
import router from '../routes/pm/search';

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(router);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
beforeEach(() => {
  store.tables = {
    spaces: [{ id: 'space', name: 'Development', workspace_id: 'workspace', created_by: 'other' }, { id: 'elsewhere', workspace_id: 'other' }],
    workspace_members: [{ user_id: 'me', workspace_id: 'workspace', role: 'member' }],
    resource_memberships: [{ resource_type: 'list', resource_id: 'visible', user_id: 'me' }, { resource_type: 'list', resource_id: 'foreign', user_id: 'me' }],
    lists: [{ id: 'visible', name: 'Web', space_id: 'space' }, { id: 'private', space_id: 'space' }, { id: 'foreign', space_id: 'elsewhere' }],
    space_statuses: [{ space_id: 'space', name: 'Delivered', category: 'done' }],
    tasks: [
      { id: 'title', title: 'Needle title', description: null, list_id: 'visible' },
      { id: 'description', title: 'Different title', description: 'A NEEDLE in the description', list_id: 'visible', status: 'Delivered' },
      { id: 'both', title: 'Needle in both', description: 'needle', list_id: 'visible' },
      { id: 'subtask', title: 'Child', description: 'needle in a child task', list_id: 'visible', parent_task_id: 'title' },
      { id: 'private', title: 'Private', description: 'needle', list_id: 'private' },
      { id: 'foreign', title: 'Other workspace', description: 'needle', list_id: 'foreign' },
      { id: 'recurrence', title: 'Template', description: 'needle', list_id: 'visible', recurrence: {} },
    ],
  };
});
// Mirror the DB's saas_fill_workspace_id triggers: child rows inherit the
// workspace of their parent (space → folder/list → task; resource → membership).
function stampWorkspaces() {
  const t = store.tables;
  const wsOf = (table: string, id: string) => (t[table] || []).find((r) => r.id === id)?.workspace_id;
  for (const r of t.folders || []) r.workspace_id ??= wsOf('spaces', r.space_id);
  for (const r of t.lists || []) r.workspace_id ??= wsOf('spaces', r.space_id) ?? 'other';
  for (const r of t.tasks || []) r.workspace_id ??= wsOf('lists', r.list_id);
  for (const r of t.space_statuses || []) r.workspace_id ??= wsOf('spaces', r.space_id);
  for (const r of t.resource_memberships || []) r.workspace_id ??= wsOf(`${r.resource_type}s`, r.resource_id);
}
async function search(params = '') {
  stampWorkspaces();
  const response = await fetch(`${base}/search?workspace_id=workspace&q=needle${params}`);
  expect(response.status).toBe(200);
  return (await response.json() as any).data;
}
describe('task description search', () => {
  it('preserves title-only results unless descriptions are requested', async () => {
    const data = await search();
    expect(data.tasks.map((t: any) => t.id)).toEqual(['title', 'both']);
    expect(data.descriptions).toEqual([]);
  });
  it('finds description-only, completed, and subtask matches with accessible breadcrumbs', async () => {
    const data = await search('&include_descriptions=true');
    expect(data.descriptions.map((t: any) => t.id)).toEqual(['description', 'both', 'subtask']);
    expect(data.descriptions[0]).toMatchObject({ category: 'done', description: 'A NEEDLE in the description', space_name: 'Development', list_name: 'Web' });
  });
  it('gives each search field its own limit', async () => {
    const data = await search('&include_descriptions=true&limit=1');
    expect(data.tasks.map((t: any) => t.id)).toEqual(['title']);
    expect(data.descriptions.map((t: any) => t.id)).toEqual(['description']);
  });
  it('does not return descriptions when no lists are accessible', async () => {
    store.tables.resource_memberships = [];
    const data = await search('&include_descriptions=true');
    expect(data).toEqual({ tasks: [], descriptions: [], spaces: [], folders: [], lists: [] });
  });
  it('treats wildcard characters as literal search text', async () => {
    store.tables.tasks.push({ id: 'literal', title: 'Literal', description: '100%_complete', list_id: 'visible' });
    stampWorkspaces();
    const response = await fetch(`${base}/search?workspace_id=workspace&q=${encodeURIComponent('%_')}&include_descriptions=true`);
    const data = (await response.json() as any).data;
    expect(data.descriptions.map((t: any) => t.id)).toEqual(['literal']);
  });
});

describe('container name search', () => {
  // Spaces/folders/lists named to match the helper's q=needle. 'elsewhere' is a
  // different workspace, so its 'hidden' folder must never surface.
  const containerSetup = () => {
    store.tables.spaces = [
      { id: 'space', name: 'Needle development', workspace_id: 'workspace', created_by: 'other', kind: 'regular', status: 'active', position: 0 },
      { id: 'personal', name: 'My private needle space', workspace_id: 'workspace', created_by: 'me', kind: 'personal', status: 'active', position: 1 },
      { id: 'other-space', name: 'Client area', workspace_id: 'workspace', created_by: 'other', kind: 'regular', status: 'active', position: 2 },
    ];
    store.tables.folders = [
      { id: 'folder', name: 'Needle folder', space_id: 'space', deleted_at: null, position: 0 },
      { id: 'direct', name: 'Shared needle', space_id: 'other-space', deleted_at: null, position: 1 },
      { id: 'hidden', name: 'Hidden needle', space_id: 'elsewhere', deleted_at: null, position: 2 },
    ];
    store.tables.lists = [
      { id: 'visible', name: 'Web needle list', space_id: 'space', deleted_at: null, position: 0 },
      { id: 'private', name: 'Private backlog', space_id: 'space', deleted_at: null, position: 1 },
    ];
    store.tables.resource_memberships = [
      { resource_type: 'space', resource_id: 'space', user_id: 'me' },
      { resource_type: 'list', resource_id: 'visible', user_id: 'me' },
      { resource_type: 'folder', resource_id: 'direct', user_id: 'me' },
    ];
  };

  it('matches spaces, folders and lists by name with access scoping and breadcrumbs', async () => {
    containerSetup();
    const data = await search('&include_descriptions=true');
    // Non-admin 'me': personal space hidden by kind; folders via space access
    // ('folder') or direct share ('direct'); list matches scoped to access.
    expect(data.spaces).toEqual([{ id: 'space', name: 'Needle development' }]);
    expect(data.folders).toEqual([
      { id: 'folder', name: 'Needle folder', space_id: 'space', space_name: 'Needle development' },
      { id: 'direct', name: 'Shared needle', space_id: 'other-space', space_name: 'Client area' },
    ]);
    expect(data.lists).toEqual([
      { id: 'visible', name: 'Web needle list', folder_id: null, folder_name: null, space_id: 'space', space_name: 'Needle development' },
    ]);
    // Task search keeps working alongside the container results.
    expect(data.tasks.map((t: any) => t.id)).toEqual(['title', 'both']);
  });

  it('still returns containers when the user has no accessible lists', async () => {
    containerSetup();
    store.tables.resource_memberships = [{ resource_type: 'folder', resource_id: 'direct', user_id: 'me' }];
    const data = await search('&include_descriptions=true');
    expect(data.tasks).toEqual([]);
    expect(data.lists).toEqual([]);
    // No space access at all — only the directly shared folder is findable.
    expect(data.folders.map((f: any) => f.id)).toEqual(['direct']);
  });

  it('shows admins every folder and list in the workspace', async () => {
    containerSetup();
    store.tables.workspace_members = [{ user_id: 'me', workspace_id: 'workspace', role: 'admin' }];
    const data = await search('&include_descriptions=true');
    // 'hidden' lives in another workspace, so even admins don't see it.
    expect(data.folders.map((f: any) => f.id)).toEqual(['folder', 'direct']);
    // Both workspace lists are accessible to an admin; only the name matches.
    expect(data.lists.map((l: any) => l.id)).toEqual(['visible']);
  });
});
