import { supabaseAdmin } from '../supabase';
import { currentWorkspaceId, getMembership } from '../middleware/workspace';
import { BLOCKED_MINI_APPS } from './accounts';

/**
 * SaaS mini-app entitlement is PER WORKSPACE (account): a workspace_mini_apps
 * row with enabled = true, for a catalog app that is itself enabled. Every
 * member of the workspace gets the app there. Cashbook is never offered.
 *
 * `workspaceId` defaults to the request's active workspace (X-Workspace-Id).
 */
export async function workspaceHasMiniApp(workspaceId: string, slug: string): Promise<boolean> {
  if (BLOCKED_MINI_APPS.has(slug)) return false;
  const { data } = await supabaseAdmin
    .from('workspace_mini_apps')
    .select('enabled, mini_apps!inner(is_enabled)')
    .eq('workspace_id', workspaceId)
    .eq('slug', slug)
    .maybeSingle();
  return !!data?.enabled && !!(data as any).mini_apps?.is_enabled;
}

export async function userHasMiniApp(
  userId: string,
  slug: string,
  workspaceId?: string | null,
): Promise<boolean> {
  const wsId = workspaceId || currentWorkspaceId();
  if (!wsId) return false;
  if (!(await getMembership(userId, wsId))) return false;
  return workspaceHasMiniApp(wsId, slug);
}
