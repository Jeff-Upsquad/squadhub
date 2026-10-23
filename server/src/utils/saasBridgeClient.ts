// ============================================================
// saasBridgeClient — outbound, signed calls from the Hub to Squad Hub SaaS
// (app.squadhub.in, `/bridge/v1/*` on the SaaS side). See the bridge contract;
// signing lives in utils/bridgeSign.ts.
//
// Two switches:
//   SAAS_BRIDGE_SECRET + SAAS_API_URL  — transport. Unset ⇒ every call no-ops
//                                         with a log line.
//   SAAS_PROVISIONING_ENABLED=true     — the trigger hooks below (accounts,
//                                         shared workspaces, lifecycle). Default
//                                         OFF so production is unchanged until
//                                         it is flipped.
//
// Every hook is BEST-EFFORT, exactly like ensureClientPortalAccess: it never
// throws, logs failures, and must never break the Hub flow that called it. Call
// sites fire them with `fireSaasHook(...)` (not awaited) after their own work
// has succeeded.
// ============================================================
import { SERVICE_TYPE_TO_SLUG } from '@squadhub/shared';
import { config } from '../config';
import { supabaseAdmin } from '../supabase';
import { bridgePathWithQuery, signBridgeRequest, type BridgeActor } from './bridgeSign';
import { resolveClientIdForCard } from './activatedClientSpaces';
import { resolveRecipientUserId } from './spaceTalentHandoff';

const FETCH_TIMEOUT_MS = 10_000;
const LOG = '[saas-bridge]';

export type SaasResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number; skipped?: boolean };

/** Transport configured (secret + SaaS URL). */
export function saasBridgeEnabled(): boolean {
  return !!config.saasBridgeSecret && !!config.saasApiUrl;
}

/** Provisioning hooks switched on (and transport configured). */
export function saasProvisioningEnabled(): boolean {
  return config.saasProvisioningEnabled && saasBridgeEnabled();
}

/** Build the absolute SaaS URL for a `/bridge/v1/...` path. */
export function saasUrl(path: string): string {
  const base = config.saasApiUrl.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Signed request to the SaaS bridge. Never throws. */
export async function saasBridgeRequest<T = any>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  opts: { actor?: BridgeActor | null; timeoutMs?: number } = {},
): Promise<SaasResult<T>> {
  if (!saasBridgeEnabled()) {
    console.log(`${LOG} disabled (SAAS_BRIDGE_SECRET/SAAS_API_URL unset) — skipping ${method} ${path}`);
    return { ok: false, error: 'bridge_disabled', skipped: true };
  }
  try {
    const url = saasUrl(path);
    const rawBody = body === undefined ? '' : JSON.stringify(body);
    const headers: Record<string, string> = {
      ...signBridgeRequest(method, bridgePathWithQuery(url), rawBody, config.saasBridgeSecret),
    };
    if (rawBody) headers['Content-Type'] = 'application/json';
    if (opts.actor) headers['X-Bridge-Actor'] = JSON.stringify(opts.actor);

    const res = await fetch(url, {
      method,
      headers,
      body: rawBody || undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS),
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok || !json || json.success === false) {
      const error = json?.error || `SaaS responded ${res.status}`;
      console.error(`${LOG} ${method} ${path} failed: ${error}`);
      return { ok: false, error, status: res.status };
    }
    return { ok: true, data: (json.data ?? json) as T };
  } catch (err: any) {
    console.error(`${LOG} ${method} ${path} error:`, err?.message || err);
    return { ok: false, error: err?.message || 'request_failed' };
  }
}

/** Run a hook without awaiting it; failures are logged, never propagated. */
export function fireSaasHook(name: string, fn: () => Promise<unknown>): void {
  try {
    void fn().catch((err) => console.error(`${LOG} hook ${name} failed:`, err?.message || err));
  } catch (err: any) {
    console.error(`${LOG} hook ${name} failed:`, err?.message || err);
  }
}

// ------------------------------------------------------------
// Typed endpoint wrappers (SaaS serves)
// ------------------------------------------------------------

export interface EnsureAccountInput {
  kind: 'business' | 'talent';
  owner: { email: string; name: string; phone?: string | null };
  hub_client_id?: string | null;
  hub_partner_user_id?: string | null;
  squadhire_business_id?: string | null;
  squadhire_talent_id?: string | null;
  role_slug?: string | null;
}
export interface EnsureAccountResult {
  saas_account_id: string;
  owner_user_id: string;
  created: boolean;
}

export function ensureSaasAccount(input: EnsureAccountInput) {
  return saasBridgeRequest<EnsureAccountResult>('POST', '/bridge/v1/accounts', input);
}

export interface EnsureSharedWorkspaceInput {
  business_saas_account_id?: string | null;
  hub_client_id?: string | null;
  hub_card_id: string;
  card_category: string | null;
  hub_partner_user_id: string | null;
  account_manager_hub_user_ids: string[];
  /** Extension (not in contract v1): the card this one supersedes after an
   *  upgrade/downgrade, so the SaaS can keep the same shared workspace. */
  supersedes_hub_card_id?: string | null;
}

export function ensureSaasSharedWorkspace(input: EnsureSharedWorkspaceInput) {
  return saasBridgeRequest<any>('POST', '/bridge/v1/shared-workspaces/ensure', input);
}

export function removeSaasSharedWorkspaceMember(
  sharedWorkspaceId: string,
  who: { hub_partner_user_id?: string; hub_user_id?: string },
) {
  return saasBridgeRequest<any>(
    'POST',
    `/bridge/v1/shared-workspaces/${encodeURIComponent(sharedWorkspaceId)}/members/remove`,
    who,
  );
}

export function setSaasSharedWorkspaceState(sharedWorkspaceId: string, action: 'pause' | 'resume' | 'close') {
  return saasBridgeRequest<any>(
    'POST',
    `/bridge/v1/shared-workspaces/${encodeURIComponent(sharedWorkspaceId)}/${action}`,
    {},
  );
}

export function notifySaasSupportReply(input: { ticket_id: string; saas_user_id: string; preview: string }) {
  return saasBridgeRequest<any>('POST', '/bridge/v1/support/notify', input);
}

/** Pull the shared workspace id out of an ensure response (tolerant of shape). */
export function extractSharedWorkspaceId(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const id =
    data.shared_workspace_id ??
    data.shared_workspace?.id ??
    data.workspace_id ??
    data.id ??
    null;
  return id ? String(id) : null;
}

// ------------------------------------------------------------
// Link-table helpers
// ------------------------------------------------------------

async function linkedBusinessAccountId(clientId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('saas_account_links')
    .select('saas_account_id')
    .eq('kind', 'business')
    .eq('hub_client_id', clientId)
    .maybeSingle();
  return (data as any)?.saas_account_id ?? null;
}

async function linkedTalentAccountId(hubUserId: string | null, squadhireTalentId: string | null): Promise<string | null> {
  if (hubUserId) {
    const { data } = await supabaseAdmin
      .from('saas_account_links')
      .select('saas_account_id')
      .eq('kind', 'talent')
      .eq('hub_partner_user_id', hubUserId)
      .maybeSingle();
    if ((data as any)?.saas_account_id) return (data as any).saas_account_id;
  }
  if (squadhireTalentId) {
    const { data } = await supabaseAdmin
      .from('saas_account_links')
      .select('saas_account_id')
      .eq('kind', 'talent')
      .eq('squadhire_talent_id', squadhireTalentId)
      .maybeSingle();
    if ((data as any)?.saas_account_id) return (data as any).saas_account_id;
  }
  return null;
}

async function recordAccountLink(row: {
  kind: 'business' | 'talent';
  hub_client_id?: string | null;
  hub_partner_user_id?: string | null;
  squadhire_talent_id?: string | null;
  saas_account_id: string;
  owner_user_id?: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('saas_account_links').insert({
    ...row,
    updated_at: new Date().toISOString(),
  });
  // A concurrent hook may have recorded it first (unique index) — fine.
  if (error && !/duplicate|unique/i.test(error.message)) {
    console.error(`${LOG} record account link failed:`, error.message);
  }
}

// ------------------------------------------------------------
// Trigger hooks (gated by SAAS_PROVISIONING_ENABLED)
// ------------------------------------------------------------

/**
 * Business activation → ensure the business's SaaS account (POST /accounts
 * kind=business). Idempotent: skipped when a link already exists, and the SaaS
 * side is idempotent on hub_client_id anyway. Returns the SaaS account id.
 */
export async function saasProvisionBusinessForClient(clientId: string): Promise<string | null> {
  if (!saasProvisioningEnabled()) return null;
  try {
    const existing = await linkedBusinessAccountId(clientId);
    if (existing) return existing;

    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('id, business_name, contact_person, email, contact_number, squadhire_business_user_id')
      .eq('id', clientId)
      .maybeSingle();
    if (!client) return null;
    const email = String((client as any).email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      console.log(`${LOG} business ${clientId} has no real email — skipping SaaS account`);
      return null;
    }

    const result = await ensureSaasAccount({
      kind: 'business',
      owner: {
        email,
        name: (client as any).contact_person || (client as any).business_name || email,
        phone: (client as any).contact_number || null,
      },
      hub_client_id: clientId,
      squadhire_business_id: (client as any).squadhire_business_user_id || null,
    });
    if (!result.ok || !result.data?.saas_account_id) return null;

    await recordAccountLink({
      kind: 'business',
      hub_client_id: clientId,
      saas_account_id: String(result.data.saas_account_id),
      owner_user_id: result.data.owner_user_id ? String(result.data.owner_user_id) : null,
    });
    return String(result.data.saas_account_id);
  } catch (err: any) {
    console.error(`${LOG} provision business ${clientId} failed:`, err?.message || err);
    return null;
  }
}

/** Resolve the talent's owner identity (hub user and/or SquadHire talent). */
async function resolveTalentIdentity(
  cardId: string,
  recipientType: 'talent' | 'partner',
  recipientId: string,
): Promise<{
  hubUserId: string | null;
  squadhireTalentId: string | null;
  email: string | null;
  name: string | null;
  phone: string | null;
}> {
  const hubUserId = await resolveRecipientUserId(cardId, recipientType, recipientId);
  const squadhireTalentId = recipientType === 'talent' ? recipientId : null;
  let email: string | null = null;
  let name: string | null = null;
  let phone: string | null = null;
  if (hubUserId) {
    const { data: u } = await supabaseAdmin
      .from('users')
      .select('email, display_name, phone')
      .eq('id', hubUserId)
      .maybeSingle();
    email = (u as any)?.email ?? null;
    name = (u as any)?.display_name ?? null;
    phone = (u as any)?.phone ?? null;
  }
  if (!email && recipientType === 'talent') {
    const { data: r } = await supabaseAdmin
      .from('subscription_card_external_recipients')
      .select('email, talent_name')
      .eq('card_id', cardId)
      .eq('external_user_id', recipientId)
      .maybeSingle();
    email = (r as any)?.email ?? null;
    name = name ?? (r as any)?.talent_name ?? null;
  }
  return { hubUserId, squadhireTalentId, email, name, phone };
}

/**
 * A talent/partner became the active assignee of a card (an assignment term
 * opened — first assignment, swap, resume onto a new talent, re-assign after
 * an upgrade/downgrade). Ensures: business account, talent account
 * (POST /accounts kind=talent), and the card's shared workspace with the talent
 * in the category space plus the card's internal owners
 * (POST /shared-workspaces/ensure). Records the shared workspace id per card.
 */
export async function saasProvisionAssignment(input: {
  cardId: string;
  recipientType: 'talent' | 'partner';
  recipientId: string;
}): Promise<void> {
  if (!saasProvisioningEnabled()) return;
  const { cardId, recipientType, recipientId } = input;
  try {
    const { data: card } = await supabaseAdmin
      .from('subscription_cards')
      .select('id, service_type, submission_subscription_id, customer_email, customer_company, assignee_id, collaborator_ids, supersedes_card_id')
      .eq('id', cardId)
      .maybeSingle();
    if (!card) return;

    const clientId = await resolveClientIdForCard(card).catch(() => null);
    const businessAccountId = clientId ? await saasProvisionBusinessForClient(clientId) : null;

    const talent = await resolveTalentIdentity(cardId, recipientType, recipientId);
    const roleSlug = (card as any).service_type
      ? (SERVICE_TYPE_TO_SLUG as Record<string, string>)[(card as any).service_type] ?? null
      : null;

    let talentAccountId = await linkedTalentAccountId(talent.hubUserId, talent.squadhireTalentId);
    if (!talentAccountId) {
      if (!talent.email) {
        console.log(`${LOG} card ${cardId}: talent ${recipientId} has no email — skipping SaaS talent account`);
      } else {
        const acct = await ensureSaasAccount({
          kind: 'talent',
          owner: { email: talent.email, name: talent.name || talent.email, phone: talent.phone },
          hub_partner_user_id: talent.hubUserId,
          squadhire_talent_id: talent.squadhireTalentId,
          role_slug: roleSlug,
        });
        if (acct.ok && acct.data?.saas_account_id) {
          talentAccountId = String(acct.data.saas_account_id);
          await recordAccountLink({
            kind: 'talent',
            hub_partner_user_id: talent.hubUserId,
            squadhire_talent_id: talent.squadhireTalentId,
            saas_account_id: talentAccountId,
            owner_user_id: acct.data.owner_user_id ? String(acct.data.owner_user_id) : null,
          });
        }
      }
    }

    if (!clientId && !businessAccountId) {
      console.log(`${LOG} card ${cardId}: no Hub client resolved — skipping shared workspace`);
      return;
    }
    if (!talent.hubUserId) {
      // The contract keys workspace membership by hub_partner_user_id; a
      // SquadHire-only talent with no Hub user yet is added once they get one
      // (the next assignment hook / sync re-runs ensure).
      console.log(`${LOG} card ${cardId}: talent ${recipientId} has no Hub user yet — ensuring workspace without talent`);
    }

    const managers = [
      (card as any).assignee_id,
      ...(((card as any).collaborator_ids as string[] | null) || []),
    ].filter((v, i, a): v is string => !!v && a.indexOf(v) === i);

    const ensured = await ensureSaasSharedWorkspace({
      business_saas_account_id: businessAccountId,
      hub_client_id: clientId,
      hub_card_id: cardId,
      card_category: roleSlug ?? (card as any).service_type ?? null,
      hub_partner_user_id: talent.hubUserId,
      account_manager_hub_user_ids: managers,
      supersedes_hub_card_id: (card as any).supersedes_card_id ?? null,
    });
    if (!ensured.ok) return;
    const wsId = extractSharedWorkspaceId(ensured.data);
    if (!wsId) {
      console.error(`${LOG} card ${cardId}: ensure returned no shared workspace id`);
      return;
    }
    const { error } = await supabaseAdmin.from('saas_card_workspaces').upsert(
      {
        hub_card_id: cardId,
        shared_workspace_id: wsId,
        business_saas_account_id: businessAccountId,
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'hub_card_id' },
    );
    if (error) console.error(`${LOG} record card workspace failed:`, error.message);
  } catch (err: any) {
    console.error(`${LOG} provision assignment ${cardId} failed:`, err?.message || err);
  }
}

async function cardWorkspaceId(cardId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('saas_card_workspaces')
    .select('shared_workspace_id')
    .eq('hub_card_id', cardId)
    .maybeSingle();
  return (data as any)?.shared_workspace_id ?? null;
}

/** Card paused / resumed / closed (cancel) → mirror onto its shared workspace. */
export async function saasCardLifecycle(cardId: string, action: 'pause' | 'resume' | 'close'): Promise<void> {
  if (!saasProvisioningEnabled()) return;
  try {
    const wsId = await cardWorkspaceId(cardId);
    if (!wsId) return; // never provisioned on the SaaS — nothing to mirror
    const result = await setSaasSharedWorkspaceState(wsId, action);
    if (!result.ok) return;
    const status = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'closed';
    await supabaseAdmin
      .from('saas_card_workspaces')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('hub_card_id', cardId);
  } catch (err: any) {
    console.error(`${LOG} lifecycle ${action} ${cardId} failed:`, err?.message || err);
  }
}

/**
 * Outgoing talent released from a card (swap, reopen, undo-selection,
 * upgrade/downgrade hand-off) → remove them from the card's shared workspace.
 */
export async function saasRemoveCardTalent(cardId: string, hubUserId: string): Promise<void> {
  if (!saasProvisioningEnabled()) return;
  try {
    const wsId = await cardWorkspaceId(cardId);
    if (!wsId) return;
    await removeSaasSharedWorkspaceMember(wsId, { hub_partner_user_id: hubUserId });
  } catch (err: any) {
    console.error(`${LOG} remove talent ${hubUserId} from ${cardId} failed:`, err?.message || err);
  }
}

/**
 * Upgrade/downgrade moves the engagement to a NEW superseding card. Carry the
 * old card's shared workspace link onto the new card so lifecycle calls keep
 * targeting the same SaaS workspace (the old card's workspace is NOT closed —
 * the subscription continues).
 */
export async function saasCarryWorkspaceToSuccessor(oldCardId: string, newCardId: string): Promise<void> {
  if (!saasProvisioningEnabled()) return;
  try {
    const { data } = await supabaseAdmin
      .from('saas_card_workspaces')
      .select('shared_workspace_id, business_saas_account_id, status')
      .eq('hub_card_id', oldCardId)
      .maybeSingle();
    if (!data) return;
    await supabaseAdmin.from('saas_card_workspaces').upsert(
      {
        hub_card_id: newCardId,
        shared_workspace_id: (data as any).shared_workspace_id,
        business_saas_account_id: (data as any).business_saas_account_id,
        status: (data as any).status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'hub_card_id' },
    );
  } catch (err: any) {
    console.error(`${LOG} carry workspace ${oldCardId} -> ${newCardId} failed:`, err?.message || err);
  }
}
