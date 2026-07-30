import AccountantBriefForm from '../AccountantBriefForm';

// Public accountant freelance Assignment brief form — one-off project scope,
// budget & timeline instead of a weekly plan. Submits with card_type:
// 'assignment' so the accountant card flows through the same All Deals pipeline
// but lands as a freelance deal.
export default function AccountantConnectAssignmentPage() {
  return <AccountantBriefForm product="assignment" />;
}
