import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('../supabase', () => ({ supabaseAdmin: { from: mocks.from } }));

import { isProfileWorkLocked, resolveWorkAccess } from '../utils/workAccess';

/** Minimal PostgREST stand-in: memberships list + the unlock UPDATE. */
function installDb(options: { memberships: Array<{ resource_type: string }> }) {
  const updates: Array<Record<string, any>> = [];
  mocks.from.mockImplementation((table: string) => {
    const types: string[] = [];
    let isUpdate = false;
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      in: vi.fn((_col: string, values: string[]) => {
        types.push(...values);
        return builder;
      }),
      update: vi.fn((value: Record<string, any>) => {
        isUpdate = true;
        updates.push(value);
        return builder;
      }),
      limit: vi.fn(async () => ({
        data: options.memberships.filter((m) => types.includes(m.resource_type)),
        error: null,
      })),
      then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
        resolve({ data: isUpdate && table === 'users' ? [{ id: 'partner-1' }] : [], error: null }),
    };
    return builder;
  });
  return updates;
}

const lockedPartner = { id: 'partner-1', user_type: 'partner', work_unlocked_at: null };

describe('partner work access', () => {
  beforeEach(() => vi.clearAllMocks());

  it('locks only partner accounts that have never had work', () => {
    expect(isProfileWorkLocked(lockedPartner)).toBe(true);
    expect(isProfileWorkLocked({ ...lockedPartner, work_unlocked_at: '2026-01-01T00:00:00Z' })).toBe(false);
    expect(isProfileWorkLocked({ id: 'u', user_type: 'internal', work_unlocked_at: null })).toBe(false);
    expect(isProfileWorkLocked({ id: 'u', user_type: 'client', work_unlocked_at: null })).toBe(false);
  });

  it('keeps a talent with no work locked', async () => {
    const updates = installDb({ memberships: [] });

    const resolved = await resolveWorkAccess(lockedPartner);

    expect(resolved?.work_locked).toBe(true);
    expect(updates).toHaveLength(0);
  });

  it('unlocks a partner who holds access to a work container', async () => {
    const updates = installDb({ memberships: [{ resource_type: 'space' }] });

    const resolved = await resolveWorkAccess(lockedPartner);

    expect(resolved?.work_locked).toBe(false);
    expect(updates).toHaveLength(1);
    expect(updates[0].work_unlocked_at).toBeTruthy();
  });

  it('does not treat a support channel membership as work', async () => {
    const updates = installDb({ memberships: [{ resource_type: 'channel' }] });

    const resolved = await resolveWorkAccess(lockedPartner);

    expect(resolved?.work_locked).toBe(true);
    expect(updates).toHaveLength(0);
  });
});
