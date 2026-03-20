import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { RolePermissions } from '@squadhub/shared';

interface PermissionsData {
  permissions: RolePermissions;
  workspaceRole: string;
}

export function useMyPermissions() {
  return useQuery<PermissionsData>({
    queryKey: ['my-permissions'],
    queryFn: async () => {
      const res = await api.get('/memberships/my-permissions');
      return res.data.data;
    },
    staleTime: 60_000, // cache for 1 minute
  });
}

/**
 * Helper: returns true if the user has a specific permission.
 * Defaults to false if permissions haven't loaded yet.
 */
export function useHasPermission(key: keyof RolePermissions): boolean {
  const { data } = useMyPermissions();
  return data?.permissions?.[key] === true;
}

/**
 * Returns true if user is admin or super_admin.
 */
export function useIsAdmin(): boolean {
  const { data } = useMyPermissions();
  return data?.workspaceRole === 'admin' || data?.workspaceRole === 'super_admin';
}
