import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  onAction,
} from '@tauri-apps/plugin-notification';
import { open } from '@tauri-apps/plugin-shell';

const WEB_URL = 'https://squadhub.in';

interface Notification {
  id: string;
  user_id: string;
  type: string;
  reference_id: string;
  reference_type: string;
  actor_id: string | null;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

const pendingUrls = new Map<string, string>();

function getNotificationUrl(n: Notification): string {
  const ws = (n.metadata?.workspace_id as string) || '';
  const base = ws ? `${WEB_URL}/app/workspace/${ws}` : `${WEB_URL}/app`;

  switch (n.reference_type) {
    case 'task':
      return n.metadata?.task_id
        ? `${base}?open_task=${n.metadata.task_id}`
        : base;
    case 'message':
    case 'chat_message':
      return n.metadata?.channel_id
        ? `${base}?open_channel=${n.metadata.channel_id}`
        : base;
    default:
      return base;
  }
}

function getNotificationSubtitle(type: string): string {
  const labels: Record<string, string> = {
    task_assigned: 'Task Assigned',
    task_updated: 'Task Updated',
    task_commented: 'New Comment',
    task_due_soon: 'Due Soon',
    mention: 'Mention',
    message_mention: 'Mention',
    dm_received: 'Direct Message',
    reaction_added: 'Reaction',
  };
  return labels[type] || 'Notification';
}

export async function ensurePermission(): Promise<boolean> {
  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === 'granted';
  }
  return granted;
}

export function setupNotificationClickHandler() {
  onAction((event) => {
    const id = event.id?.toString();
    if (!id) return;
    const url = pendingUrls.get(id);
    if (url) {
      open(url);
      pendingUrls.delete(id);
    }
  });
}

export async function showNotification(n: Notification) {
  const granted = await ensurePermission();
  if (!granted) return;

  const url = getNotificationUrl(n);

  pendingUrls.set(n.id, url);

  // Clean up old entries (keep last 50)
  if (pendingUrls.size > 50) {
    const oldest = pendingUrls.keys().next().value;
    if (oldest) pendingUrls.delete(oldest);
  }

  sendNotification({
    title: n.title,
    body: n.body || getNotificationSubtitle(n.type),
  });
}
