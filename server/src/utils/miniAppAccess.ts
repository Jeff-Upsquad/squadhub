import { supabaseAdmin } from '../supabase';
import { getUserRoleIds } from './roles';

/**
 * Returns true if the user can access the enabled mini app identified by `slug`.
 * Access = (role-based via any of the user's roles — primary or secondary)
 *          OR (direct user grant). Mirrors GET /mini-apps/my.
 * Returns false if the app is missing or disabled.
 */
export async function userHasMiniApp(userId: string, slug: string): Promise<boolean> {
  const { data: app } = await supabaseAdmin
    .from('mini_apps')
    .select('id, is_enabled')
    .eq('slug', slug)
    .maybeSingle();

  if (!app || !app.is_enabled) return false;

  // Direct user grant
  const { data: userAccess } = await supabaseAdmin
    .from('mini_app_user_access')
    .select('id')
    .eq('user_id', userId)
    .eq('mini_app_id', app.id)
    .maybeSingle();

  if (userAccess) return true;

  // Role-based grant (primary or secondary roles)
  const roleIds = await getUserRoleIds(userId);
  if (roleIds.length === 0) return false;

  const { data: roleAccess } = await supabaseAdmin
    .from('mini_app_role_access')
    .select('id')
    .eq('mini_app_id', app.id)
    .in('role_id', roleIds)
    .limit(1);

  return !!(roleAccess && roleAccess.length > 0);
}
