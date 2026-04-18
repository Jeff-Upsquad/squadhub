import RequestsTab from './RequestsTab';
import type { RequestRowData } from '../atoms/RequestRow';

export default function CompletedTab({
  requests,
  onOpenRequest,
}: {
  requests: RequestRowData[];
  onOpenRequest: (r: RequestRowData) => void;
}) {
  return (
    <RequestsTab
      requests={requests.filter((r) => r._derivedStatus === 'done')}
      onOpenRequest={onOpenRequest}
      filterStatus="done"
    />
  );
}
