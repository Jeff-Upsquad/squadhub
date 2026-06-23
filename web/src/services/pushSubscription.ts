import api from './api';

// VAPID public keys are base64url; PushManager.subscribe wants a BufferSource.
// Build on an explicit ArrayBuffer so the result is Uint8Array<ArrayBuffer>
// (assignable to BufferSource — a plain Uint8Array is Uint8Array<ArrayBufferLike>
// under the strict DOM lib and gets rejected).
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

let swRegistration: ServiceWorkerRegistration | null = null;

/** Register the service worker once (idempotent). Safe to call on every load. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isWebPushSupported()) return null;
  if (swRegistration) return swRegistration;
  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js');
    return swRegistration;
  } catch (e) {
    console.warn('[push] service worker registration failed', e);
    return null;
  }
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  return swRegistration || (await registerServiceWorker());
}

async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await api.get('/push/vapid-public-key');
    return (res.data?.key as string) || null;
  } catch {
    return null;
  }
}

/**
 * Ensure this browser is subscribed to web push and the subscription is
 * registered with the server. Idempotent — call after the user grants
 * notification permission, and on load to reconcile a rotated subscription.
 */
export async function subscribeToWebPush(): Promise<boolean> {
  if (!isWebPushSupported()) return false;
  if (Notification.permission !== 'granted') return false;

  const reg = await getRegistration();
  if (!reg) return false;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const key = await getVapidPublicKey();
    if (!key) return false; // web push not configured on the server
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    } catch (e) {
      console.warn('[push] pushManager.subscribe failed', e);
      return false;
    }
  }

  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) return false;

  try {
    await api.post('/push/web-register', { endpoint: sub.endpoint, p256dh, auth });
    return true;
  } catch (e) {
    console.warn('[push] web-register failed', e);
    return false;
  }
}

/** Drop this browser's web-push subscription on both server and client. */
export async function unsubscribeFromWebPush(): Promise<void> {
  if (!isWebPushSupported()) return;
  try {
    const reg = await getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    await api.post('/push/web-unregister', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  } catch (e) {
    console.warn('[push] unsubscribe failed', e);
  }
}
