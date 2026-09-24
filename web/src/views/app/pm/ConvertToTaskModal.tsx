import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { usePMStore } from '../../../stores/pmStore';
import { useConvertToTaskStore } from '../../../stores/convertToTaskStore';
import { showToastCard } from '../../../components/Toast';
import TaskCreatePanel from './TaskCreatePanel';

const KIND_LABEL = { message: 'message', thread: 'thread', comment: 'comment' } as const;

// Single global host for "Convert to task" (chat message / thread / task
// comment). Mounted once in MainLayout; opened via useConvertToTaskStore.
export default function ConvertToTaskModal() {
  const source = useConvertToTaskStore((s) => s.source);
  const close = useConvertToTaskStore((s) => s.close);
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspace?.id);
  const setActiveTask = usePMStore((s) => s.setActiveTask);

  if (!source || !workspaceId) return null;

  return (
    <TaskCreatePanel
      // Remount per source so a second conversion never inherits the first draft.
      key={`${source.kind}:${source.title}:${source.description.length}`}
      pickable
      workspaceId={workspaceId}
      initialSpaceId={source.spaceId ?? null}
      initialListId={source.listId ?? null}
      initialDraft={{
        title: source.title,
        description: source.description,
        status: 'todo',
        priority: 'none',
        assignee_ids: [],
        work_date: null,
        start_date: null,
        due_date: null,
        task_type_id: null,
        time_estimate: null,
        recurrence: null,
        subtaskSections: [],
        subtasks: [],
        checklists: [],
      }}
      onCreated={(task) => {
        showToastCard({
          title: `Task created from ${KIND_LABEL[source.kind]}`,
          subtitle: task.title,
          onClick: () => setActiveTask(task.id),
        });
      }}
      onClose={close}
    />
  );
}
