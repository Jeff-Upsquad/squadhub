import ConnectBriefForm from '../ConnectBriefForm';

// Public freelance Assignment brief form — project scope, budget & timeline
// instead of a weekly plan. Submits with card_type: 'assignment' so the card
// flows through the same All Deals pipeline but lands as a freelance deal.
export default function ConnectAssignmentPage() {
  return <ConnectBriefForm product="assignment" />;
}
