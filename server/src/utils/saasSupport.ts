// ============================================================
// saasSupport — support tickets raised from Squad Hub SaaS (app.squadhub.in).
//
// Bridge-created tickets land in the SAME help desk agents use today (the
// workspace's `channel_kind='support'` channel, ticket = thread). The SaaS user
// is NOT a Hub account: they're a `support_external_requesters` row, and the
// Hub-side sender/creator of their messages is one suspended system user
// (SAAS_REQUESTER_USER_ID, seeded by migration 20261023120000_saas_bridge).
// When the SaaS user also maps to a real Hub user (hub_user_id), that user is
// the creator/sender instead, so the ticket shows up in their Hub support view.
//
// Agent replies (via the /support routes OR the shared chat thread composer
// on /messages) call notifySaasIfExternalTicket → SaaS POST /support/notify.
// ============================================================
import { supabaseAdmin } from '../supabase';
import { fireSaasHook, notifySaasSupportReply, saasBridgeEnabled } from './saasBridgeClient';

/** Fixed id of the seeded "Squad Hub app user" requester proxy. */
export const SAAS_REQUESTER_USER_ID = '5aa5b1d9-0000-4000-8000-000000000001';

export interface ExternalRequesterInput {
  saas_user_id: string;
  saas_account_id?: string | null;
  email?: string | null;
  name?: string | null;
  hub_user_id?: string | null;
}

/** Upsert the requester record keyed by SaaS user id; returns the row. */
export async function ensureExternalRequester(input: ExternalRequesterInput): Promise<any> {
  const row: Record<string, unknown> = {
    saas_user_id: input.saas_user_id,
    updated_at: new Date().toISOString(),
  };
  if (input.saas_account_id !== undefined) row.saas_account_id = input.saas_account_id;
  if (input.email) row.email = input.email.trim().toLowerCase();
  if (input.name) row.name = input.name.trim();
  if (input.hub_user_id) row.hub_user_id = input.hub_user_id;
  const { data, error } = await supabaseAdmin
    .from('support_external_requesters')
    .upsert(row, { onConflict: 'saas_user_id' })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'Could not record requester');
  return data;
}

/**
 * The Hub user that acts for this requester: their mapped Hub user when it
 * exists and is active, otherwise the system proxy.
 */
export async function resolveRequesterActor(requester: { hub_user_id?: string | null }): Promise<string> {
  if (requester.hub_user_id) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id, status')
      .eq('id', requester.hub_user_id)
      .maybeSingle();
    if (data?.id && (data as any).status === 'active') return data.id as string;
  }
  return SAAS_REQUESTER_USER_ID;
}

/**
 * The workspace whose Support channel agents triage. Preference: the mapped Hub
 * user's own workspace, then the workspace that already holds tickets (most
 * recent activity), then the existing Support channel's workspace, then the
 * first admin's workspace (same fallback activatedClientSpaces uses).
 */
export async function resolveSupportWorkspaceId(hubUserId?: string | null): Promise<string> {
  if (hubUserId) {
    const { data } = await supabaseAdmin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', hubUserId)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data?.workspace_id) return data.workspace_id as string;
  }
  const { data: recent } = await supabaseAdmin
    .from('support_tickets')
    .select('workspace_id')
    .order('last_activity_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent?.workspace_id) return recent.workspace_id as string;

  const { data: channel } = await supabaseAdmin
    .from('channels')
    .select('workspace_id')
    .eq('channel_kind', 'support')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (channel?.workspace_id) return channel.workspace_id as string;

  const { data: admin } = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id')
    .in('role', ['admin', 'super_admin'])
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (admin?.workspace_id) return admin.workspace_id as string;
  throw new Error('No Squad Hub workspace is available for support tickets');
}

/** Metadata stamped on bridge-originated messages (who really wrote it). */
export function requesterMessageMetadata(requester: any): Record<string, unknown> {
  return {
    saas_requester: {
      requester_id: requester.id,
      saas_user_id: requester.saas_user_id,
      saas_account_id: requester.saas_account_id ?? null,
      name: requester.name ?? null,
      email: requester.email ?? null,
    },
  };
}

/** True when a message was written by the SaaS requester (not an agent). */
function isRequesterSender(senderId: string, requester: any): boolean {
  return senderId === SAAS_REQUESTER_USER_ID || (!!requester?.hub_user_id && senderId === requester.hub_user_id);
}

async function notifyForTicket(ticket: any, senderId: string, preview: string): Promise<void> {
  if (!ticket?.external_requester_id) return;
  const { data: requester } = await supabaseAdmin
    .from('support_external_requesters')
    .select('id, saas_user_id, hub_user_id')
    .eq('id', ticket.external_requester_id)
    .maybeSingle();
  if (!requester?.saas_user_id) return;
  if (isRequesterSender(senderId, requester)) return; // the requester's own message
  await notifySaasSupportReply({
    ticket_id: ticket.id,
    saas_user_id: requester.saas_user_id as string,
    preview: preview.slice(0, 280),
  });
}

/**
 * Fire-and-forget: if `ticketId` is a bridge-created ticket and `senderId` is
 * an agent, tell the SaaS (POST /bridge/v1/support/notify). No-op (with no DB
 * read) when the bridge transport isn't configured.
 */
export function notifySaasIfExternalTicket(input: { ticketId: string; senderId: string; preview: string }): void {
  if (!saasBridgeEnabled()) return;
  fireSaasHook('support-notify', async () => {
    const { data: ticket } = await supabaseAdmin
      .from('support_tickets')
      .select('id, external_requester_id')
      .eq('id', input.ticketId)
      .maybeSingle();
    await notifyForTicket(ticket, input.senderId, input.preview);
  });
}

/**
 * Same, keyed by the thread root — for agent replies posted through the shared
 * chat thread composer (POST /messages with parent_message_id).
 */
export function notifySaasIfExternalTicketRoot(input: { rootMessageId: string; senderId: string; preview: string }): void {
  if (!saasBridgeEnabled()) return;
  fireSaasHook('support-notify', async () => {
    const { data: ticket } = await supabaseAdmin
      .from('support_tickets')
      .select('id, external_requester_id')
      .eq('root_message_id', input.rootMessageId)
      .not('external_requester_id', 'is', null)
      .maybeSingle();
    await notifyForTicket(ticket, input.senderId, input.preview);
  });
}
