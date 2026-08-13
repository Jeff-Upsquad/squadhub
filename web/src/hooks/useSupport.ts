import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Message, SupportTicket, SupportTicketCategory } from '@squadhub/shared';
import api from '../services/api';

export interface SupportOverview {
  channel: { id: string; name: string; channel_kind: 'support' };
  is_agent: boolean;
  unread: number;
  tickets: { open: SupportTicket[]; closed: SupportTicket[] };
}

/** Ensures the Support channel exists and returns the tickets this user sees. */
export function useSupportOverview(workspaceId: string | null) {
  return useQuery({
    queryKey: ['support', 'overview', workspaceId],
    queryFn: () =>
      api.get(`/support/overview?workspace_id=${workspaceId}`).then((r) => r.data.data as SupportOverview),
    enabled: !!workspaceId,
  });
}

/** Just the support channel id (shared cache with useSupportOverview). */
export function useSupportChannelId(workspaceId: string | null): string | null {
  const { data } = useSupportOverview(workspaceId);
  return data?.channel.id ?? null;
}

export function useCreateTicket(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      category: SupportTicketCategory;
      subject: string;
      description: string;
      priority?: 'low' | 'normal' | 'high' | 'urgent';
    }) =>
      api
        .post('/support/tickets', { workspace_id: workspaceId, ...payload })
        .then((r) => r.data.data as SupportTicket),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support', 'overview', workspaceId] });
      qc.invalidateQueries({ queryKey: ['support', 'manage'] });
    },
  });
}

export function useTicketMessages(ticketId: string | null) {
  return useQuery({
    queryKey: ['support', 'ticket-messages', ticketId],
    queryFn: () =>
      api.get(`/support/tickets/${ticketId}/messages`).then((r) => r.data.data as Message[]),
    enabled: !!ticketId,
  });
}

export function useSendTicketMessage(ticketId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      content?: string;
      type?: string;
      file_url?: string;
      file_name?: string;
      file_size?: number;
      file_mime?: string;
    }) => api.post(`/support/tickets/${ticketId}/messages`, payload).then((r) => r.data.data as Message),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support', 'ticket-messages', ticketId] });
    },
  });
}

export function useSetTicketStatus(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, action }: { ticketId: string; action: 'close' | 'reopen' }) =>
      api.post(`/support/tickets/${ticketId}/${action}`).then((r) => r.data.data as SupportTicket),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support', 'overview', workspaceId] });
      qc.invalidateQueries({ queryKey: ['support', 'manage'] });
    },
  });
}

/** Marks a ticket's notifications read (clears the rail badge on open). */
export function useMarkTicketRead(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticketId: string) => api.post(`/support/tickets/${ticketId}/read`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support', 'overview', workspaceId] });
    },
  });
}

export function useClaimTicket(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticketId: string) =>
      api.post(`/support/tickets/${ticketId}/claim`).then((r) => r.data.data as SupportTicket),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support', 'overview', workspaceId] });
      qc.invalidateQueries({ queryKey: ['support', 'manage'] });
    },
  });
}
