import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { ChatKind } from '../stores/workspaceStore';

export interface ScheduledMessage {
  id: string;
  user_id: string;
  channel_id: string | null;
  dm_conversation_id: string | null;
  parent_message_id: string | null;
  content: string;
  scheduled_at: string;
  status: 'pending' | 'sent' | 'canceled';
  created_at: string;
}

const idParam = (kind: ChatKind) => (kind === 'dm' ? 'dm_conversation_id' : 'channel_id');

// Own pending scheduled messages for one conversation, soonest first.
export function useScheduledMessages(kind: ChatKind, conversationId: string | undefined) {
  return useQuery<ScheduledMessage[]>({
    queryKey: ['scheduled-messages', conversationId],
    queryFn: async () => {
      const res = await api.get(`/messages/scheduled?${idParam(kind)}=${conversationId}`);
      return res.data?.data ?? [];
    },
    enabled: !!conversationId,
    // The 30s server sweeper turns due rows into real messages; refetch so
    // the strip count drains without a manual reload.
    refetchInterval: 30_000,
  });
}

export function useScheduleMessage(kind: ChatKind, conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { content: string; scheduled_at: string; parent_message_id?: string }) => {
      const res = await api.post('/messages/scheduled', {
        [idParam(kind)]: conversationId,
        ...body,
      });
      return res.data.data as ScheduledMessage;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduled-messages', conversationId] });
    },
  });
}

export function useCancelScheduledMessage(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/messages/scheduled/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduled-messages', conversationId] });
    },
  });
}
