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

// Returns true for both partner and partner_employee — they share access.
export function useIsPartner(): boolean {
  const t = useUserType();
  return t === 'partner' || t === 'partner_employee';
}

export function useIsPartnerEmployee(): boolean {
  return useUserType() === 'partner_employee';
}
