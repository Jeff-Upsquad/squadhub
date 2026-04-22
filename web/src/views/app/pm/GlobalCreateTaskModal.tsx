import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { usePMStore } from '../../../stores/pmStore';
import TaskCreatePanel from './TaskCreatePanel';

export default function GlobalCreateTaskModal({ onClose }: { onClose: () => void }) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const activeSpaceId = usePMStore((s) => s.activeSpaceId);
  const activeListId = usePMStore((s) => s.activeListId);

  if (!workspaceId) return null;

  return (
    <TaskCreatePanel
      pickable
      workspaceId={workspaceId}
      initialSpaceId={activeSpaceId}
      initialListId={activeListId}
      onClose={onClose}
    />
  );
}
