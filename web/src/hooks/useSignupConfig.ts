'use client';

import { useEffect, useState } from 'react';
import api from '../services/api';

/**
 * Whether self-serve signup is open (server env PUBLIC_SIGNUP_ENABLED).
 * Phase 1: closed — SquadHub accounts come from SquadHire. `null` while
 * loading; callers treat anything but `true` as closed so the signup link
 * never flashes in.
 */
export const SIGNUP_CLOSED_MESSAGE =
  'SquadHub accounts are created through SquadHire. Open SquadHub from your SquadHire account to sign in.';

let cached: Promise<boolean> | null = null;

function load(): Promise<boolean> {
  if (!cached) {
    cached = api
      .get('/auth/signup-config')
      .then((r) => r.data?.data?.public_signup_enabled === true)
      .catch(() => {
        cached = null; // retry on the next mount
        return false;
      });
  }
  return cached;
}

export function useSignupOpen(): boolean | null {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    load().then((v) => {
      if (alive) setOpen(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return open;
}
