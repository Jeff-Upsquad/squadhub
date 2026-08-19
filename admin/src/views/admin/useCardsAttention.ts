import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

/**
 * Requirement Cards sidebar badge — how much of the pipeline is waiting on us.
 *
 * Counted server-side (GET /admin/cards/attention) rather than with
 * useLeadBadges: a sidebar is mounted on every page, and the client-side
 * version pulls eight hydrated card lists to get there. Squad CRM reads the
 * same endpoint through its own proxy, so all three sidebars agree.
 *
 * Lives in admin/src because both apps that render it resolve `@` here — the
 * admin panel directly, the web app through its admin/src fallback root.
 */

export type AttentionBadge = { total: number; parts: string[] };

export type CardsAttention = AttentionBadge & {
  by_pipeline: Record<'subscription-cards' | 'assignments' | 'job-cards', AttentionBadge>;
};

const EMPTY: CardsAttention = {
  total: 0,
  parts: [],
  by_pipeline: {
    'subscription-cards': { total: 0, parts: [] },
    assignments: { total: 0, parts: [] },
    'job-cards': { total: 0, parts: [] },
  },
};

export function useCardsAttention(enabled = true): CardsAttention {
  const { data } = useQuery({
    queryKey: ['cards-attention'],
    queryFn: () => api.get('/admin/cards/attention').then((r) => r.data),
    enabled,
    // A new brief showing up within a minute is soon enough for a badge, and
    // this runs on every page — no reason to poll harder.
    staleTime: 60_000,
    refetchInterval: 120_000,
    // Users without the leads app get a 403; one failed call is the answer,
    // not something to retry on every page.
    retry: false,
  });

  return (data?.data as CardsAttention) || EMPTY;
}
