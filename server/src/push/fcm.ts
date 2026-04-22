import * as admin from 'firebase-admin';
import { supabaseAdmin } from '../supabase';
import type { ChatPushPayload } from './expo';

// Lazy singleton. Initialized on first send, skipped if env not set so the
// server still boots in dev without a Firebase service account configured.
let app: admin.app.App | null = null;
let initAttempted = false;

function getApp(): admin.app.App | null {
  if (initAttempted) return app;
  initAttempted = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn('[chat push/fcm] FIREBASE_SERVICE_ACCOUNT_JSON not set — FCM sends are disabled');
    return null;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return app;
  } catch (err) {
    console.error('[chat push/fcm] failed to init firebase-admin:', err);
    return null;
  }
}

// Send a push to every FCM-provider token the user has for this app variant.
// Prunes tokens that FCM reports as unregistered.
// Tokens with `provider = 'expo'` are handled by ./expo.ts.
export async function sendFcmChatPush(userId: string, payload: ChatPushPayload): Promise<void> {
  const firebase = getApp();
  if (!firebase) return;

  const { data: tokens } = await supabaseAdmin
    .from('chat_push_tokens')
    .select('id, token, platform')
    .eq('user_id', userId)
    .eq('app_variant', payload.appVariant)
    .eq('provider', 'fcm');

  if (!tokens || tokens.length === 0) return;

  const channelId = payload.appVariant === 'clients' ? 'chat_messages_clients' : 'chat_messages_team';
  const tokenList = tokens.map((t) => t.token);

  // FCM data payload must be all strings — serialize non-strings.
  const dataStrings: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload.data)) {
    dataStrings[k] = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  }

  try {
    const res = await firebase.messaging().sendEachForMulticast({
      tokens: tokenList,
      notification: { title: payload.title, body: payload.body },
      data: dataStrings,
      android: {
        priority: 'high',
        notification: { channelId, sound: 'default' },
      },
    });

    const idsToDelete: string[] = [];
    res.responses.forEach((r, i) => {
      if (!r.success && r.error) {
        const code = r.error.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          idsToDelete.push(tokens[i].id);
        } else {
          console.error('[chat push/fcm] send error', code, r.error.message);
        }
      }
    });

    if (idsToDelete.length > 0) {
      await supabaseAdmin.from('chat_push_tokens').delete().in('id', idsToDelete);
    }
  } catch (err) {
    console.error('[chat push/fcm] multicast failed:', err);
  }
}
