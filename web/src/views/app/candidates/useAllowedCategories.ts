import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';

/**
 * Candidate categories the current user may access (Creative / Accountant /
 * Sales). The server returns the full set for unrestricted users/admins, or a
 * narrowed list for users scoped via candidate_category_access.
 */
export function useAllowedCategories() {
  return useQuery<string[]>({
    queryKey: ['candidate-categories'],
    queryFn: async () => (await api.get('/candidates/categories')).data.categories ?? [],
    staleTime: 60_000,
  });
}
