import { supabaseAdmin } from '../supabase';
import { isWorkspaceAdmin } from '../middleware/permissions';
import { userHasMiniApp } from './miniAppAccess';

/** A support agent = workspace admin OR holder of the `support` mini app. */
export async function isSupportAgent(userId: string): Promise<boolean> {
  if (await isWorkspaceAdmin(userId)) return true;
  return userHasMiniApp(userId, 'support');
}

/** True if the channel is the workspace's special Support help-desk channel. */
export async function isSupportChannel(channelId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('channels')
    .select('channel_kind')
    .eq('id', channelId)
    .maybeSingle();
  return data?.channel_kind === 'support';
}

/** True if `rootMessageId` is the opening message of a ticket this user created. */
export async function userOwnsSupportTicketRoot(userId: string, rootMessageId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('support_tickets')
    .select('id')
    .eq('root_message_id', rootMessageId)
    .eq('created_by', userId)
    .maybeSingle();
  return !!data;
}

/** Grant a user commenter membership on a channel (idempotent). */
export async function ensureChannelMember(channelId: string, userId: string): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('resource_memberships')
    .select('id')
    .eq('resource_type', 'channel')
    .eq('resource_id', channelId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing) return;
  await supabaseAdmin.from('resource_memberships').insert({
    resource_type: 'channel',
    resource_id: channelId,
    user_id: userId,
    access_level: 'commenter',
  });
}
