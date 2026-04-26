'use client';

import { useEffect, useRef, useState } from 'react';
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
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

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

  // Close on outside click + escape
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

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

  const selected = categories.filter((c) => mappingByCategoryId[c.id]);
  const selectedLabel =
    selected.length === 0
      ? 'Pick categories…'
      : selected.length <= 3
        ? selected.map((c) => c.name).join(', ')
        : `${selected.length} categories selected`;

  return (
    <div ref={wrapperRef} className="relative inline-block w-full max-w-md">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm transition ${
          open
            ? 'border-[#0F172B] shadow-sm'
            : 'border-[#E2E8F0] hover:border-[#CBD5E1]'
        }`}
      >
        <span className={`truncate ${selected.length === 0 ? 'text-[#90A1B9]' : 'text-[#0F172B]'}`}>
          {selectedLabel}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-[#62748E] transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-10 mt-1 max-h-72 overflow-y-auto rounded-md border border-[#E2E8F0] bg-white py-1 shadow-lg">
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[#0F172B] transition hover:bg-[#F8FAFC] disabled:opacity-60"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    on ? 'border-[#0F172B] bg-[#0F172B] text-white' : 'border-[#CBD5E1] bg-white'
                  }`}
                >
                  {on && (
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </span>
                <span className="truncate">{cat.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
