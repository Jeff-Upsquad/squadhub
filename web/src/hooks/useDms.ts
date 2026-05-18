import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { DmConversation } from '@squadhub/shared';

// List the current user's DM conversations in this workspace.
export function useDms(workspaceId: string | null) {
  return useQuery({
    queryKey: ['dms', workspaceId],
    queryFn: async () => {
      const r = await api.get(`/dms?workspace_id=${workspaceId}`);
      return (r.data?.data || []) as DmConversation[];
    },
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
}

// Create or find an existing DM. `participant_ids` should NOT include self.
export function useCreateDm(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (participantIds: string[]) => {
      const r = await api.post('/dms', {
        workspace_id: workspaceId,
        participant_ids: participantIds,
      });
      return r.data?.data as DmConversation;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dms', workspaceId] });
    },
  });
}
