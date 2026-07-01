import type { SpaceStatus } from '@squadhub/shared';
import ListView from '../../ListView';

/**
 * The Design/Video space "Tasks" tab — a normal list for general (non-request)
 * tasks, backed by the space folder's dedicated "Tasks" list. Reuses the app's
 * standard `ListView`, so grouping (Status/Assignee/Priority/None), quick add,
 * focus stars, and per-task time tracking all behave exactly like any other
 * list. Time logged here rolls into the space's hours via the folder-level
 * time-summary aggregation (no special handling needed).
 */
export default function TasksTab({
  listId,
  statuses,
  searchQuery = '',
}: {
  listId: string;
  statuses: SpaceStatus[];
  searchQuery?: string;
}) {
  return (
    <div style={{ padding: '4px 0' }}>
      <ListView
        listId={listId}
        statuses={statuses}
        searchQuery={searchQuery}
        groupBy="status"
      />
    </div>
  );
}
