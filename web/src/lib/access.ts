import type { AccessLevel } from '@squadhub/shared';

const ORDER: AccessLevel[] = ['viewer', 'commenter', 'member', 'manager'];

export function canAtLeast(userLevel: AccessLevel | undefined | null, required: AccessLevel): boolean {
  if (!userLevel) return false;
  return ORDER.indexOf(userLevel) >= ORDER.indexOf(required);
}
