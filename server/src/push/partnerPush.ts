import { getFirebaseApp } from './fcm';
import { supabaseAdmin } from '../supabase';

// A row from the `notifications` table (only the fields we forward).
export interface PartnerNotification {
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  reference_type: string | null;
  reference_id: string | null;
}

/**
 * Push a notifications-feed row to the user's native partner-app devices via
 * FCM. Data-only payload (so the Android service renders + deep-links it). No-op
 * when FCM isn't configured (FIREBASE_SERVICE_ACCOUNT_JSON unset) or the user
 * has no registered partner tokens. Prunes tokens FCM reports as dead.
 */
export async function sendPartnerPush(notification: PartnerNotification): Promise<void> {
  const firebase = getFirebaseApp();
  if (!firebase) return;

  const { data: tokens } = await supabaseAdmin
    .from('partner_push_tokens')
    .select('id, token')
    .eq('user_id', notification.user_id);

  if (!tokens || tokens.length === 0) return;

  const data: Record<string, string> = {
    title: notification.title || 'SquadHub',
    body: notification.body || '',
    type: notification.type || '',
    reference_type: notification.reference_type || '',
    reference_id: notification.reference_id || '',
  };

  try {
    const res = await firebase.messaging().sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      data,
      android: { priority: 'high' },
    });

    const stale: string[] = [];
    res.responses.forEach((r, i) => {
      if (!r.success && r.error) {
        const code = r.error.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          stale.push(tokens[i].id);
        } else {
          console.error('[partner push] send error', code, r.error.message);
        }
      }
    });

    if (stale.length > 0) {
      await supabaseAdmin.from('partner_push_tokens').delete().in('id', stale);
    }
  } catch (err) {
    console.error('[partner push] multicast failed:', err);
  }
}
