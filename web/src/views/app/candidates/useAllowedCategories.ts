import { useQuery } from '@tanstack/react-query';
import type { CandidateAccessMap } from '@squadhub/shared';
import api from '../../../services/api';

/**
 * Candidate categories the current user may access (Creative / Accountant /
 * Sales), each mapped to their permission tier (view / edit / full). Admins get
 * all three at 'full'; everyone else gets only their granted categories. An
 * empty map means no access (deny-by-default).
 */
export function useAllowedCategories() {
  return useQuery<CandidateAccessMap>({
    queryKey: ['candidate-categories'],
    queryFn: async () => (await api.get('/candidates/categories')).data.categories ?? {},
    staleTime: 60_000,
  });
}
