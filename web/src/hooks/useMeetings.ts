import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { Meeting } from '@squadhub/shared';

// The current user's scheduled meetings (creator or attendee) that are due
// today or overdue, in the caller's timezone — server-filtered. Powers the
// Home "Meetings" secondary card. Polls like the task summary so the card
// stays fresh without a manual reload.
export function useMyMeetings(enabled = true) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return useQuery<Meeting[]>({
    queryKey: ['meetings', 'my', tz],
    queryFn: async () => {
      const res = await api.get(`/meetings/my?tz=${encodeURIComponent(tz)}`);
      return res.data.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled,
  });
}

export function useMarkMeetingDone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/meetings/${id}/done`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meetings'] });
    },
  });
}

export function useCreateMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      title: string;
      scheduled_at: string;
      duration_min?: number;
      location?: string;
      attendee_ids?: string[];
    }) => api.post('/meetings', body).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meetings'] });
    },
  });
}
