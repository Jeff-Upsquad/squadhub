import { supabaseAdmin } from '../supabase';
import {
  templateSlugsForServiceType,
  templateSlugsForSubscriptionSlug,
} from './activatedClientSpaceTypes';

export {
  templateSlugsForServiceType,
  templateSlugsForSubscriptionSlug,
} from './activatedClientSpaceTypes';

export type ActivatedClientSpaceResult = {
  clientFolderId: string;
  childFolderIds: string[];
  linkedFolderId: string | null;
};

async function resolveActorAndWorkspace(
  fallbackUserId?: string | null,
): Promise<{ actorId: string; workspaceId: string }> {
  const { data: preferred } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id, workspace_id')
    .in('role', ['admin', 'super_admin'])
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (preferred?.user_id && preferred.workspace_id) {
    return { actorId: preferred.user_id, workspaceId: preferred.workspace_id };
  }

  // Assignment-time provisioning has just guaranteed this talent's workspace
  // membership. Use it as the deterministic owner when legacy workspaces have
  // no admin membership available.
  if (fallbackUserId) {
    const { data: talentMember } = await supabaseAdmin
      .from('workspace_members')
      .select('user_id, workspace_id')
      .eq('user_id', fallbackUserId)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (talentMember?.user_id && talentMember.workspace_id) {
      return { actorId: talentMember.user_id, workspaceId: talentMember.workspace_id };
    }
  }

  const { data: fallback } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id, workspace_id')
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!fallback?.user_id || !fallback.workspace_id) {
    throw new Error('No SquadHub workspace member is available to own the client folder');
  }
  return { actorId: fallback.user_id, workspaceId: fallback.workspace_id };
}

async function ensureClientSpacesHost(actorId: string, workspaceId: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from('spaces')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('name', 'Client Spaces')
    .is('client_id', null)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { count } = await supabaseAdmin
    .from('spaces')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null);
  const { data: created, error } = await supabaseAdmin
    .from('spaces')
    .insert({
      workspace_id: workspaceId,
      name: 'Client Spaces',
      kind: 'workspace',
      color: '#7c3aed',
      icon: 'users',
      description: 'Client folders and their delivery spaces',
      is_private: true,
      created_by: actorId,
      position: count ?? 0,
    })
    .select('id')
    .single();
  if (error || !created) throw new Error(error?.message || 'Failed to create Client Spaces');
  return created.id;
}

async function ensureClientFolder(input: {
  clientId: string;
  name: string;
  actorId: string;
  workspaceId: string;
}): Promise<{ id: string; spaceId: string }> {
  const { data: existing } = await supabaseAdmin
    .from('folders')
    .select('id, space_id')
    .eq('client_id', input.clientId)
    .eq('name', input.name)
    .eq('folder_type', 'client')
    .is('parent_folder_id', null)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    return { id: existing.id, spaceId: existing.space_id };
  }

  const spaceId = await ensureClientSpacesHost(input.actorId, input.workspaceId);
  const { count } = await supabaseAdmin
    .from('folders')
    .select('*', { count: 'exact', head: true })
    .eq('space_id', spaceId)
    .is('deleted_at', null);
  const { data: created, error } = await supabaseAdmin
    .from('folders')
    .insert({
      space_id: spaceId,
      name: input.name,
      folder_type: 'client',
      client_id: input.clientId,
      is_private: true,
      created_by: input.actorId,
      position: count ?? 0,
    })
    .select('id, space_id')
    .single();
  if (error || !created) throw new Error(error?.message || 'Failed to create client folder');
  return { id: created.id, spaceId: created.space_id };
}

async function ensureTemplateFolder(input: {
  clientId: string;
  clientFolderId: string;
  spaceId: string;
  actorId: string;
  template: any;
}): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from('folders')
    .select('id')
    .eq('parent_folder_id', input.clientFolderId)
    .eq('client_space_template_id', input.template.id)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { count } = await supabaseAdmin
    .from('folders')
    .select('*', { count: 'exact', head: true })
    .eq('parent_folder_id', input.clientFolderId)
    .is('deleted_at', null);
  const { data: folder, error } = await supabaseAdmin
    .from('folders')
    .insert({
      space_id: input.spaceId,
      name: input.template.name,
      parent_folder_id: input.clientFolderId,
      client_id: input.clientId,
      client_space_template_id: input.template.id,
      client_space_template_version: input.template.version,
      is_private: true,
      created_by: input.actorId,
      position: count ?? 0,
    })
    .select('id')
    .single();
  if (error || !folder) throw new Error(error?.message || `Failed to create ${input.template.name}`);

  const templateLists = (input.template.template?.lists ?? []) as Array<{
    name: string;
    position?: number;
    default_view?: string;
  }>;
  if (templateLists.length > 0) {
    const { error: listError } = await supabaseAdmin.from('lists').insert(
      templateLists.map((list) => ({
        space_id: input.spaceId,
        folder_id: folder.id,
        name: list.name,
        position: list.position ?? 0,
        default_view: list.default_view ?? 'list',
        is_private: true,
        created_by: input.actorId,
      })),
    );
    if (listError) throw new Error(listError.message);
  }
  return folder.id;
}

async function grantFolders(userIds: string[], folderIds: string[], actorId: string): Promise<void> {
  const uniqueUsers = [...new Set(userIds.filter(Boolean))];
  const uniqueFolders = [...new Set(folderIds.filter(Boolean))];
  if (uniqueUsers.length === 0 || uniqueFolders.length === 0) return;
  const { error } = await supabaseAdmin.from('resource_memberships').upsert(
    uniqueUsers.flatMap((userId) =>
      uniqueFolders.map((resourceId) => ({
        resource_type: 'folder',
        resource_id: resourceId,
        user_id: userId,
        access_level: 'member',
        invited_by: actorId,
      })),
    ),
    { onConflict: 'resource_type,resource_id,user_id' },
  );
  if (error) throw new Error(error.message);
}

async function resolveClientIdForCard(card: any, supplied?: string | null): Promise<string | null> {
  if (supplied) return supplied;
  if (card.submission_subscription_id) {
    const { data: staged } = await supabaseAdmin
      .from('client_submission_subscriptions')
      .select('submission_id')
      .eq('id', card.submission_subscription_id)
      .maybeSingle();
    if (staged?.submission_id) {
      const { data: client } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('submission_id', staged.submission_id)
        .maybeSingle();
      if (client?.id) return client.id;
    }
  }
  if (card.customer_email) {
    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('id')
      .ilike('email', card.customer_email)
      .limit(1)
      .maybeSingle();
    if (client?.id) return client.id;
  }
  return null;
}

async function resolveTemplateSlugs(card: any): Promise<string[]> {
  const direct = templateSlugsForServiceType(card.service_type);
  if (direct.length > 0 || !card.submission_subscription_id) return direct;

  const { data: staged } = await supabaseAdmin
    .from('client_submission_subscriptions')
    .select('subscription_id')
    .eq('id', card.submission_subscription_id)
    .maybeSingle();
  if (!staged?.subscription_id) return [];
  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('slug')
    .eq('id', staged.subscription_id)
    .maybeSingle();
  return templateSlugsForSubscriptionSlug(subscription?.slug);
}

async function resolveTalentUserId(cardId: string, recipientType: string | null, recipientId: string | null): Promise<string | null> {
  if (!recipientType || !recipientId) return null;
  if (recipientType === 'partner') return recipientId;
  const { data: recipient } = await supabaseAdmin
    .from('subscription_card_external_recipients')
    .select('email')
    .eq('card_id', cardId)
    .eq('external_user_id', recipientId)
    .maybeSingle();
  if (!recipient?.email) return null;
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .ilike('email', recipient.email)
    .eq('status', 'active')
    .maybeSingle();
  return user?.id ?? null;
}

/**
 * Idempotently create the brand client folder, the service-specific child
 * spaces, link the activated card, and share them with the client and talent.
 */
export async function provisionActivatedClientSpaces(input: {
  cardId: string;
  clientId?: string | null;
  talentSquadhubUserId?: string | null;
}): Promise<ActivatedClientSpaceResult | null> {
  const { data: card, error: cardError } = await supabaseAdmin
    .from('subscription_cards')
    .select('id, service_type, brand_name, customer_company, customer_email, submission_subscription_id, selected_recipient_type, selected_recipient_id, linked_folder_id')
    .eq('id', input.cardId)
    .maybeSingle();
  if (cardError) throw new Error(cardError.message);
  if (!card) return null;

  const slugs = await resolveTemplateSlugs(card);
  if (slugs.length === 0) return null;

  const clientId = await resolveClientIdForCard(card, input.clientId);
  if (!clientId) throw new Error('Activated card could not be resolved to a SquadHub client');
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id, business_name')
    .eq('id', clientId)
    .maybeSingle();
  if (!client) throw new Error('Activated card client was not found');

  const { actorId, workspaceId } = await resolveActorAndWorkspace(input.talentSquadhubUserId);
  const brandName = String(card.brand_name || client.business_name || card.customer_company || 'Client').trim();
  const clientFolder = await ensureClientFolder({ clientId, name: brandName, actorId, workspaceId });

  const { data: templates, error: templateError } = await supabaseAdmin
    .from('client_space_templates')
    .select('id, slug, name, version, template')
    .in('slug', slugs)
    .eq('is_enabled', true);
  if (templateError) throw new Error(templateError.message);
  const templateBySlug = new Map((templates ?? []).map((template: any) => [template.slug, template]));
  const missing = slugs.filter((slug) => !templateBySlug.has(slug));
  if (missing.length > 0) throw new Error(`Missing enabled client-space template(s): ${missing.join(', ')}`);

  const childFolderIds: string[] = [];
  for (const slug of slugs) {
    childFolderIds.push(await ensureTemplateFolder({
      clientId,
      clientFolderId: clientFolder.id,
      spaceId: clientFolder.spaceId,
      actorId,
      template: templateBySlug.get(slug),
    }));
  }

  let linkedFolderId = card.linked_folder_id as string | null;
  if (!linkedFolderId && childFolderIds[0]) {
    linkedFolderId = childFolderIds[0];
    const { error: linkError } = await supabaseAdmin
      .from('subscription_cards')
      .update({ linked_folder_id: linkedFolderId, linked_at: new Date().toISOString() })
      .eq('id', input.cardId)
      .is('linked_folder_id', null);
    if (linkError) throw new Error(linkError.message);
  }

  const [{ data: clientAccess }, resolvedTalentId] = await Promise.all([
    supabaseAdmin.from('client_user_access').select('user_id').eq('client_id', clientId),
    input.talentSquadhubUserId
      ? Promise.resolve(input.talentSquadhubUserId)
      : resolveTalentUserId(input.cardId, card.selected_recipient_type, card.selected_recipient_id),
  ]);
  const clientUserIds = (clientAccess ?? []).map((row: any) => row.user_id as string);
  const allMemberIds = resolvedTalentId ? [...clientUserIds, resolvedTalentId] : clientUserIds;
  await grantFolders(allMemberIds, [clientFolder.id, ...childFolderIds], actorId);

  if (resolvedTalentId) {
    await supabaseAdmin.from('partner_client_assignments').upsert(
      { user_id: resolvedTalentId, client_id: clientId, role: null },
      { onConflict: 'user_id,client_id', ignoreDuplicates: true },
    );
  }

  return { clientFolderId: clientFolder.id, childFolderIds, linkedFolderId };
}

/** Share every existing client folder/child space after a client user is provisioned. */
export async function syncClientFolderMemberships(clientId: string, userId: string): Promise<void> {
  const { data: roots } = await supabaseAdmin
    .from('folders')
    .select('id, created_by')
    .eq('client_id', clientId)
    .eq('folder_type', 'client')
    .is('parent_folder_id', null)
    .is('deleted_at', null);
  if (!roots?.length) return;
  const rootIds = roots.map((row: any) => row.id as string);
  const { data: children } = await supabaseAdmin
    .from('folders')
    .select('id')
    .in('parent_folder_id', rootIds)
    .not('client_space_template_id', 'is', null)
    .is('deleted_at', null);
  await grantFolders(
    [userId],
    [...rootIds, ...(children ?? []).map((row: any) => row.id as string)],
    (roots[0] as any).created_by as string,
  );
}

/** Reconcile all activated cards for a SquadHire talent when their SSO account is created. */
export async function syncTalentActivatedClientSpaces(input: {
  talentUserId: string;
  squadhubUserId: string;
}): Promise<void> {
  const { data: recipients } = await supabaseAdmin
    .from('subscription_card_external_recipients')
    .select('card_id')
    .eq('external_user_id', input.talentUserId)
    .not('selected_at', 'is', null)
    .is('archived_at', null);
  for (const row of recipients ?? []) {
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, state, selected_recipient_id, cancelled_at, deleted_at')
      .eq('id', (row as any).card_id)
      .maybeSingle();
    if (!card || card.state !== 'assigned' || card.selected_recipient_id !== input.talentUserId || card.cancelled_at || card.deleted_at) continue;
    await provisionActivatedClientSpaces({
      cardId: card.id,
      talentSquadhubUserId: input.squadhubUserId,
    });
  }
}
