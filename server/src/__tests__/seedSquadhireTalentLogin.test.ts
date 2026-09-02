import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUserById: vi.fn(),
  updateUserById: vi.fn(),
  verifyBusiness: vi.fn(),
  verifyTalent: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: mocks.from,
    auth: { admin: {
      getUserById: mocks.getUserById,
      updateUserById: mocks.updateUserById,
    } },
  },
}));

vi.mock('../utils/squadhireCredentials', () => ({
  verifySquadhireBusinessCredentials: mocks.verifyBusiness,
  verifySquadhireTalentCredentials: mocks.verifyTalent,
}));

vi.mock('../utils/applyInvitation', () => ({
  applyAcceptedInvitation: vi.fn(),
  INVITATION_COLUMNS: 'id',
}));

import { seedSquadhireClientLogin } from '../utils/seedSquadhireClientLogin';

describe('SquadHire talent password adoption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const builder: any = {
      select: vi.fn(() => builder),
      ilike: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => ({
        data: { id: 'partner-1', user_type: 'partner' },
        error: null,
      })),
    };
    mocks.from.mockReturnValue(builder);
    mocks.getUserById.mockResolvedValue({
      data: {
        user: {
          id: 'partner-1',
          user_metadata: { squadhire_password_pending: true },
        },
      },
      error: null,
    });
    mocks.updateUserById.mockResolvedValue({ data: { user: {} }, error: null });
    mocks.verifyTalent.mockResolvedValue({
      talent_user_id: 'talent-1',
      email: 'talent@example.com',
      phone: null,
      name: 'Talent One',
    });
  });

  it('verifies a partner with SquadHire and adopts the typed password once', async () => {
    const adopted = await seedSquadhireClientLogin({
      email: 'talent@example.com',
      password: 'same-password',
    });

    expect(adopted).toBe(true);
    expect(mocks.verifyTalent).toHaveBeenCalledWith({
      email: 'talent@example.com',
      password: 'same-password',
    });
    expect(mocks.verifyBusiness).not.toHaveBeenCalled();
    expect(mocks.updateUserById).toHaveBeenCalledWith('partner-1', {
      password: 'same-password',
      user_metadata: { squadhire_password_pending: false },
    });
  });
});
