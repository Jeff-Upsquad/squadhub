import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

interface SquadhireConfig {
  admin_url: string | null;
  configured: boolean;
}

export function useSquadhireConfig() {
  const { data, isLoading } = useQuery({
    queryKey: ['squadhire-config'],
    queryFn: () =>
      api.get('/admin/integrations/squadhire/config').then(
        (r) => r.data?.data as SquadhireConfig,
      ),
    staleTime: Infinity,
  });

  return {
    adminUrl: data?.admin_url ?? null,
    configured: data?.configured ?? false,
    isLoading,
  };
}

export function useSquadhireUserLookup(emails: string[], enabled: boolean) {
  const { data, isLoading } = useQuery({
    queryKey: ['squadhire-user-lookup', emails.sort().join(',')],
    queryFn: () =>
      api
        .post('/admin/integrations/squadhire/lookup-users', { emails })
        .then((r) => r.data?.data as Record<string, { talent_user_id: string; name: string }>),
    enabled: enabled && emails.length > 0,
    staleTime: 2 * 60 * 1000,
  });

  return { matches: data ?? {}, isLoading };
}
