import { useQuery } from '@tanstack/react-query';
import { usePMStore } from '../../../stores/pmStore';
import { useTask } from '../../../hooks/useTasks';
import { useIsAdmin } from '../../../hooks/usePermissions';
import { canAtLeast } from '../../../lib/access';
import api from '../../../services/api';
import type { SpaceStatus, AccessLevel } from '@squadhub/shared';
import TaskDetailPanel from '../pm/TaskDetailPanel';

// Mirrors GlobalTaskDetailPanel but reads peekTaskId from pmStore and passes
// it to TaskDetailPanel as a taskIdOverride with isPeek=true. The panel then
// positions itself on the left via the .td-shell[data-peek="true"] CSS rules.
export default function GlobalTaskPeekPanel() {
  const peekTaskId = usePMStore((s) => s.peekTaskId);
  const { data: task } = useTask(peekTaskId);
  const listId = (task as any)?.list_id as string | undefined;

  const { data: listData } = useQuery({
    queryKey: ['list', listId],
    queryFn: async () => {
      const res = await api.get(`/pm/lists/${listId}`);
      return res.data.data;
    },
    enabled: !!listId,
  });

  const spaceId = listData?.space_id as string | undefined;
  const { data: spaceData } = useQuery({
    queryKey: ['space', spaceId],
    queryFn: async () => {
      const res = await api.get(`/pm/spaces/${spaceId}`);
      return res.data.data;
    },
    enabled: !!spaceId,
  });

  const isAdmin = useIsAdmin();

  if (!peekTaskId || !listId) return null;

  const statuses: SpaceStatus[] =
    spaceData?.space_statuses || spaceData?.statuses || listData?.space_statuses || [];
  const myAccess: AccessLevel | undefined = spaceData?.my_access_level || listData?.my_access_level;
  const canEdit = canAtLeast(myAccess, 'member') || isAdmin;

  return (
    <TaskDetailPanel
      statuses={statuses}
      listId={listId}
      canEdit={canEdit}
      spaceName={spaceData?.name || listData?.name}
      spaceColor={spaceData?.color || null}
      spaceId={spaceId ?? null}
      listName={listData?.name || null}
      taskIdOverride={peekTaskId}
      isPeek
    />
  );
}
