import { useQuery } from '@tanstack/react-query';
// Import via the '@' alias, not a relative path. This hook is also compiled by
// the web app (the Leads mini app renders these modules), where '@' resolves to
// web/src so each app injects its own api client. A relative path would always
// bind to admin's client and send requests to admin's '/api' base URL.
import api from '@/services/api';

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
