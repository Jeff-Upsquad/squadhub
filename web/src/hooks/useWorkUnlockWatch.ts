'use client';

/**
 * Keep a locked partner's profile fresh so Work appears the moment it's theirs.
 *
 * The cached user is written at sign-in and otherwise left alone, which is fine
 * for everything on it except this one flag: a talent sitting in Discover gets
 * assigned their first card minutes later, and the app has to open Work without
 * asking them to sign out and back in.
 *
 * So while — and only while — Work is locked, re-read the profile every minute
 * and swap it into the store. Once unlocked the query is disabled and this costs
 * nothing for everyone else.
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { User } from '@squadhub/shared';
import { useAuthStore } from '../stores/authStore';
import api from '../services/api';

export function useWorkUnlockWatch(locked: boolean): void {
  const setUser = useAuthStore((s) => s.setUser);

  const { data } = useQuery({
    queryKey: ['work-access-profile'],
    queryFn: () => api.get('/users/me').then((r) => r.data?.data as User | undefined),
    enabled: locked,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!data?.id) return;
    if (data.work_locked === false) setUser(data);
  }, [data, setUser]);
}
