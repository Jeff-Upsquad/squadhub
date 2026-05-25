import type { Notification } from '@squadhub/shared';

export const BROWSER_NOTIF_STORAGE_KEY = 'squadhub-browser-notifications-enabled';

const TYPE_LABELS: Record<string, string> = {
  task_assigned: 'Task Assigned',
  task_updated: 'Task Updated',
  task_commented: 'New Comment',
  task_due_soon: 'Due Soon',
  mention: 'Mention',
  message_mention: 'Mention',
  dm_received: 'Direct Message',
  reaction_added: 'Reaction',
};

export function isBrowserNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function isBrowserNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(BROWSER_NOTIF_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setBrowserNotificationsEnabled(enabled: boolean): void {
  localStorage.setItem(BROWSER_NOTIF_STORAGE_KEY, enabled ? 'true' : 'false');
}

export function getBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isBrowserNotificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission> {
  if (!isBrowserNotificationsSupported()) return 'denied';
  return Notification.requestPermission();
}

function notificationSubtitle(type: string): string {
  return TYPE_LABELS[type] || 'Notification';
}

/** Open inbox and select a notification (SPA navigation + InboxView deep-link). */
export function navigateToInboxNotification(
  notificationId: string,
  workspaceId?: string,
): void {
  window.__pendingInboxNotificationId = notificationId;

  const url = new URL(window.location.href);
  if (workspaceId) {
    url.pathname = `/app/workspace/${workspaceId}`;
  }
  url.searchParams.set('open_inbox', notificationId);
  const next = `${url.pathname}${url.search}`;
  window.history.pushState({}, '', next);

  window.dispatchEvent(
    new CustomEvent('squadhub:open-inbox', { detail: { notificationId } }),
  );
}

function shouldShowOsNotification(): boolean {
  if (!isBrowserNotificationsSupported()) return false;
  if (!isBrowserNotificationsEnabled()) return false;
  if (Notification.permission !== 'granted') return false;
  // Avoid duplicating in-app UI when the user is actively focused on SquadHub.
  return document.hidden || !document.hasFocus();
}

export function maybeShowBrowserNotification(n: Notification): void {
  if (!shouldShowOsNotification()) return;

  const body = n.body || notificationSubtitle(n.type);
  const workspaceId =
    typeof n.metadata?.workspace_id === 'string' ? n.metadata.workspace_id : undefined;

  const osNotif = new window.Notification(n.title, {
    body,
    tag: n.id,
    icon: `${window.location.origin}/squadhub.svg`,
  });

  osNotif.onclick = () => {
    osNotif.close();
    window.focus();
    navigateToInboxNotification(n.id, workspaceId);
  };
}
