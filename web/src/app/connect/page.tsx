import ConnectBriefForm from './ConnectBriefForm';

// Public subscription brief form (the recurring-plan path). The form body lives
// in ConnectBriefForm, shared with the freelance variant at /connect/assignment.
export default function ConnectPage() {
  return <ConnectBriefForm product="subscription" />;
}
