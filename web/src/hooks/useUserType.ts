import { useAuthStore } from '../stores/authStore';
import type { UserType } from '@squadhub/shared';

export function useUserType(): UserType {
  const user = useAuthStore((s) => s.user);
  return user?.user_type ?? 'internal';
}

export function useIsInternal(): boolean {
  return useUserType() === 'internal';
}

export function useIsClient(): boolean {
  return useUserType() === 'client';
}

export function useIsPartner(): boolean {
  return useUserType() === 'partner';
}
