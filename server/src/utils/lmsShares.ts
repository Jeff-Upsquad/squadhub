import { createHash } from 'crypto';
import { LMS_SHARE_USER_TYPES, lmsUserTypeMeta } from '@squadhub/shared';
import type { UserType } from '@squadhub/shared';

// ============================================================
// User-type share principals (migration 179)
//
// A share row with principal_type='user_type' targets every user of that
// user_type. principal_id stores a deterministic UUID derived from the key so
// the existing UUID column + UNIQUE(item_id, principal_type, principal_id)
// keep working. All key<->UUID mapping lives here.
// ============================================================

/** The deterministic UUID a user-type share stores for `key`. */
export function userTypeShareKeyToUuid(key: UserType): string {
  return createHash('md5').update(`user_type:${key}`).digest('hex').replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12})$/,
    '$1-$2-$3-$4-$5',
  );
}

/** Reverse of userTypeShareKeyToUuid — the key for a stored principal_id, if known. */
export function userTypeShareUuidToKey(principalId: string): UserType | null {
  const lower = principalId.toLowerCase();
  for (const t of LMS_SHARE_USER_TYPES) {
    if (userTypeShareKeyToUuid(t.value).toLowerCase() === lower) return t.value;
  }
  return null;
}

/** True when `id` is a valid user-type share principal_id. */
export function isUserTypeShareUuid(principalId: string): boolean {
  return userTypeShareUuidToKey(principalId) !== null;
}

/** Display label for a user-type key (e.g. 'internal' -> 'Internal'). */
export function userTypeShareKeyToLabel(key: string): string {
  return lmsUserTypeMeta(key)?.label ?? key;
}
