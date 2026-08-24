import { describe, it, expect, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabaseAdmin: {}, supabaseAuth: {}, supabase: {} }));
vi.mock('../middleware/permissions', () => ({ isWorkspaceAdmin: vi.fn() }));
vi.mock('../utils/roles', () => ({ getUserIdsByRoleId: vi.fn() }));

import { canDmPair, dmSide, emptyWorkSet, sharesWork, type DmActor, type DmOther } from '../utils/dmAccess';

function actor(over: Partial<DmActor> & Pick<DmActor, 'id' | 'userType'>): Omit<DmActor, 'work' | 'workspaceId'> {
  return {
    isWorkspaceAdmin: false,
    assignedSquadManagerIds: new Set(),
    ...over,
  };
}

function other(over: Partial<DmOther> & Pick<DmOther, 'id' | 'userType'>): DmOther {
  return { isSquadManager: false, ...over };
}

const DENY = 'You can only message people you share a space or channel with.';

describe('dmSide', () => {
  it('groups client and client_staff', () => {
    expect(dmSide('client')).toBe('client');
    expect(dmSide('client_staff')).toBe('client');
  });
  it('groups partner and partner_employee', () => {
    expect(dmSide('partner')).toBe('partner');
    expect(dmSide('partner_employee')).toBe('partner');
  });
  it('treats internal separately', () => {
    expect(dmSide('internal')).toBe('internal');
  });
});

describe('sharesWork', () => {
  it('matches on any overlapping resource', () => {
    const a = emptyWorkSet();
    a.spaceIds.add('s1');
    const b = emptyWorkSet();
    expect(sharesWork(a, b)).toBe(false);
    b.folderIds.add('f1');
    expect(sharesWork(a, b)).toBe(false);
    b.spaceIds.add('s1');
    expect(sharesWork(a, b)).toBe(true);
  });
});

describe('canDmPair', () => {
  it('blocks DMing yourself', () => {
    const me = actor({ id: 'u1', userType: 'internal', isWorkspaceAdmin: true });
    expect(canDmPair(me, other({ id: 'u1', userType: 'internal' }), true).ok).toBe(false);
  });

  it('lets workspace admins message anyone', () => {
    const me = actor({ id: 'admin', userType: 'internal', isWorkspaceAdmin: true });
    expect(canDmPair(me, other({ id: 'c1', userType: 'client' }), false).ok).toBe(true);
    expect(canDmPair(me, other({ id: 'p1', userType: 'partner' }), false).ok).toBe(true);
  });

  describe('clients', () => {
    const me = actor({
      id: 'client-1',
      userType: 'client',
      assignedSquadManagerIds: new Set(['sm-assigned']),
    });

    it('can DM an assigned Squad Manager without shared work', () => {
      const r = canDmPair(me, other({ id: 'sm-assigned', userType: 'internal', isSquadManager: true }), false);
      expect(r).toEqual({ ok: true });
    });

    it('can DM a Squad Manager on shared work', () => {
      const r = canDmPair(me, other({ id: 'sm-shared', userType: 'internal', isSquadManager: true }), true);
      expect(r).toEqual({ ok: true });
    });

    it('cannot DM a Squad Manager they are not assigned to and do not share work with', () => {
      const r = canDmPair(me, other({ id: 'sm-other', userType: 'internal', isSquadManager: true }), false);
      expect(r).toEqual({ ok: false, reason: DENY });
    });

    it('can DM client staff on shared work', () => {
      const r = canDmPair(me, other({ id: 'staff-1', userType: 'client_staff' }), true);
      expect(r).toEqual({ ok: true });
    });

    it('can DM another client on shared work', () => {
      const r = canDmPair(me, other({ id: 'client-2', userType: 'client' }), true);
      expect(r).toEqual({ ok: true });
    });

    it('cannot DM client staff they do not share work with', () => {
      const r = canDmPair(me, other({ id: 'staff-2', userType: 'client_staff' }), false);
      expect(r.ok).toBe(false);
    });

    it('cannot DM partners or non-manager internals, even on shared work', () => {
      expect(canDmPair(me, other({ id: 'p1', userType: 'partner' }), true).ok).toBe(false);
      expect(canDmPair(me, other({ id: 'i1', userType: 'internal' }), true).ok).toBe(false);
    });
  });

  describe('partners', () => {
    const me = actor({ id: 'partner-1', userType: 'partner' });

    it('can DM a Squad Manager on shared work', () => {
      expect(canDmPair(me, other({ id: 'sm', userType: 'internal', isSquadManager: true }), true).ok).toBe(true);
    });

    it('cannot DM a Squad Manager without shared work', () => {
      expect(canDmPair(me, other({ id: 'sm', userType: 'internal', isSquadManager: true }), false).ok).toBe(false);
    });

    it('can DM other partners / partner employees on shared work', () => {
      expect(canDmPair(me, other({ id: 'p2', userType: 'partner' }), true).ok).toBe(true);
      expect(canDmPair(me, other({ id: 'pe', userType: 'partner_employee' }), true).ok).toBe(true);
    });

    it('cannot DM clients or non-manager internals', () => {
      expect(canDmPair(me, other({ id: 'c1', userType: 'client' }), true).ok).toBe(false);
      expect(canDmPair(me, other({ id: 'i1', userType: 'internal' }), true).ok).toBe(false);
    });
  });

  describe('internals', () => {
    const me = actor({ id: 'internal-1', userType: 'internal' });

    it('can DM anyone they share work with', () => {
      expect(canDmPair(me, other({ id: 'c1', userType: 'client' }), true).ok).toBe(true);
      expect(canDmPair(me, other({ id: 'p1', userType: 'partner' }), true).ok).toBe(true);
      expect(canDmPair(me, other({ id: 'i2', userType: 'internal' }), true).ok).toBe(true);
    });

    it('cannot DM anyone they do not share work with', () => {
      expect(canDmPair(me, other({ id: 'c1', userType: 'client' }), false).ok).toBe(false);
      expect(canDmPair(me, other({ id: 'p1', userType: 'partner' }), false).ok).toBe(false);
      expect(canDmPair(me, other({ id: 'i2', userType: 'internal' }), false).ok).toBe(false);
    });
  });
});
