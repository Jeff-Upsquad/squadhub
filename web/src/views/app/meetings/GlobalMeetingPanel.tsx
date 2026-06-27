import { useMeetingPanelStore } from '../../../stores/meetingPanelStore';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import MeetingCreatePanel from './MeetingCreatePanel';

// Single instance mounted once in MainLayout. Any surface (list "+" dropdown,
// chat composer, Meetings mini-app, "Meeting" task type) opens it via the store.
export default function GlobalMeetingPanel() {
  const isOpen = useMeetingPanelStore((s) => s.isOpen);
  const ctx = useMeetingPanelStore((s) => s.ctx);
  const close = useMeetingPanelStore((s) => s.closeMeetingPanel);
  const workspace = useWorkspaceStore((s) => s.currentWorkspace);

  if (!isOpen || !workspace) return null;
  return (
    <MeetingCreatePanel
      workspaceId={workspace.id}
      channelId={ctx.channelId}
      channelKind={ctx.channelKind}
      listId={ctx.listId}
      initialTitle={ctx.initialTitle}
      onClose={close}
    />
  );
}
