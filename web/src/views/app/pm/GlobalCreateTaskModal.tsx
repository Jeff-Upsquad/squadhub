import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { usePMStore } from '../../../stores/pmStore';
import { usePersonalList } from '../../../hooks/useTasks';
import type { SavedDraft } from '../../../stores/draftTaskStore';
import TaskCreatePanel from './TaskCreatePanel';

export default function GlobalCreateTaskModal({
  onClose,
  resumeDraft,
  inListContext = false,
  inMyTasks = false,
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
  /**
   * True when the user is viewing the My Tasks section. The modal then defaults
   * the list picker to the caller's private personal list so a task can be
   * created directly inside My Tasks without hunting for it.
   */
  inMyTasks?: boolean;
}) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const activeSpaceId = usePMStore((s) => s.activeSpaceId);
  const activeListId = usePMStore((s) => s.activeListId);
  const contextListId = usePMStore((s) => s.contextListId);
  // Personal list is get-or-create + cached, so fetching here is cheap and only
  // used as the default when viewing My Tasks.
  const { data: personal } = usePersonalList(inMyTasks && !resumeDraft && !inListContext);

  if (!workspaceId) return null;

  // Only inherit list/space from the store when the user is actively viewing
  // a list-context view. Otherwise start with empty pickers — except in My
  // Tasks, where the personal list is the sensible default.
  const fallbackSpaceId = inListContext
    ? activeSpaceId
    : inMyTasks
      ? (personal?.space?.id ?? null)
      : null;
  const fallbackListId = inListContext
    ? (activeListId ?? contextListId)
    : inMyTasks
      ? (personal?.list?.id ?? null)
      : null;

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
