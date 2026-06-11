import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { DmConversation } from '@squadhub/shared';

// The API nests each participant as { user_id, user: {...} } (Supabase join);
// the UI expects flat user objects on dm.participants. Normalize here so every
// consumer (sidebar rows, chat header, intros) gets the typed shape.
type RawParticipant =
  | { user_id?: string; user?: { id: string; display_name?: string | null; avatar_url?: string | null } }
  | { id: string; display_name?: string | null; avatar_url?: string | null };

export function normalizeDm(raw: DmConversation & { participants?: RawParticipant[] }): DmConversation {
  const participants = (raw.participants || [])
    .map((p) => ('user' in p && p.user ? p.user : p))
    .filter(
      (p): p is { id: string; display_name?: string | null; avatar_url?: string | null } =>
        typeof (p as { id?: unknown } | null | undefined)?.id === 'string',
    );
  return { ...raw, participants } as DmConversation;
}

// List the current user's DM conversations in this workspace.
export function useDms(workspaceId: string | null) {
  return useQuery({
    queryKey: ['dms', workspaceId],
    queryFn: async () => {
      const r = await api.get(`/dms?workspace_id=${workspaceId}`);
      return ((r.data?.data || []) as DmConversation[]).map(normalizeDm);
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
      return normalizeDm(r.data?.data as DmConversation);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dms', workspaceId] });
    },
  });
}
