/**
 * Work access for partner accounts.
 *
 * A SquadHire talent can now sign in to the Partner app before they have any
 * work (see squadhireTalentSelfSignIn). Those accounts exist so Discover can
 * bring them their first opportunity, and nothing else: until a card is
 * assigned to them, `users.work_unlocked_at` is NULL and the app shows the
 * Work side locked.
 *
 * Two things keep that honest rather than cosmetic:
 *
 *   • Every work surface in SquadHub is membership-scoped (spaces, lists,
 *     channels and DMs all resolve through resource_memberships), and a
 *     pre-work partner holds no memberships — so Work is empty by
 *     construction, not by the UI hiding it.
 *   • The two places that ignore memberships and would otherwise expose the
 *     whole roster to anyone with an account — the global user search and
 *     starting a DM — check isUserWorkLocked() here.
 *
 * Unlocking is a one-way stamp done where the entitlement is created: the
 * assignment callback from SquadHire (routes/integrations/squadhire-callbacks)
 * and the talent SSO hand-off, both of which only fire for a talent with a
 * live assigned card. resolveWorkAccess adds a backstop for work that arrives
 * by any other route, so the lock can never outlive the thing it's waiting for.
 */

import { PARTNER_USER_TYPES } from '@squadhub/shared';
import type { UserType } from '@squadhub/shared';
import { supabaseAdmin } from '../supabase';

type WorkAccessProfile = {
  id?: unknown;
  user_type?: string | null;
  work_unlocked_at?: string | null;
};

/** Does this user type ever get locked? Only partner-side accounts do. */
function isPartnerType(userType: string | null | undefined): boolean {
  return !!userType && PARTNER_USER_TYPES.includes(userType as UserType);
}

/** True when this profile row is a partner who has no work yet. */
export function isProfileWorkLocked(profile: WorkAccessProfile | null | undefined): boolean {
  if (!profile || !isPartnerType(profile.user_type)) return false;
  return !profile.work_unlocked_at;
}

/**
 * The lock a client is told about, with the backstop applied.
 *
 * Clients could derive the flag from work_unlocked_at, but an explicit boolean
 * means an older client that doesn't know the field reads `false` (unlocked)
 * rather than guessing, and native models can decode it with a safe default.
 *
 * The backstop: a partner who holds access to a work container has work,
 * whatever route it arrived by (a job placement, an admin adding them to a
 * client space), so the stamp is applied and they're unlocked from here on.
 *
 * Only container memberships count. A channel membership doesn't: the support
 * channel is created for anyone who opens support, including a talent who has
 * never worked a day.
 */
export async function resolveWorkAccess<T extends WorkAccessProfile>(
  profile: T | null | undefined,
): Promise<(T & { work_locked: boolean }) | null> {
  if (!profile) return null;
  if (!isProfileWorkLocked(profile)) return { ...profile, work_locked: false };

  const userId = String(profile.id ?? '');
  if (!userId) return { ...profile, work_locked: true };

  const { data, error } = await supabaseAdmin
    .from('resource_memberships')
    .select('id')
    .eq('user_id', userId)
    .in('resource_type', ['space', 'folder', 'list'])
    .limit(1);
  if (error || !data?.length) return { ...profile, work_locked: true };

  await unlockPartnerWork(userId, 'holds work container access');
  return { ...profile, work_locked: false, work_unlocked_at: new Date().toISOString() };
}

/** Look the lock up by id — for request paths that only have req.userId. */
export async function isUserWorkLocked(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('user_type, work_unlocked_at')
    .eq('id', userId)
    .maybeSingle();
  // Fail open: a lookup failure must not lock a partner out of their own work.
  if (error || !data) return false;
  const resolved = await resolveWorkAccess({ ...data, id: userId });
  return resolved?.work_locked === true;
}

/**
 * Give a partner the Work surface, once. Idempotent, and never un-stamps: the
 * date is the first time they had work, not the latest.
 */
export async function unlockPartnerWork(userId: string, reason: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ work_unlocked_at: new Date().toISOString() })
    .eq('id', userId)
    .is('work_unlocked_at', null)
    .select('id');
  if (error) {
    // Worth knowing about, but it must not fail the assignment that triggered
    // it — the next provision/SSO pass stamps it again.
    console.error(`[work-access] could not unlock work for ${userId}:`, error.message);
    return;
  }
  if (data?.length) console.log(`[work-access] unlocked Work for ${userId} (${reason})`);
}
