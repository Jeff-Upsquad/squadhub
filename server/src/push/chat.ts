import { sendExpoChatPush, type ChatPushPayload } from './expo';
import { sendFcmChatPush } from './fcm';

export type { ChatPushPayload };

// Unified dispatcher. Each sender queries its own provider slice of
// chat_push_tokens, so both can run in parallel without coordination.
export async function sendChatPush(userId: string, payload: ChatPushPayload): Promise<void> {
  await Promise.allSettled([sendExpoChatPush(userId, payload), sendFcmChatPush(userId, payload)]);
}
