import * as admin from 'firebase-admin';

// Lazy singleton. Initialized on first send, skipped if env not set so the
// server still boots in dev without a Firebase service account configured.
let app: admin.app.App | null = null;
let initAttempted = false;

export function getFirebaseApp(): admin.app.App | null {
  if (initAttempted) return app;
  initAttempted = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn('[push/fcm] FIREBASE_SERVICE_ACCOUNT_JSON not set — FCM sends are disabled');
    return null;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return app;
  } catch (err) {
    console.error('[push/fcm] failed to init firebase-admin:', err);
    return null;
  }
}
