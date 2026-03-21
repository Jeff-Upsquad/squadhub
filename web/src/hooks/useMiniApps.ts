import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { MiniApp } from '@squadhub/shared';

export function useMyMiniApps() {
  return useQuery<MiniApp[]>({
    queryKey: ['my-mini-apps'],
    queryFn: async () => {
      const res = await api.get('/mini-apps/my');
      return res.data.data;
    },
    staleTime: 60_000,
  });
}

export function useHasMiniApp(slug: string): boolean {
  const { data } = useMyMiniApps();
  return data?.some((app) => app.slug === slug) ?? false;
}
