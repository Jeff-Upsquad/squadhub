import type { SpaceStatus } from '@squadhub/shared';
import RequestsTab from './RequestsTab';
import type { RequestRowData } from '../atoms/RequestRow';
import { isRequestStageDone } from '../../../../../lib/designSpaceLists';

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
      requests={requests.filter((r) => isRequestStageDone(r._stage))}
      statuses={statuses}
      listByStatus={listByStatus}
    />
  );
}
