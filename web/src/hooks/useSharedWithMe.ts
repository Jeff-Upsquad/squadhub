import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { SharedWithMeItem, SharedTree } from '@squadhub/shared';

export function useSharedWithMe(workspaceId: string | undefined) {
  return useQuery<SharedWithMeItem[]>({
    queryKey: ['shared-with-me', workspaceId],
    queryFn: async () => {
      const res = await api.get(`/pm/shared-with-me?workspace_id=${workspaceId}`);
      return res.data.data;
    },
    enabled: !!workspaceId,
  });
}

// Enriched, navigable shared roots for the AREAS section. Partner-tier only —
// callers pass `enabled` (e.g. useIsPartner()) so internal users never fetch it.
export function useSharedTree(workspaceId: string | undefined, enabled = true) {
  return useQuery<SharedTree>({
    queryKey: ['shared-tree', workspaceId],
    queryFn: async () => {
      const res = await api.get(`/pm/shared-tree?workspace_id=${workspaceId}`);
      return res.data.data;
    },
    enabled: !!workspaceId && enabled,
  });
}
