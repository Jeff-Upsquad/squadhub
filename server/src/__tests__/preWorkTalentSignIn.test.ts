import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  verifyTalent: vi.fn(),
  ensureMembership: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: mocks.from,
    auth: { admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser } },
  },
}));

vi.mock('../utils/squadhireCredentials', () => ({
  verifySquadhireTalentCredentials: mocks.verifyTalent,
}));

vi.mock('../utils/squadhireTalentSession', () => ({
  ensurePartnerWorkspaceMembership: mocks.ensureMembership,
}));

import { provisionPreWorkTalentPartner } from '../utils/squadhireTalentSelfSignIn';

/** Captures the row the util inserts into `users`. */
let inserted: Record<string, any> | null = null;

function installDb() {
  inserted = null;
  const builder: any = {
    insert: vi.fn(async (value: Record<string, any>) => {
      inserted = value;
      return { error: null };
    }),
  };
  mocks.from.mockReturnValue(builder);
}

// A fresh email per test: the util throttles verification per email, and the
// bucket is module state shared across the file.
let seq = 0;
const nextEmail = () => `talent-${++seq}@example.com`;

describe('pre-work talent sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDb();
    mocks.createUser.mockResolvedValue({ data: { user: { id: 'partner-1' } }, error: null });
    mocks.deleteUser.mockResolvedValue({ data: {}, error: null });
    mocks.ensureMembership.mockResolvedValue(undefined);
    mocks.verifyTalent.mockResolvedValue({
      talent_user_id: 'talent-1',
      email: 'talent@example.com',
      phone: '+911234567890',
      name: 'Talent One',
    });
  });

  it('creates a Discover-only partner with the password SquadHire verified', async () => {
    const email = nextEmail();
    const seeded = await provisionPreWorkTalentPartner({ email, password: 'their-squadhire-pw' });

    expect(seeded).toBe(true);
    expect(mocks.verifyTalent).toHaveBeenCalledWith({ email, password: 'their-squadhire-pw' });
    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email, password: 'their-squadhire-pw', email_confirm: true }),
    );
    // Work stays locked until a card is assigned.
    expect(inserted).toMatchObject({ user_type: 'partner', status: 'active', work_unlocked_at: null });
    expect(mocks.ensureMembership).toHaveBeenCalledWith('partner-1', null);
  });

  it('creates nothing when SquadHire does not recognise the credentials', async () => {
    mocks.verifyTalent.mockResolvedValue(null);

    const seeded = await provisionPreWorkTalentPartner({
      email: nextEmail(),
      password: 'wrong',
    });

    expect(seeded).toBe(false);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it('asks for a sign-in retry when the account was created concurrently', async () => {
    mocks.createUser.mockResolvedValue({
      data: null,
      error: { message: 'A user with this email address has already been registered' },
    });

    const seeded = await provisionPreWorkTalentPartner({
      email: nextEmail(),
      password: 'their-squadhire-pw',
    });

    expect(seeded).toBe(true);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('rolls the auth user back when the profile row cannot be written', async () => {
    mocks.from.mockReturnValue({
      insert: vi.fn(async () => ({ error: { message: 'boom' } })),
    } as any);

    const seeded = await provisionPreWorkTalentPartner({
      email: nextEmail(),
      password: 'their-squadhire-pw',
    });

    expect(seeded).toBe(false);
    expect(mocks.deleteUser).toHaveBeenCalledWith('partner-1');
  });

  it('stops verifying against SquadHire after repeated attempts on one email', async () => {
    const email = nextEmail();
    mocks.verifyTalent.mockResolvedValue(null);

    for (let i = 0; i < 8; i++) {
      await provisionPreWorkTalentPartner({ email, password: `guess-${i}` });
    }
    expect(mocks.verifyTalent).toHaveBeenCalledTimes(8);

    const throttled = await provisionPreWorkTalentPartner({ email, password: 'guess-9' });
    expect(throttled).toBe(false);
    expect(mocks.verifyTalent).toHaveBeenCalledTimes(8);
  });
});
