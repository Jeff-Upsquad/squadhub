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

const recentlyShownIds = new Set<string>();

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

export function isDesktopNotificationsReady(): boolean {
  return (
    isBrowserNotificationsSupported() &&
    isBrowserNotificationsEnabled() &&
    Notification.permission === 'granted'
  );
}

/** If the user already allowed notifications in the browser, turn the in-app toggle on. */
export function syncBrowserNotificationPreference(): void {
  if (!isBrowserNotificationsSupported()) return;
  if (Notification.permission === 'granted' && !isBrowserNotificationsEnabled()) {
    setBrowserNotificationsEnabled(true);
  }
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
  return isDesktopNotificationsReady();
}

/** Show a native OS notification (deduped by notification id). */
export function showBrowserNotification(n: Pick<Notification, 'id' | 'title' | 'body' | 'type' | 'metadata'>): void {
  if (!shouldShowOsNotification()) return;
  if (recentlyShownIds.has(n.id)) return;
  recentlyShownIds.add(n.id);
  if (recentlyShownIds.size > 100) {
    const oldest = recentlyShownIds.values().next().value;
    if (oldest) recentlyShownIds.delete(oldest);
  }

  const body = n.body || notificationSubtitle(n.type);
  const workspaceId =
    typeof n.metadata?.workspace_id === 'string' ? n.metadata.workspace_id : undefined;

  try {
    const osNotif = new window.Notification(n.title, {
      body,
      tag: n.id,
    });

    osNotif.onclick = () => {
      osNotif.close();
      window.focus();
      navigateToInboxNotification(n.id, workspaceId);
    };
  } catch {
    // Browser blocked — ignore.
  }
}

/** Fire immediately after the user grants permission (confirms macOS/Windows delivery). */
export function showTestBrowserNotification(): void {
  if (!shouldShowOsNotification()) return;
  try {
    const osNotif = new window.Notification('UpSquad', {
      body: 'Desktop notifications are on. New inbox alerts will appear here.',
      tag: 'squadhub-test',
    });
    osNotif.onclick = () => {
      osNotif.close();
      window.focus();
    };
  } catch {
    // ignore
  }
}

/** @deprecated use showBrowserNotification */
export const maybeShowBrowserNotification = showBrowserNotification;
