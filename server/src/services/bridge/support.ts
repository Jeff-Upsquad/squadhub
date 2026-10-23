/**
 * POST /bridge/v1/support/notify — a Hub agent replied to a SaaS user's ticket.
 * Writes an in-app notification in the account the ticket was raised from;
 * the notifications poller (sockets/index.ts) fans it out to Socket.IO, Web
 * Push and the partner app (FCM) like every other notification.
 */
import { supabaseAdmin } from '../../supabase';
import { BridgeError, isUuid } from './errors';

export async function notifySupportReply(body: { ticket_id: string; saas_user_id: string; preview?: string }) {
  if (!isUuid(body.ticket_id)) throw new BridgeError(400, 'ticket_id must be a uuid');
  if (!isUuid(body.saas_user_id)) throw new BridgeError(400, 'saas_user_id must be a uuid');
  const { data: user } = await supabaseAdmin.from('users').select('id').eq('id', body.saas_user_id).maybeSingle();
  if (!user) throw new BridgeError(404, 'User not found');

  const { data: ref } = await supabaseAdmin
    .from('bridge_support_tickets')
    .select('workspace_id, ticket_number, subject')
    .eq('ticket_id', body.ticket_id)
    .eq('user_id', body.saas_user_id)
    .maybeSingle();
  let workspaceId = (ref as any)?.workspace_id as string | undefined;
  if (!workspaceId) {
    const { data: m } = await supabaseAdmin
      .from('workspace_members')
      .select('workspace_id, workspaces!inner(status)')
      .eq('user_id', body.saas_user_id)
      .limit(1);
    workspaceId = ((m as any[]) || [])[0]?.workspace_id;
  }
  if (!workspaceId) throw new BridgeError(409, 'The user has no account to notify in');

  const code = (ref as any)?.ticket_number ? `SUP-${(ref as any).ticket_number}` : 'your ticket';
  const { data: n, error } = await supabaseAdmin
    .from('notifications')
    .insert({
      workspace_id: workspaceId,
      user_id: body.saas_user_id,
      type: 'support_reply',
      reference_id: body.ticket_id,
      reference_type: 'support_ticket',
      title: `Support replied to ${code}`,
      body: String(body.preview || '').slice(0, 280) || null,
      metadata: { workspace_id: workspaceId, ticket_id: body.ticket_id, route: 'support', subject: (ref as any)?.subject ?? null },
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return { notification_id: (n as any)?.id ?? null, workspace_id: workspaceId };
}
