import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  createUser: vi.fn(),
  listUsers: vi.fn(),
  deleteUser: vi.fn(),
  syncSpaces: vi.fn(),
  defaultRole: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: mocks.from,
    auth: { admin: {
      createUser: mocks.createUser,
      listUsers: mocks.listUsers,
      deleteUser: mocks.deleteUser,
    } },
  },
  supabase: {},
  supabaseAuth: {},
}));
vi.mock('../utils/activatedClientSpaces', () => ({
  syncTalentActivatedClientSpaces: mocks.syncSpaces,
}));
vi.mock('../utils/defaultRole', () => ({
  getDefaultRoleIdForUserType: mocks.defaultRole,
}));

import { ensureSquadhireTalentProvisioned } from '../utils/squadhireTalentSession';

type TestState = {
  user: Record<string, any> | null;
  member: Record<string, any> | null;
};

function installDb(state: TestState) {
  mocks.from.mockImplementation((table: string) => {
    const filters: Record<string, unknown> = {};
    let inserted: Record<string, any> | null = null;
    const builder: any = {
      select: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      ilike: vi.fn((column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      }),
      eq: vi.fn((column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      }),
      insert: vi.fn(async (value: Record<string, any>) => {
        inserted = value;
        if (table === 'users') state.user = { ...value };
        if (table === 'workspace_members') state.member = { id: 'member-1', ...value };
        return { error: null };
      }),
      single: vi.fn(async () => {
        if (table === 'workspaces') return { data: { id: 'workspace-1' }, error: null };
        return { data: inserted, error: null };
      }),
      maybeSingle: vi.fn(async () => {
        if (table === 'users') {
          if (filters.id && state.user?.id !== filters.id) return { data: null, error: null };
          return { data: state.user, error: null };
        }
        if (table === 'workspace_members') return { data: state.member, error: null };
        return { data: null, error: null };
      }),
    };
    return builder;
  });
}

const identity = {
  talent_user_id: 'talent-1',
  email: 'talent@example.com',
  name: 'Talent One',
  phone: null,
  category_slug: null,
};

describe('assignment-time SquadHire talent provisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createUser.mockResolvedValue({
      data: { user: { id: 'partner-1' } },
      error: null,
    });
    mocks.deleteUser.mockResolvedValue({ data: {}, error: null });
    mocks.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
    mocks.defaultRole.mockResolvedValue('role-partner');
    mocks.syncSpaces.mockResolvedValue(undefined);
  });

  it('creates the partner, workspace membership, and assigned-client access', async () => {
    const state: TestState = { user: null, member: null };
    installDb(state);

    const result = await ensureSquadhireTalentProvisioned(identity, { strictAccessSync: true });

    expect(result.created).toBe(true);
    expect(result.user).toMatchObject({ id: 'partner-1', user_type: 'partner' });
    expect(state.member).toMatchObject({
      workspace_id: 'workspace-1',
      user_id: 'partner-1',
      role: 'member',
      role_id: 'role-partner',
    });
    expect(mocks.syncSpaces).toHaveBeenCalledWith({
      talentUserId: 'talent-1',
      squadhubUserId: 'partner-1',
    });
  });

  it('reuses an existing partner and repairs missing workspace membership', async () => {
    const state: TestState = {
      user: { id: 'partner-1', email: identity.email, user_type: 'partner', status: 'active' },
      member: null,
    };
    installDb(state);

    const result = await ensureSquadhireTalentProvisioned(identity, { strictAccessSync: true });

    expect(result.created).toBe(false);
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(state.member).toMatchObject({ user_id: 'partner-1' });
    expect(mocks.syncSpaces).toHaveBeenCalledOnce();
  });

  it('repairs a legacy auth-only talent instead of failing on duplicate email', async () => {
    const state: TestState = { user: null, member: null };
    installDb(state);
    mocks.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'A user with this email address has already been registered' },
    });
    mocks.listUsers.mockResolvedValue({
      data: { users: [{ id: 'orphan-auth-1', email: identity.email }] },
      error: null,
    });

    const result = await ensureSquadhireTalentProvisioned(identity, { strictAccessSync: true });

    expect(result.created).toBe(true);
    expect(result.user).toMatchObject({ id: 'orphan-auth-1', user_type: 'partner' });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it('refuses to convert an existing non-partner account', async () => {
    installDb({
      user: { id: 'client-1', email: identity.email, user_type: 'client', status: 'active' },
      member: null,
    });

    await expect(
      ensureSquadhireTalentProvisioned(identity, { strictAccessSync: true }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.syncSpaces).not.toHaveBeenCalled();
  });
});
