import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { usePMStore } from '../../../stores/pmStore';
import type { SavedDraft } from '../../../stores/draftTaskStore';
import TaskCreatePanel from './TaskCreatePanel';

export default function GlobalCreateTaskModal({
  onClose,
  resumeDraft,
  inListContext = false,
}: {
  onClose: () => void;
  resumeDraft?: SavedDraft | null;
  /**
   * True when the user is currently viewing a list-context page (ListPage,
   * FolderPage, SpacePage, or ClientDesignDashboard). When false (Home / Inbox
   * / My Tasks / Docs / Cal / etc.), the modal ignores the persisted
   * `activeListId` / `contextListId` so a stale list doesn't leak in as the
   * default. `resumeDraft` still takes precedence in either case.
   */
  inListContext?: boolean;
}) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const activeSpaceId = usePMStore((s) => s.activeSpaceId);
  const activeListId = usePMStore((s) => s.activeListId);
  const contextListId = usePMStore((s) => s.contextListId);

  if (!workspaceId) return null;

  // Only inherit list/space from the store when the user is actively viewing
  // a list-context view. Otherwise start with empty pickers.
  const fallbackSpaceId = inListContext ? activeSpaceId : null;
  const fallbackListId = inListContext ? (activeListId ?? contextListId) : null;

  return (
    <TaskCreatePanel
      pickable
      workspaceId={workspaceId}
      initialSpaceId={resumeDraft?.spaceId ?? fallbackSpaceId}
      initialListId={resumeDraft?.listId ?? fallbackListId}
      initialDraft={resumeDraft ? { ...resumeDraft.draft, _draftId: resumeDraft.id } : undefined}
      onClose={onClose}
    />
  );
}
