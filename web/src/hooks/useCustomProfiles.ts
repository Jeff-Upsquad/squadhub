import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { CustomProfile } from '@squadhub/shared';

export function useAvailableProfiles(targetType: 'folder' | 'list') {
  return useQuery<CustomProfile[]>({
    queryKey: ['custom-profiles', 'available', targetType],
    queryFn: async () => {
      const res = await api.get(`/pm/custom-profiles/available?target_type=${targetType}`);
      return res.data.data;
    },
  });
}
