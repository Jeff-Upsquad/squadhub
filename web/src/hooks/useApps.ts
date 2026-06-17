import { useMemo } from 'react';
import { APPS, type AppDef } from '../config/apps';
import { useMyMiniApps } from './useMiniApps';

/**
 * Apps the current user can access, in registry order. Visibility mirrors the
 * old hardcoded sidebar buttons: an app shows only when the user's mini-app
 * access (GET /mini-apps/my) includes its slug.
 */
export function useAvailableApps(): AppDef[] {
  const { data } = useMyMiniApps();
  return useMemo(() => {
    const slugs = new Set((data ?? []).map((a) => a.slug));
    return APPS.filter((a) => slugs.has(a.slug));
  }, [data]);
}
