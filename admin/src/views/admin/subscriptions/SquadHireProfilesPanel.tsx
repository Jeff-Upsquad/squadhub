'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../services/api';

interface SquadHireCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

interface ProfileMapping {
  id: string;
  subscription_id: string;
  squadhire_category_id: string;
  created_at: string;
}

export default function SquadHireProfilesPanel({ subscriptionId }: { subscriptionId: string }) {
  const queryClient = useQueryClient();

  const { data: catRes, error: catError } = useQuery({
    queryKey: ['squadhire-categories'],
    queryFn: () =>
      api.get('/admin/integrations/squadhire/categories').then((r) => r.data),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const categories: SquadHireCategory[] = catRes?.data || [];

  const { data: mapRes, isLoading: loadingMap } = useQuery({
    queryKey: ['subscription-squadhire-profiles', subscriptionId],
    queryFn: () =>
      api.get(`/admin/subscriptions/${subscriptionId}/squadhire-profiles`).then((r) => r.data),
  });
  const mappings: ProfileMapping[] = mapRes?.data || [];
  const mappingByCategoryId: Record<string, ProfileMapping> = {};
  mappings.forEach((m) => {
    mappingByCategoryId[m.squadhire_category_id] = m;
  });

  const addMapping = useMutation({
    mutationFn: (squadhire_category_id: string) =>
      api.post(`/admin/subscriptions/${subscriptionId}/squadhire-profiles`, {
        squadhire_category_id,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['subscription-squadhire-profiles', subscriptionId],
      }),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed'),
  });

  const removeMapping = useMutation({
    mutationFn: (mappingId: string) =>
      api.delete(`/admin/subscriptions/${subscriptionId}/squadhire-profiles/${mappingId}`),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['subscription-squadhire-profiles', subscriptionId],
      }),
    onError: (err: any) => alert(err?.response?.data?.error || err.message || 'Failed'),
  });

  if (catError) {
    return (
      <p className="text-xs text-red-600">
        Could not load SquadHire categories. Check that the SquadHire webhook URL
        is configured on the server.
      </p>
    );
  }
  if (categories.length === 0 || loadingMap) {
    return <p className="text-xs text-[#90A1B9]">Loading…</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((cat) => {
        const existing = mappingByCategoryId[cat.id];
        const on = !!existing;
        const pending =
          (addMapping.isPending && addMapping.variables === cat.id) ||
          (removeMapping.isPending && existing && removeMapping.variables === existing.id);
        return (
          <button
            key={cat.id}
            type="button"
            disabled={pending}
            title={cat.description || cat.slug}
            onClick={() => {
              if (on && existing) removeMapping.mutate(existing.id);
              else addMapping.mutate(cat.id);
            }}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-60 ${
              on
                ? 'border-[#0F172B] bg-[#0F172B] text-white'
                : 'border-[#E2E8F0] bg-white text-[#475569] hover:border-[#CBD5E1]'
            }`}
          >
            {cat.name}
          </button>
        );
      })}
    </div>
  );
}
