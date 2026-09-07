import { useLearningStore } from '../stores/learningStore';
import { usePMStore } from '../stores/pmStore';
import { useWorkspaceStore, type ChatKind } from '../stores/workspaceStore';
import { useTabsStore } from '../stores/tabsStore';
import { buildChatSnapshot, buildHomeSnapshot, buildLearningSnapshot } from './tabSnapshots';

export function openSopResource(itemId: string, lessonId?: string | null) {
  if (!itemId) return;
  useLearningStore.getState().setLearningTarget({
    itemId,
    lessonId: lessonId || null,
    sectionAnchor: null,
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('squadhub:open-resource'));
  }
}

export function sopTargetFromNotification(n: { type?: string; metadata?: Record<string, any> | null }) {
  if (n.type !== 'sop_flag' && n.type !== 'sop_strike') return null;
  const itemId = n.metadata?.item_id as string | undefined;
  if (!itemId) return null;
  return { itemId, lessonId: (n.metadata?.lesson_id as string | null) || null };
}

export function sopSourceFromNotification(n: { metadata?: Record<string, any> | null }) {
  const m = n.metadata || {};
  if (m.task_id) return { kind: 'task' as const, label: (m.source_label as string) || 'Task' };
  if (m.channel_id) return { kind: 'channel' as const, label: (m.source_label as string) || 'Channel message' };
  if (m.dm_conversation_id) return { kind: 'dm' as const, label: (m.source_label as string) || 'Direct message' };
  if (m.source_kind === 'message' && m.source_id) return { kind: 'message' as const, label: (m.source_label as string) || 'Message' };
  return null;
}

export function openSopSource(n: { metadata?: Record<string, any> | null }, opts?: { setHomeView?: (v: 'chat') => void; newTab?: boolean }) {
  const m = n.metadata || {};
  const tabs = useTabsStore.getState();

  if (m.task_id) {
    if (opts?.newTab) tabs.openInNewTab(buildHomeSnapshot('my-tasks'));
    usePMStore.getState().setActiveTask(m.task_id as string);
    return;
  }

  const ws = useWorkspaceStore.getState();
  const jump = (id: string, kind: ChatKind) => {
    if (opts?.newTab) tabs.openInNewTab(buildChatSnapshot(id, kind));
    ws.setActiveChannel(id, kind);
    opts?.setHomeView?.('chat');
    if (m.message_id) {
      ws.requestMessageJump({
        conversationId: id,
        kind,
        messageId: m.message_id as string,
        parentId: (m.parent_id as string | null) || null,
      });
    }
  };

  if (m.channel_id) { jump(m.channel_id as string, 'channel'); return; }
  if (m.dm_conversation_id) { jump(m.dm_conversation_id as string, 'dm'); return; }
}

export function openSopFromNotification(n: { type?: string; metadata?: Record<string, any> | null }, opts?: { newTab?: boolean }) {
  const sop = sopTargetFromNotification(n);
  if (!sop) return;
  if (opts?.newTab) useTabsStore.getState().openInNewTab(buildLearningSnapshot());
  openSopResource(sop.itemId, sop.lessonId);
}
