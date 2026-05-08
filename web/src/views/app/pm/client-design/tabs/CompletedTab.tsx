import type { SpaceStatus } from '@squadhub/shared';
import RequestsTab from './RequestsTab';
import type { RequestRowData } from '../atoms/RequestRow';

export default function CompletedTab({
  requests,
  statuses,
  listByStatus,
}: {
  requests: RequestRowData[];
  statuses: SpaceStatus[];
  listByStatus: Record<string, { id: string; name: string } | null>;
}) {
  return (
    <RequestsTab
      requests={requests.filter((r) => r._derivedStatus === 'done')}
      filterStatus="done"
      statuses={statuses}
      listByStatus={listByStatus}
    />
  );
}
