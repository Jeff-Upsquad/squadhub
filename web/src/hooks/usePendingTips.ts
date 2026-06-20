import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { PendingFeatureTip } from '@squadhub/shared';

// Polls the server for the current user's pending Feature Tips. The server does
// all the eligibility math (audience, accept, 3h snooze, revision), so the
// client just renders whatever comes back. Polling picks up freshly-triggered
// tips and snooze re-surfacing; the socket 'feature_tips_changed' event makes
// triggers near-instant (handled in MainLayout via query invalidation).
export function usePendingTips(enabled = true) {
  return useQuery<PendingFeatureTip[]>({
    queryKey: ['feature-tips', 'pending'],
    queryFn: async () => {
      const res = await api.get('/feature-tips/pending');
      return (res.data?.data ?? []) as PendingFeatureTip[];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled,
  });
}
