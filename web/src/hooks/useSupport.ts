import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from '@squadhub/shared';
import api from '../services/api';

/*
 * Support tickets live on Squad Hub's help desk; the SaaS server reaches them
 * over the bridge (server/src/routes/hub-data.ts). Agent replies arrive as
 * `support_reply` notifications (POST /bridge/v1/support/notify).
 */

export interface BridgeTicket {
  id: string;
  ticket_number: number;
  ticket_code: string;
  category: SupportTicketCategory;
  subject: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  assignee: { id: string; display_name: string } | null;
  created_at: string;
  last_activity_at: string;
  closed_at: string | null;
}

export interface BridgeTicketMessage {
  id: string;
  content: string | null;
  type: string;
  file_url: string | null;
  file_name: string | null;
  created_at: string;
  author: { kind: 'requester' | 'agent'; name: string | null; avatar_url: string | null };
}

export interface SupportOverview {
  channel: { id: string; name: string; channel_kind: 'support' } | null;
  is_agent: boolean;
  unread: number;
  /** Set when Squad Hub couldn't be reached (tickets are then empty). */
  unavailable?: string | null;
  tickets: { open: BridgeTicket[]; closed: BridgeTicket[] };
}

/** The tickets this user raised (across their accounts) + the rail badge. */
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
  return data?.channel?.id ?? null;
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
        .then((r) => r.data.data as BridgeTicket),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support', 'overview', workspaceId] });
    },
  });
}

export function useTicketThread(ticketId: string | null) {
  return useQuery({
    queryKey: ['support', 'ticket-messages', ticketId],
    queryFn: () =>
      api
        .get(`/support/tickets/${ticketId}/messages`)
        .then((r) => r.data.data as { ticket: BridgeTicket | null; messages: BridgeTicketMessage[] }),
    enabled: !!ticketId,
    // Agent replies also arrive as notifications; poll gently while open.
    refetchInterval: 30_000,
  });
}

export function useSendTicketMessage(ticketId: string | null, workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => api.post(`/support/tickets/${ticketId}/messages`, { content }).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support', 'ticket-messages', ticketId] });
      qc.invalidateQueries({ queryKey: ['support', 'overview', workspaceId] });
    },
  });
}

export function useSetTicketStatus(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, action }: { ticketId: string; action: 'close' | 'reopen' }) =>
      api.post(`/support/tickets/${ticketId}/${action}`).then((r) => r.data.data as BridgeTicket),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['support', 'overview', workspaceId] });
      qc.invalidateQueries({ queryKey: ['support', 'ticket-messages', v.ticketId] });
    },
  });
}

/** Marks a ticket's reply notifications read (clears the rail badge on open). */
export function useMarkTicketRead(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticketId: string) => api.post(`/support/tickets/${ticketId}/read`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support', 'overview', workspaceId] });
    },
  });
}
