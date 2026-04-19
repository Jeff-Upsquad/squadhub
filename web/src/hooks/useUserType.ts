import { useAuthStore } from '../stores/authStore';
import type { UserType } from '@squadhub/shared';

export function useUserType(): UserType {
  const user = useAuthStore((s) => s.user);
  return user?.user_type ?? 'internal';
}

export function useIsInternal(): boolean {
  return useUserType() === 'internal';
}

// Returns true for both primary client contacts and client-side team members.
export function useIsClient(): boolean {
  const t = useUserType();
  return t === 'client' || t === 'client_staff';
}

export function useIsClientStaff(): boolean {
  return useUserType() === 'client_staff';
}

export function useIsPartner(): boolean {
  return useUserType() === 'partner';
}
