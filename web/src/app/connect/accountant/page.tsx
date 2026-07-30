import AccountantBriefForm from './AccountantBriefForm';

// Public accountant subscription brief form (the recurring-plan path). The form
// body lives in AccountantBriefForm, shared with the assignment variant at
// /connect/accountant/assignment.
export default function AccountantConnectPage() {
  return <AccountantBriefForm product="subscription" />;
}
