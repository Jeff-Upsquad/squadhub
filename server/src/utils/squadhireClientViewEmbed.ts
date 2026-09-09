const FETCH_TIMEOUT_MS = 10_000;

export type ClientViewActor = {
  id: string | null;
  email: string | null;
  name: string | null;
};

export type ClientViewEmbedResult =
  | { supported: false; reason: string }
  | { supported: true; embed_url: string; expires_at: string | null };

/**
 * Hosts we will load in the Client view iframe. Anything else is rejected so a
 * compromised or misconfigured SquadHire reply cannot point the Hub at a
 * third-party page.
 */
export function squadhireEmbedHosts(webhookUrl: string, adminUrl: string): string[] {
  const hosts = new Set<string>();
  for (const raw of [webhookUrl, adminUrl]) {
    if (!raw) continue;
    try {
      hosts.add(new URL(raw).host);
    } catch {
      // ignore unparseable config
    }
  }
  return [...hosts];
}

export function isAllowedClientViewEmbedUrl(embedUrl: string, allowedHosts: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(embedUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (parsed.protocol === 'http:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    return false;
  }
  return allowedHosts.includes(parsed.host);
}

export function parseEmbedPayload(json: unknown): { embed_url: string; expires_at: string | null } | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root;
  const embedUrl = typeof data.embed_url === 'string' ? data.embed_url.trim() : '';
  if (!embedUrl) return null;
  const expiresAt = typeof data.expires_at === 'string' ? data.expires_at : null;
  return { embed_url: embedUrl, expires_at: expiresAt };
}

function embedWebhookUrl(webhookUrl: string): string {
  const url = new URL(webhookUrl);
  url.pathname = '/api/webhooks/squadhub/cards/client-view/embed';
  url.search = '';
  return url.toString();
}

/**
 * Ask SquadHire for a one-time operator embed URL. The Hub user is already
 * signed in; SquadHire should mint a short-lived "acting for this business"
 * session and not prompt for the client's password.
 *
 * 404 / 501 means this SquadHire deploy does not support embed yet — callers
 * fall back to the reconstructed Client view.
 */
export async function requestClientViewEmbed(input: {
  webhookUrl: string;
  webhookSecret: string;
  squadhireAdminUrl?: string;
  externalId: string;
  actor: ClientViewActor;
  parentOrigins: string[];
  timeoutMs?: number;
}): Promise<ClientViewEmbedResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-SquadHub-Signature': input.webhookSecret,
    };
    if (input.actor.email) headers['X-SquadHub-Actor'] = input.actor.email;
    if (input.actor.name) headers['X-SquadHub-Actor-Name'] = input.actor.name;

    const res = await fetch(embedWebhookUrl(input.webhookUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        external_id: input.externalId,
        actor: input.actor,
        parent_origins: input.parentOrigins,
        mode: 'operator',
      }),
      signal: controller.signal,
    });

    if (res.status === 404 || res.status === 501) {
      return { supported: false, reason: 'not_implemented' };
    }
    if (!res.ok) {
      return { supported: false, reason: `upstream_${res.status}` };
    }

    const json = (await res.json().catch(() => null)) as unknown;
    const parsed = parseEmbedPayload(json);
    if (!parsed) return { supported: false, reason: 'malformed' };

    const allowed = squadhireEmbedHosts(input.webhookUrl, input.squadhireAdminUrl ?? '');
    if (!isAllowedClientViewEmbedUrl(parsed.embed_url, allowed)) {
      console.error('[client-view-embed] rejected embed_url host', parsed.embed_url);
      return { supported: false, reason: 'untrusted_host' };
    }

    return { supported: true, embed_url: parsed.embed_url, expires_at: parsed.expires_at };
  } catch (err) {
    console.error('[client-view-embed] fetch failed', (err as Error)?.message);
    return { supported: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
