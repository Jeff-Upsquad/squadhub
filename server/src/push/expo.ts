import { Expo, ExpoPushMessage, ExpoPushTicket, ExpoPushReceipt } from 'expo-server-sdk';
import { supabaseAdmin } from '../supabase';
import type { ChatAppVariant } from '@squadhub/shared';

// Singleton Expo push client. Free service; handles FCM (Android) + APNs (iOS).
const expo = new Expo();

export interface ChatPushPayload {
  title: string;
  body: string;
  data: Record<string, unknown>;
  appVariant: ChatAppVariant;
}

// Send a push to every Expo-provider token the user has for this app variant.
// Prunes tokens that Expo reports as DeviceNotRegistered.
// Tokens with `provider = 'fcm'` are handled by ./fcm.ts.
export async function sendExpoChatPush(userId: string, payload: ChatPushPayload): Promise<void> {
  const { data: tokens } = await supabaseAdmin
    .from('chat_push_tokens')
    .select('id, token, platform')
    .eq('user_id', userId)
    .eq('app_variant', payload.appVariant)
    .eq('provider', 'expo');

  if (!tokens || tokens.length === 0) return;

  const channelId = payload.appVariant === 'clients' ? 'chat_messages_clients' : 'chat_messages_team';
  const soundName = payload.appVariant === 'clients' ? 'notification_clients' : 'notification_team';

  const messages: ExpoPushMessage[] = [];
  const tokenRowByToken = new Map<string, { id: string }>();

  for (const row of tokens) {
    if (!Expo.isExpoPushToken(row.token)) {
      console.warn('[chat push] skipping malformed expo token', row.id);
      continue;
    }
    tokenRowByToken.set(row.token, { id: row.id });
    messages.push({
      to: row.token,
      sound: row.platform === 'android' ? 'default' : soundName,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      channelId,
      priority: 'high',
    });
  }

  if (messages.length === 0) return;

  const chunks = expo.chunkPushNotifications(messages);
  const tickets: ExpoPushTicket[] = [];
  for (const chunk of chunks) {
    try {
      const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...chunkTickets);
    } catch (err) {
      console.error('[chat push] send chunk failed:', err);
    }
  }

  const idsToDelete: string[] = [];
  tickets.forEach((t, i) => {
    if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
      const msg = messages[i];
      const row = typeof msg.to === 'string' ? tokenRowByToken.get(msg.to) : undefined;
      if (row) idsToDelete.push(row.id);
    }
  });

  if (idsToDelete.length > 0) {
    await supabaseAdmin.from('chat_push_tokens').delete().in('id', idsToDelete);
  }
}

export async function checkChatPushReceipts(receiptIds: string[]): Promise<Record<string, ExpoPushReceipt>> {
  const receipts: Record<string, ExpoPushReceipt> = {};
  const chunks = expo.chunkPushNotificationReceiptIds(receiptIds);
  for (const chunk of chunks) {
    try {
      const res = await expo.getPushNotificationReceiptsAsync(chunk);
      Object.assign(receipts, res);
    } catch (err) {
      console.error('[chat push] receipt fetch failed:', err);
    }
  }
  return receipts;
}
