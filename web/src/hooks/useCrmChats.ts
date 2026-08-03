import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CrmChatListItem } from '@squadhub/shared';
import api from '../services/api';

export function useCrmChats(workspaceId: string | null | undefined) {
  return useQuery<CrmChatListItem[]>({
    queryKey: ['crm-chats', workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const res = await api.get('/channels/crm', { params: { workspace_id: workspaceId } });
      return res.data.data ?? [];
    },
    refetchInterval: 30_000,
  });
}

export function useCloseCrmChat(workspaceId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (channelId: string) => {
      await api.post(`/channels/crm/${channelId}/close`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-chats', workspaceId] });
    },
  });
}

export function useReopenCrmChat(workspaceId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (channelId: string) => {
      await api.post(`/channels/crm/${channelId}/reopen`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-chats', workspaceId] });
    },
  });
}
