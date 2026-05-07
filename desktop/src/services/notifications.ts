import { invoke } from '@tauri-apps/api/core';

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

function getNotificationUrl(n: Notification): string {
  const ws = (n.metadata?.workspace_id as string) || '';
  const base = ws ? `${WEB_URL}/app/workspace/${ws}` : `${WEB_URL}/app`;
  // Always open the inbox with this notification selected
  return `${base}?open_inbox=${n.id}`;
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

export async function showNotification(n: Notification) {
  const url = getNotificationUrl(n);

  await invoke('send_notification', {
    title: n.title,
    body: n.body || getNotificationSubtitle(n.type),
    url,
  });
}
