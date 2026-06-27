import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { getSocket } from '../services/socket';
import type {
  MeetingEvent,
  MeetingEventDetail,
  MeetingKind,
  MeetingLinkProviderId,
  MeetingLinkProviderInfo,
  MeetingVoteValue,
} from '@squadhub/shared';

// --- Lists & lookups ---

export function useMyMeetingEvents(enabled = true) {
  return useQuery<MeetingEvent[]>({
    queryKey: ['meeting-events', 'my'],
    queryFn: async () => (await api.get('/meeting-events/my')).data.data,
    enabled,
    staleTime: 15_000,
  });
}

export function useMeetingProviders() {
  return useQuery<MeetingLinkProviderInfo[]>({
    queryKey: ['meeting-events', 'providers'],
    queryFn: async () => (await api.get('/meeting-events/providers')).data.data,
    staleTime: 5 * 60_000,
  });
}

// --- Create ---

export interface CreateMeetingSlotInput {
  slot_date: string; // YYYY-MM-DD
  start_min?: number | null;
}
export interface CreateMeetingInput {
  title: string;
  kind: MeetingKind;
  agenda?: string;
  duration_min?: number | null;
  timezone?: string;
  guest_ids: string[];
  include_all_channel?: boolean;
  origin_channel_id?: string | null;
  origin_dm_conversation_id?: string | null;
  link_provider?: MeetingLinkProviderId;
  slots: CreateMeetingSlotInput[];
  attachments?: { file_url: string; file_name?: string; file_size?: number; file_mime?: string }[];
  post_card?: boolean;
}

export function useCreateMeetingEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateMeetingInput) =>
      (await api.post('/meeting-events', body)).data.data as MeetingEventDetail,
    onSuccess: (detail) => {
      qc.invalidateQueries({ queryKey: ['meeting-events', 'my'] });
      if (detail?.event?.id) qc.setQueryData(['meeting-events', detail.event.id], detail);
    },
  });
}

// --- Detail (live) ---

// Subscribes to the per-meeting socket room so votes/suggestions/status update
// live in both the mini-app detail and any in-chat card showing the same id.
export function useMeetingEvent(id: string | null) {
  const qc = useQueryClient();
  const query = useQuery<MeetingEventDetail>({
    queryKey: ['meeting-events', id],
    queryFn: async () => (await api.get(`/meeting-events/${id}`)).data.data,
    enabled: !!id,
  });

  useEffect(() => {
    if (!id) return;
    const socket = getSocket();
    if (!socket) return;
    socket.emit('join_meeting', id);
    const onUpdate = (detail: MeetingEventDetail) => {
      if (detail?.event?.id === id) qc.setQueryData(['meeting-events', id], detail);
    };
    socket.on('meeting_event_updated', onUpdate);
    return () => {
      socket.emit('leave_meeting', id);
      socket.off('meeting_event_updated', onUpdate);
    };
  }, [id, qc]);

  return query;
}

// --- Mutations against a single meeting ---

export function useMeetingActions(id: string) {
  const qc = useQueryClient();
  const apply = (detail: MeetingEventDetail | undefined) => {
    if (detail?.event?.id) qc.setQueryData(['meeting-events', detail.event.id], detail);
  };

  const vote = useMutation({
    mutationFn: async ({ slotId, vote }: { slotId: string; vote: MeetingVoteValue }) =>
      (await api.post(`/meeting-events/${id}/slots/${slotId}/vote`, { vote })).data.data as MeetingEventDetail,
    onSuccess: apply,
  });

  const suggest = useMutation({
    mutationFn: async (input: { slot_date: string; start_min?: number | null; end_min?: number | null }) =>
      (await api.post(`/meeting-events/${id}/suggest`, input)).data.data as MeetingEventDetail,
    onSuccess: apply,
  });

  const respondSuggestion = useMutation({
    mutationFn: async ({ slotId, response }: { slotId: string; response: 'confirm' | 'reject' }) =>
      (await api.post(`/meeting-events/${id}/slots/${slotId}/suggestion-response`, { response })).data
        .data as MeetingEventDetail,
    onSuccess: apply,
  });

  const confirm = useMutation({
    mutationFn: async (slotId: string) =>
      (await api.post(`/meeting-events/${id}/confirm`, { slot_id: slotId })).data.data as MeetingEventDetail,
    onSuccess: (d) => {
      apply(d);
      qc.invalidateQueries({ queryKey: ['meeting-events', 'my'] });
    },
  });

  const cancel = useMutation({
    mutationFn: async () => (await api.post(`/meeting-events/${id}/cancel`)).data.data as MeetingEventDetail,
    onSuccess: (d) => {
      apply(d);
      qc.invalidateQueries({ queryKey: ['meeting-events', 'my'] });
    },
  });

  const inviteGuests = useMutation({
    mutationFn: async (guest_ids: string[]) =>
      (await api.post(`/meeting-events/${id}/guests`, { guest_ids })).data.data as MeetingEventDetail,
    onSuccess: apply,
  });

  const postCard = useMutation({
    mutationFn: async (target: { channel_id?: string; dm_conversation_id?: string }) =>
      (await api.post(`/meeting-events/${id}/post-card`, target)).data,
  });

  return { vote, suggest, respondSuggestion, confirm, cancel, inviteGuests, postCard };
}
