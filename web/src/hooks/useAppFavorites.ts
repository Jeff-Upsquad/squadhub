import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { AppFavorite } from '@squadhub/shared';

const QUERY_KEY = ['app-favorites'];

/** Pinned app slugs for the current user, synced server-side (cross-browser). */
export function useAppFavorites() {
  return useQuery<string[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await api.get('/app-favorites');
      return (res.data.data as AppFavorite[]).map((f) => f.app_slug);
    },
  });
}

/**
 * Toggle a pin. Pass the app's current pinned state so we know whether to add
 * or remove; the slug list is updated optimistically for instant feedback.
 */
export function useToggleAppFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ slug, favorited }: { slug: string; favorited: boolean }) => {
      if (favorited) {
        await api.delete(`/app-favorites/${slug}`);
      } else {
        await api.post('/app-favorites', { app_slug: slug });
      }
    },
    onMutate: async ({ slug }) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const prev = qc.getQueryData<string[]>(QUERY_KEY) ?? [];
      const next = prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : [...prev, slug];
      qc.setQueryData(QUERY_KEY, next);
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(QUERY_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

// Legacy client-only store key (Zustand persist). One-time migration only.
const LEGACY_KEY = 'squadhub-app-favorites';
let migrated = false;

/**
 * One-time backfill of pins that were saved client-side (localStorage) before
 * app favorites became server-backed, so existing users don't lose them. Runs
 * once per app load, then clears the legacy key. Safe to call repeatedly.
 */
export function useMigrateLocalAppFavorites(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || migrated) return;
    migrated = true;

    let slugs: string[] = [];
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return;
      slugs = JSON.parse(raw)?.state?.favorites ?? [];
    } catch {
      localStorage.removeItem(LEGACY_KEY);
      return;
    }

    if (!Array.isArray(slugs) || slugs.length === 0) {
      localStorage.removeItem(LEGACY_KEY);
      return;
    }

    (async () => {
      const results = await Promise.allSettled(
        slugs.map((slug) => api.post('/app-favorites', { app_slug: slug })),
      );
      // Only retire the legacy key once every pin made it to the server, so a
      // transient failure leaves the data to retry on the next load.
      if (results.every((r) => r.status === 'fulfilled')) {
        localStorage.removeItem(LEGACY_KEY);
      } else {
        migrated = false;
      }
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    })();
  }, [enabled, qc]);
}
