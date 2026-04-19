import type { SystemRoleKey, UserType } from '@squadhub/shared';
import { supabaseAdmin } from '../supabase';

export function systemKeyForUserType(userType: UserType): SystemRoleKey {
  if (userType === 'internal') return 'member';
  if (userType === 'client_staff') return 'guest';
  // client, partner
  return 'user';
}

export async function getDefaultRoleIdForUserType(userType: UserType): Promise<string | null> {
  const key = systemKeyForUserType(userType);
  const { data } = await supabaseAdmin
    .from('roles')
    .select('id')
    .eq('system_key', key)
    .maybeSingle();
  return data?.id || null;
}
