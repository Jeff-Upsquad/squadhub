import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { useWorkspaceStore } from '../stores/workspaceStore';

export type CrmTeamChatSource = 'crm' | 'shcrm';

export interface CrmTeamChatChannel {
  channel_id: string;
  entity_type: 'deal' | 'contact' | 'lead' | string | null;
  entity_id: string | null;
  label: string;
  subtitle: string | null;
  closed?: boolean;
  via_squad?: boolean;
  last_message_preview?: string | null;
  last_message_at?: string | null;
}

export interface CrmTeamChatUnread {
  total: number;
  own_total?: number;
  team_total?: number;
  by_channel: Record<string, number>;
  by_entity?: Record<string, number>;
  team_channels?: string[];
}

function wsId(): string | null {
  return useWorkspaceStore.getState().currentWorkspace?.id ?? null;
}

/** Open TeamChats from a CRM backend (proxied via SquadHub server to avoid CORS). */
export function useCrmTeamChatOpen(source: CrmTeamChatSource) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  return useQuery<CrmTeamChatChannel[]>({
    queryKey: ['crm-teamchat-open', source, workspaceId],
    enabled: !!workspaceId,
    queryFn: async () =>
      (await api.get(`/crm-teamchat/${source}/open`, { params: { workspace_id: workspaceId } }))
        .data.data ?? [],
    refetchInterval: 15_000,
    retry: false,
  });
}

/**
 * Unread badge counts for a CRM TeamChat source.
 * `total` (and own/team split) = chats-with-unread for nav badges;
 * `by_channel` = per-chat message counts for row badges.
 */
export function useCrmTeamChatUnread(source: CrmTeamChatSource) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  return useQuery<CrmTeamChatUnread>({
    queryKey: ['crm-teamchat-unread', source, workspaceId],
    enabled: !!workspaceId,
    queryFn: async () =>
      (await api.get(`/crm-teamchat/${source}/unread`, { params: { workspace_id: workspaceId } }))
        .data.data ?? { total: 0, by_channel: {} },
    refetchInterval: 15_000,
    retry: false,
  });
}

export function useMarkCrmTeamChatRead(source: CrmTeamChatSource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (channelId: string) =>
      (
        await api.post(
          `/crm-teamchat/${source}/${channelId}/read`,
          {},
          { params: { workspace_id: wsId() } },
        )
      ).data,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['crm-teamchat-unread', source] });
      qc.invalidateQueries({ queryKey: ['crm-teamchat-open', source] });
    },
  });
}

export function useCloseCrmTeamChat(source: CrmTeamChatSource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (channelId: string) =>
      (
        await api.post(
          `/crm-teamchat/${source}/${channelId}/close`,
          {},
          { params: { workspace_id: wsId() } },
        )
      ).data,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['crm-teamchat-open', source] });
    },
  });
}

export function useReopenCrmTeamChat(source: CrmTeamChatSource) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (channelId: string) =>
      (
        await api.post(
          `/crm-teamchat/${source}/${channelId}/reopen`,
          {},
          { params: { workspace_id: wsId() } },
        )
      ).data,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['crm-teamchat-open', source] });
    },
  });
}
