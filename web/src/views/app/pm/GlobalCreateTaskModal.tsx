import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { usePMStore } from '../../../stores/pmStore';
import type { SavedDraft } from '../../../stores/draftTaskStore';
import TaskCreatePanel from './TaskCreatePanel';

export default function GlobalCreateTaskModal({
  onClose,
  resumeDraft,
}: {
  onClose: () => void;
  resumeDraft?: SavedDraft | null;
}) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const activeSpaceId = usePMStore((s) => s.activeSpaceId);
  const activeListId = usePMStore((s) => s.activeListId);
  const contextListId = usePMStore((s) => s.contextListId);

  if (!workspaceId) return null;

  return (
    <TaskCreatePanel
      pickable
      workspaceId={workspaceId}
      initialSpaceId={resumeDraft?.spaceId ?? activeSpaceId}
      initialListId={resumeDraft?.listId ?? activeListId ?? contextListId}
      initialDraft={resumeDraft ? { ...resumeDraft.draft, _draftId: resumeDraft.id } : undefined}
      onClose={onClose}
    />
  );
}
