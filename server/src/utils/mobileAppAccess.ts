import type { UserType } from '@squadhub/shared';

export type MobileAppKey = 'internal' | 'partner' | 'business';

export interface MobileAppDestination {
  key: MobileAppKey;
  name: string;
  download_url: string;
}

const MOBILE_APPS: Record<MobileAppKey, MobileAppDestination> = {
  internal: {
    key: 'internal',
    name: 'SquadHub Internal',
    download_url: 'https://squadhub.in/internal-app',
  },
  partner: {
    key: 'partner',
    name: 'SquadHub Partner',
    download_url: 'https://squadhub.in/partner-app',
  },
  business: {
    key: 'business',
    name: 'Squad Hub Business',
    download_url: 'https://squadhub.in/business-app',
  },
};

/** Resolve the only mobile app a user type is allowed to enter. */
export function mobileAppForUserType(userType: UserType): MobileAppDestination {
  if (userType === 'internal') return MOBILE_APPS.internal;
  if (userType === 'partner' || userType === 'partner_employee') return MOBILE_APPS.partner;
  return MOBILE_APPS.business;
}

