import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { ClientSpaceTemplate } from '@squadhub/shared';

export function useAvailableClientSpaceTemplates() {
  return useQuery<ClientSpaceTemplate[]>({
    queryKey: ['available-client-space-templates'],
    queryFn: async () => {
      const res = await api.get('/client-spaces/available');
      return res.data.data;
    },
  });
}
