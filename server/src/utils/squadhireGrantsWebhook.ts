import { config } from '../config';
import { supabaseAdmin } from '../supabase';

/**
 * Outbound delivery of profile_access_grants to SquadHire's grant ingest
 * webhook.
 *
 * Mirrors the rhythm of squadhireWebhook.ts (subscription cards):
 *   - Inline 3 attempts with 0/2/10s backoff at the time of the SquadHub
 *     mutation.
 *   - If still undelivered the grant row is left with profiles_synced_at
 *     NULL and profiles_sync_last_error populated. A setInterval sweeper
 *     retries every 5 min up to MAX_SYNC_ATTEMPTS.
 *   - If SQUADHIRE_WEBHOOK_URL is unset, delivery is a no-op with a logged
 *     reason, so local dev without SquadHire configured still works.
 *
 * Action verbs:
 *   create — POST   /api/integrations/squadhub/talent-access/grants
 *   update — PATCH  /api/integrations/squadhub/talent-access/grants/:id
 *   revoke — PATCH  /api/integrations/squadhub/talent-access/grants/:id
 *   delete — DELETE /api/integrations/squadhub/talent-access/grants/:id
 *
 * The `:id` here is the Profiles talent_access_grants.id, which we cache
 * locally as profiles_grant_id once the create round-trip completes.
 */

const REQUEST_TIMEOUT_MS = 3_000;
const INLINE_ATTEMPTS = 3;
const INLINE_BACKOFF_MS = [0, 2_000, 10_000];
const MAX_SYNC_ATTEMPTS = 10;
const SWEEPER_INTERVAL_MS = 5 * 60 * 1_000;
const SWEEPER_BATCH_SIZE = 20;

interface GrantPayload {
  squadhub_grant_id: string;
  email: string;
  category_ids: string[];
  expires_at: string;
  revoked_at: string | null;
  notes: string | null;
  created_by_squadhub_user_id: string | null;
}

interface AttemptOutcome {
  delivered: boolean;
  error?: string;
  profilesGrantId?: string;
}

// ------------------------------------------------------------
// URL derivation
// ------------------------------------------------------------

/**
 * Derive the grants endpoint from the existing card webhook URL so we don't
 * need a second env var. The cards URL is e.g.
 *   https://upsquadconnect.com/api/webhooks/squadhub/cards
 * Grants live under integrations on the receiving side:
 *   https://upsquadconnect.com/api/integrations/squadhub/talent-access/grants
 */
function grantsUrl(profilesGrantId?: string): string | null {
  const base = config.squadhireWebhookUrl;
  if (!base) return null;
  try {
    const u = new URL(base);
    u.pathname = profilesGrantId
      ? `/api/integrations/squadhub/talent-access/grants/${profilesGrantId}`
      : '/api/integrations/squadhub/talent-access/grants';
    u.search = '';
    return u.toString();
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// Payload construction
// ------------------------------------------------------------

async function buildPayload(grantId: string): Promise<GrantPayload | null> {
  const { data: grant } = await supabaseAdmin
    .from('profile_access_grants')
    .select('id, email, category_ids, expires_at, revoked_at, notes, created_by')
    .eq('id', grantId)
    .maybeSingle();
  if (!grant) return null;
  return {
    squadhub_grant_id: grant.id as string,
    email: grant.email as string,
    category_ids: Array.isArray(grant.category_ids) ? (grant.category_ids as string[]) : [],
    expires_at: grant.expires_at as string,
    revoked_at: (grant.revoked_at as string | null) ?? null,
    notes: (grant.notes as string | null) ?? null,
    created_by_squadhub_user_id: (grant.created_by as string | null) ?? null,
  };
}

// ------------------------------------------------------------
// Single attempt
// ------------------------------------------------------------

async function postOnce(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: object | null,
): Promise<AttemptOutcome> {
  if (!config.squadhireWebhookSecret) {
    return { delivered: false, error: 'squadhire_webhook_secret_not_configured' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-SquadHub-Signature': config.squadhireWebhookSecret,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) return { delivered: false, error: `http_${res.status}` };
    const parsed = (await res.json().catch(() => ({}))) as any;
    return {
      delivered: true,
      profilesGrantId:
        typeof parsed?.profiles_grant_id === 'string'
          ? parsed.profiles_grant_id
          : typeof parsed?.id === 'string'
            ? parsed.id
            : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { delivered: false, error: msg.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
// Persist sync state on the grant row
// ------------------------------------------------------------

async function persistResult(
  grantId: string,
  outcome: AttemptOutcome,
  attemptsDelta: number,
): Promise<void> {
  const { data: current } = await supabaseAdmin
    .from('profile_access_grants')
    .select('profiles_sync_attempts')
    .eq('id', grantId)
    .maybeSingle();

  const patch: Record<string, unknown> = {
    profiles_sync_attempts: (current?.profiles_sync_attempts ?? 0) + attemptsDelta,
    profiles_sync_last_error: outcome.delivered ? null : outcome.error ?? 'unknown_error',
  };
  if (outcome.delivered) {
    patch.profiles_synced_at = new Date().toISOString();
    if (outcome.profilesGrantId) {
      patch.profiles_grant_id = outcome.profilesGrantId;
    }
  }

  const { error } = await supabaseAdmin
    .from('profile_access_grants')
    .update(patch)
    .eq('id', grantId);
  if (error) {
    console.error('[squadhire-grants-webhook] failed to persist sync state', error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ------------------------------------------------------------
// Public: deliver a single mutation inline (called from the route handlers).
// Never throws.
// ------------------------------------------------------------

export async function deliverGrantMutation(
  grantId: string,
  action: 'create' | 'update' | 'revoke',
): Promise<void> {
  const payload = await buildPayload(grantId);
  if (!payload) return;

  // Look up the existing profiles_grant_id (set after a successful create, or
  // populated via inbound callback for grants that originated on the Profiles
  // side). For `create` we should NOT have one yet; if we do, fall through to
  // PATCH so we don't double-create.
  const { data: row } = await supabaseAdmin
    .from('profile_access_grants')
    .select('profiles_grant_id')
    .eq('id', grantId)
    .maybeSingle();
  const existingProfilesId = (row?.profiles_grant_id as string | null) ?? null;

  const isCreate = action === 'create' && !existingProfilesId;
  const url = grantsUrl(isCreate ? undefined : existingProfilesId ?? undefined);
  if (!url) {
    await persistResult(grantId, { delivered: false, error: 'squadhire_webhook_url_not_configured' }, INLINE_ATTEMPTS);
    return;
  }

  let lastOutcome: AttemptOutcome = { delivered: false, error: 'not_attempted' };
  for (let i = 0; i < INLINE_ATTEMPTS; i++) {
    if (INLINE_BACKOFF_MS[i] > 0) await sleep(INLINE_BACKOFF_MS[i]);
    lastOutcome = await postOnce(url, isCreate ? 'POST' : 'PATCH', payload);
    if (lastOutcome.delivered) break;
  }
  await persistResult(grantId, lastOutcome, INLINE_ATTEMPTS);
}

// ------------------------------------------------------------
// Public: delete propagation. Best-effort, single attempt — if the row was
// already gone on the SquadHub side the local row is also gone, so there's
// nothing to retry against. We log on failure and move on.
// ------------------------------------------------------------

export async function deliverGrantDelete(profilesGrantId: string | null): Promise<void> {
  if (!profilesGrantId) return; // never made it to SquadHire — nothing to delete there
  const url = grantsUrl(profilesGrantId);
  if (!url) {
    console.warn('[squadhire-grants-webhook] delete skipped: url not configured');
    return;
  }
  const outcome = await postOnce(url, 'DELETE', null);
  if (!outcome.delivered) {
    console.warn(`[squadhire-grants-webhook] delete failed: ${outcome.error}`);
  }
}

// ------------------------------------------------------------
// Public: background sweeper — retries grants that never synced.
// ------------------------------------------------------------

export function startProfileAccessGrantsSyncSweeper(): NodeJS.Timeout {
  const tick = async () => {
    try {
      const { data: grants, error } = await supabaseAdmin
        .from('profile_access_grants')
        .select('id, profiles_grant_id')
        .is('profiles_synced_at', null)
        .lt('profiles_sync_attempts', MAX_SYNC_ATTEMPTS)
        .order('updated_at', { ascending: true })
        .limit(SWEEPER_BATCH_SIZE);

      if (error) {
        console.error('[squadhire-grants-webhook] sweeper query failed', error);
        return;
      }
      if (!grants || grants.length === 0) return;

      for (const g of grants as Array<{ id: string; profiles_grant_id: string | null }>) {
        const payload = await buildPayload(g.id);
        if (!payload) continue;
        const isCreate = !g.profiles_grant_id;
        const url = grantsUrl(isCreate ? undefined : g.profiles_grant_id ?? undefined);
        if (!url) continue;
        const outcome = await postOnce(url, isCreate ? 'POST' : 'PATCH', payload);
        await persistResult(g.id, outcome, 1);
      }
    } catch (err) {
      console.error('[squadhire-grants-webhook] sweeper tick errored', err);
    }
  };

  const handle = setInterval(tick, SWEEPER_INTERVAL_MS);
  setTimeout(tick, 15_000);
  return handle;
}
