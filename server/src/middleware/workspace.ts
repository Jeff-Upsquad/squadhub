/**
 * Tenancy: resolve the request's active workspace (account) and answer
 * "which workspaces can this user see?".
 *
 * The server talks to Postgres with the service-role key, so RLS does NOT
 * protect anything — every query must scope itself. This module is the single
 * place that decides membership:
 *
 *   • Direct membership: a workspace_members row in an ACTIVE workspace.
 *   • Shared membership: for a `kind = 'shared'` workspace, an owner/admin of a
 *     participant account linked through an ACTIVE shared_workspace_links row
 *     resolves too (Slack Connect model), with role 'member'.
 *
 * Suspended workspaces resolve for nobody.
 *
 * requireAuth calls resolveActiveWorkspace(): when the client sends
 * `X-Workspace-Id` (or `?workspace_id=` for GETs that already carried it) the
 * membership is verified and `req.workspaceId` / `req.workspaceRole` are set;
 * a header naming a workspace the user can't reach is a 403. The active
 * workspace is also kept in AsyncLocalStorage so deep helpers
 * (isWorkspaceAdmin, getUserPermissions) default to it.
 *
 * Aggregated surfaces (My Tasks, Inbox, Calendar, notifications) use
 * getUserWorkspaceIds() instead of the active workspace.
 */

import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../supabase';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';

declare global {
  namespace Express {
    interface Request {
      workspaceId?: string;
      workspaceRole?: WorkspaceRole;
      workspaceKind?: string;
    }
  }
}

export interface WorkspaceMembership {
  workspaceId: string;
  role: WorkspaceRole;
  kind: string;
  viaShared: boolean;
  isUpsquadStaff: boolean;
}

interface TenantContext {
  userId?: string;
  workspaceId?: string;
}

const tenantStore = new AsyncLocalStorage<TenantContext>();

/** The active workspace of the request currently executing (if any). */
export function currentWorkspaceId(): string | undefined {
  return tenantStore.getStore()?.workspaceId;
}

/** Run `fn` with a tenant context (used by requireAuth and by tests). */
export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return tenantStore.run(ctx, fn);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeRole(role: string | null | undefined): WorkspaceRole {
  if (role === 'owner' || role === 'admin' || role === 'guest') return role;
  // Legacy Hub value: super_admin behaves as owner.
  if (role === 'super_admin') return 'owner';
  return 'member';
}

/**
 * The user's membership in `workspaceId`, or null when they can't reach it.
 */
export async function getMembership(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceMembership | null> {
  if (!userId || !workspaceId || !UUID_RE.test(workspaceId)) return null;

  const { data: ws } = await supabaseAdmin
    .from('workspaces')
    .select('id, kind, status')
    .eq('id', workspaceId)
    .maybeSingle();
  if (!ws || ws.status === 'suspended') return null;

  const { data: direct } = await supabaseAdmin
    .from('workspace_members')
    .select('role, is_upsquad_staff')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (direct) {
    return {
      workspaceId,
      role: normalizeRole(direct.role as string),
      kind: ws.kind as string,
      viaShared: false,
      isUpsquadStaff: !!direct.is_upsquad_staff,
    };
  }

  if (ws.kind !== 'shared') return null;

  // Shared workspace: admins/owners of a linked participant account resolve.
  const { data: links } = await supabaseAdmin
    .from('shared_workspace_links')
    .select('participant_workspace_id')
    .eq('shared_workspace_id', workspaceId)
    .eq('status', 'active');
  const participantIds = (links || []).map((l: any) => l.participant_workspace_id as string);
  if (!participantIds.length) return null;

  const { data: adminRows } = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .in('workspace_id', participantIds)
    .in('role', ['owner', 'admin']);
  if (!adminRows?.length) return null;

  return { workspaceId, role: 'member', kind: 'shared', viaShared: true, isUpsquadStaff: false };
}

/**
 * Every workspace the user can reach (direct + shared). Used by aggregated
 * surfaces — My Tasks, Inbox, Calendar, notifications, search.
 */
export async function getUserWorkspaceIds(userId: string): Promise<string[]> {
  const { data: direct } = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id, role, workspaces!inner(status)')
    .eq('user_id', userId);
  const ids = new Set<string>();
  const adminOf: string[] = [];
  for (const row of (direct || []) as any[]) {
    if (row.workspaces?.status === 'suspended') continue;
    ids.add(row.workspace_id as string);
    if (row.role === 'owner' || row.role === 'admin') adminOf.push(row.workspace_id as string);
  }

  if (adminOf.length) {
    const { data: links } = await supabaseAdmin
      .from('shared_workspace_links')
      .select('shared_workspace_id, workspaces:shared_workspace_id!inner(status)')
      .in('participant_workspace_id', adminOf)
      .eq('status', 'active');
    for (const l of (links || []) as any[]) {
      if (l.workspaces?.status === 'suspended') continue;
      ids.add(l.shared_workspace_id as string);
    }
  }
  return [...ids];
}

/** Owner/admin of the given workspace (defaults to the request's active one). */
export async function isWorkspaceAdminOf(userId: string, workspaceId?: string | null): Promise<boolean> {
  const wsId = workspaceId || currentWorkspaceId();
  if (!wsId) return false;
  const m = await getMembership(userId, wsId);
  return m?.role === 'owner' || m?.role === 'admin';
}

/**
 * The workspace a resource belongs to. Tenant tables either carry
 * workspace_id directly or reach it through their parent.
 */
export async function workspaceIdOf(resourceType: string, resourceId: string): Promise<string | null> {
  if (!resourceId || !UUID_RE.test(resourceId)) return null;
  const direct: Record<string, string> = {
    channel: 'channels',
    space: 'spaces',
    folder: 'folders',
    list: 'lists',
    task: 'tasks',
    dm: 'dm_conversations',
    dm_conversation: 'dm_conversations',
    note: 'squad_notes',
    goal: 'goals',
    meeting: 'meetings',
    meeting_event: 'meeting_events',
    huddle: 'huddles',
    message: 'messages',
    whiteboard: 'whiteboards',
    routine: 'work_blocks',
    work_block: 'work_blocks',
  };
  const table = direct[resourceType];
  if (!table) return null;
  const { data } = await supabaseAdmin
    .from(table)
    .select('workspace_id')
    .eq('id', resourceId) // tenant-scope: resolves the owning workspace of a resource id
    .maybeSingle();
  return ((data as any)?.workspace_id as string) ?? null;
}

/**
 * The workspace a request names: `X-Workspace-Id`, and/or a `workspace_id`
 * query parameter (older routes pass it that way). When both are present they
 * must agree, so admin/role checks — which use the active workspace — always
 * run against the same workspace a route then filters by.
 */
function requestedWorkspaceId(req: Request): { id?: string; conflict: boolean } {
  const header = req.header('x-workspace-id')?.trim() || undefined;
  const q = typeof req.query?.workspace_id === 'string' && req.query.workspace_id ? (req.query.workspace_id as string) : undefined;
  // A JSON body naming workspace_id (create channel/space/DM, favorites, timer,
  // uploads, goals…) is held to the same rule.
  const b = req.body && typeof (req.body as any).workspace_id === 'string' && (req.body as any).workspace_id
    ? ((req.body as any).workspace_id as string)
    : undefined;
  const named = [header, q, b].filter(Boolean) as string[];
  if (new Set(named).size > 1) return { conflict: true };
  return { id: named[0], conflict: false };
}

/**
 * Called by requireAuth after the user is known. Verifies the requested
 * workspace (if any) and sets req.workspaceId / req.workspaceRole. Returns
 * false (after answering) when the named workspace isn't reachable.
 */
export async function resolveActiveWorkspace(req: Request, res: Response): Promise<boolean> {
  const { id: wsId, conflict } = requestedWorkspaceId(req);
  if (conflict) {
    res.status(400).json({ success: false, error: 'X-Workspace-Id and workspace_id disagree' });
    return false;
  }
  if (!wsId) return true;
  const membership = await getMembership(req.userId!, wsId);
  if (!membership) {
    res.status(403).json({ success: false, error: 'You are not a member of this workspace' });
    return false;
  }
  req.workspaceId = membership.workspaceId;
  req.workspaceRole = membership.role;
  req.workspaceKind = membership.kind;
  return true;
}

/** Bind the async tenant context for the rest of the request. */
export function enterTenantContext(req: Request, next: NextFunction): void {
  tenantStore.run({ userId: req.userId, workspaceId: req.workspaceId }, () => next());
}

/** Route guard: the request must name an active workspace (X-Workspace-Id). */
export function requireWorkspace(req: Request, res: Response, next: NextFunction): void {
  if (!req.workspaceId) {
    res.status(400).json({ success: false, error: 'X-Workspace-Id header is required' });
    return;
  }
  next();
}

/** Route guard: owner/admin of the active workspace. */
export function requireWorkspaceAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.workspaceId) {
    res.status(400).json({ success: false, error: 'X-Workspace-Id header is required' });
    return;
  }
  if (req.workspaceRole !== 'owner' && req.workspaceRole !== 'admin') {
    res.status(403).json({ success: false, error: 'Workspace admin access required' });
    return;
  }
  next();
}

/**
 * A body/query-supplied workspace_id must be one the user can reach. Returns
 * the verified id (falling back to the active workspace) or null after 403.
 */
export async function verifiedWorkspaceId(
  req: Request,
  res: Response,
  supplied?: string | null,
): Promise<string | null> {
  const wsId = supplied || req.workspaceId;
  if (!wsId) {
    res.status(400).json({ success: false, error: 'workspace_id is required' });
    return null;
  }
  if (wsId === req.workspaceId) return wsId;
  const m = await getMembership(req.userId!, wsId);
  if (!m) {
    res.status(403).json({ success: false, error: 'You are not a member of this workspace' });
    return null;
  }
  return wsId;
}
