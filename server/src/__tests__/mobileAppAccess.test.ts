import { describe, expect, it } from 'vitest';
import { mobileAppForUserType } from '../utils/mobileAppAccess';

describe('mobileAppForUserType', () => {
  it('routes Internal users, including role-based Admins and Managers, to Internal', () => {
    expect(mobileAppForUserType('internal')).toEqual({
      key: 'internal',
      name: 'SquadHub Internal',
      download_url: 'https://squadhub.in/internal-app',
    });
  });

  it.each(['partner', 'partner_employee'] as const)('routes %s to Partner', (userType) => {
    expect(mobileAppForUserType(userType).key).toBe('partner');
  });

  it.each(['client', 'client_staff'] as const)('routes %s to Business', (userType) => {
    expect(mobileAppForUserType(userType).key).toBe('business');
  });
});

