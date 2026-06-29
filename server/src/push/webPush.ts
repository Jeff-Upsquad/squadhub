import webpush from 'web-push';
import { config } from '../config';
import { supabaseAdmin } from '../supabase';

// A row from the `notifications` table (only the fields we forward).
export interface WebPushNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  reference_type: string | null;
  reference_id: string | null;
  // Carries routing ids (e.g. workspace_id) so the SW can deep-link the click.
  metadata?: Record<string, unknown> | null;
}

// Configure VAPID lazily on first send so the server boots without keys (dev),
// mirroring how fcm.ts no-ops when FIREBASE_SERVICE_ACCOUNT_JSON is unset.
let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!config.webPushVapidPublicKey || !config.webPushVapidPrivateKey) return false;
  webpush.setVapidDetails(
    config.webPushVapidSubject,
    config.webPushVapidPublicKey,
    config.webPushVapidPrivateKey,
  );
  configured = true;
  return true;
}

// The in-app URL the service worker opens on click — mirrors the web client's
// navigateToInboxNotification (opens Inbox focused on this notification).
function deepLink(n: WebPushNotification): string {
  const meta = (n.metadata || {}) as Record<string, unknown>;
  const ws = typeof meta.workspace_id === 'string' ? meta.workspace_id : '';
  const base = ws ? `/app/workspace/${ws}` : '/';
  return `${base}?open_inbox=${encodeURIComponent(n.id)}`;
}

/**
 * Send a notifications-feed row to the user's subscribed browsers via W3C Web
 * Push. No-op when VAPID keys aren't configured or the user has no
 * subscriptions. Prunes subscriptions the push service reports as gone (404/410).
 */
export async function sendWebPush(notification: WebPushNotification): Promise<void> {
  if (!ensureConfigured()) return;

  const { data: subs } = await supabaseAdmin
    .from('web_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', notification.user_id);

  if (!subs || subs.length === 0) return;

  // Current unread total so the service worker can set the Dock/taskbar badge
  // while the window is closed. Mirrors GET /notifications/unread-count.
  const { count: unreadCount } = await supabaseAdmin
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', notification.user_id)
    .eq('is_read', false);

  const payload = JSON.stringify({
    title: notification.title || 'SquadHub',
    body: notification.body || '',
    tag: notification.id, // collapse/replace duplicates of the same notification
    type: notification.type || '',
    url: deepLink(notification),
    unreadCount: unreadCount ?? 0,
  });

  const stale: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
      } catch (err: unknown) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          stale.push(s.id);
        } else {
          console.error('[web push] send error', code, (err as { body?: string })?.body);
        }
      }
    }),
  );

  if (stale.length > 0) {
    await supabaseAdmin.from('web_push_subscriptions').delete().in('id', stale);
  }
}
