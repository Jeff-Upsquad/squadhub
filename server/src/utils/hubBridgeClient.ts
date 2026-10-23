/**
 * Outbound, signed calls from Squad Hub SaaS to the internal Squad Hub
 * (`${HUB_API_URL}/bridge/v1/*`). See docs/bridge-contract.md; signing lives in
 * utils/bridgeSign.ts (identical in both repos).
 *
 * The Hub owns client cards, job cards, assignments, payouts, payments and
 * support tickets. When the bridge is disabled (HUB_API_URL / SAAS_BRIDGE_SECRET
 * unset) or the Hub can't be reached, every call fails with a HubUnavailableError
 * that routes turn into a 503 `{ code: 'hub_unavailable' }` — the web shows
 * "temporarily unavailable" for that panel only; tasks, chat and everything the
 * SaaS owns keep working.
 */
import { config } from '../config';
import { signBridgeRequest } from './bridgeSign';

const DEFAULT_TIMEOUT_MS = 10_000;
const LOG = '[hub-bridge]';

export const HUB_UNAVAILABLE_MESSAGE =
  'This is temporarily unavailable — Squad Hub could not be reached. Your tasks and chat keep working; please try again in a few minutes.';

/** The Hub could not be reached (disabled, network error, timeout, 5xx). */
export class HubUnavailableError extends Error {
  readonly code = 'hub_unavailable';
  constructor(public reason: string) {
    super(HUB_UNAVAILABLE_MESSAGE);
    this.name = 'HubUnavailableError';
  }
}

/** The Hub answered with a 4xx `{ success:false, error }` — pass it through. */
export class HubRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HubRequestError';
  }
}

export interface HubActor {
  hub_user_id?: string | null;
  email?: string | null;
}

export function hubBridgeEnabled(): boolean {
  return !!config.hubApiUrl && !!config.saasBridgeSecret;
}

/** Absolute Hub URL for a `/bridge/v1/...` path (keeps any prefix on HUB_API_URL). */
export function hubUrl(pathWithQuery: string): string {
  const base = config.hubApiUrl.replace(/\/+$/, '');
  return `${base}${pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`}`;
}

function withQuery(path: string, query?: Record<string, string | number | null | undefined>): string {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    qs.append(k, String(v));
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * Signed request to the Hub bridge. Resolves with the `data` of a
 * `{ success: true, data }` reply; throws HubUnavailableError /
 * HubRequestError otherwise.
 */
export async function hubBridgeRequest<T = any>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  opts: {
    query?: Record<string, string | number | null | undefined>;
    body?: unknown;
    actor?: HubActor | null;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  if (!hubBridgeEnabled()) {
    console.log(`${LOG} disabled (HUB_API_URL/SAAS_BRIDGE_SECRET unset) — ${method} ${path} not sent`);
    throw new HubUnavailableError('bridge_disabled');
  }
  const pathWithQuery = withQuery(path, opts.query);
  const url = hubUrl(pathWithQuery);
  const rawBody = opts.body === undefined || method === 'GET' ? '' : JSON.stringify(opts.body);
  // Sign the path as the Hub sees it: from `/bridge/` on (bridgeSign strips any prefix).
  const { timestamp, signature } = signBridgeRequest(method, new URL(url).pathname + new URL(url).search, rawBody, config.saasBridgeSecret);
  const headers: Record<string, string> = {
    'X-Bridge-Timestamp': timestamp,
    'X-Bridge-Signature': signature,
    Accept: 'application/json',
  };
  if (rawBody) headers['Content-Type'] = 'application/json';
  if (opts.actor && (opts.actor.hub_user_id || opts.actor.email)) {
    headers['X-Bridge-Actor'] = JSON.stringify(opts.actor);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: rawBody || undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err: any) {
    console.error(`${LOG} ${method} ${path} unreachable:`, err?.message || err);
    throw new HubUnavailableError(err?.name === 'TimeoutError' ? 'timeout' : 'network');
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (res.status >= 500 || res.status === 401 || res.status === 503 || !json || typeof json.success !== 'boolean') {
    // 401 = secrets out of sync, 503 = Hub bridge switched off, 5xx = Hub fault:
    // all "temporarily unavailable" to the user. Logged for operators.
    console.error(`${LOG} ${method} ${path} failed: HTTP ${res.status} ${json?.error ?? ''}`);
    throw new HubUnavailableError(`http_${res.status}`);
  }
  if (!res.ok || json.success === false) {
    throw new HubRequestError(res.status, json.error || `Squad Hub responded ${res.status}`);
  }
  return (json.data ?? null) as T;
}

/** Turn a bridge failure into the HTTP reply the SaaS web expects. */
export function sendHubError(res: import('express').Response, err: unknown): void {
  if (err instanceof HubUnavailableError) {
    res.status(503).json({ success: false, code: 'hub_unavailable', error: err.message });
    return;
  }
  if (err instanceof HubRequestError) {
    res.status(err.status).json({ success: false, error: err.message });
    return;
  }
  console.error(`${LOG} unexpected error:`, err);
  res.status(500).json({ success: false, error: 'Internal server error' });
}

// ------------------------------------------------------------------ endpoints
const enc = encodeURIComponent;

export const hub = {
  businessCards: (hubClientId: string) => hubBridgeRequest('GET', `/bridge/v1/business/${enc(hubClientId)}/cards`),
  businessPayments: (hubClientId: string, months?: number) =>
    hubBridgeRequest('GET', `/bridge/v1/business/${enc(hubClientId)}/payments`, { query: { months } }),
  talentAssignments: (hubPartnerUserId: string, includeEnded = false) =>
    hubBridgeRequest('GET', `/bridge/v1/talent/${enc(hubPartnerUserId)}/assignments`, {
      query: { include_ended: includeEnded ? '1' : undefined },
    }),
  talentOpportunities: (hubPartnerUserId: string) =>
    hubBridgeRequest<any[]>('GET', `/bridge/v1/talent/${enc(hubPartnerUserId)}/opportunities`),
  talentPayouts: (hubPartnerUserId: string, month?: string) =>
    hubBridgeRequest('GET', `/bridge/v1/talent/${enc(hubPartnerUserId)}/payouts`, { query: { month } }),
  talentPayoutHistory: (hubPartnerUserId: string, months?: number) =>
    hubBridgeRequest('GET', `/bridge/v1/talent/${enc(hubPartnerUserId)}/payouts/history`, { query: { months } }),

  createTicket: (body: {
    saas_account_id: string;
    saas_user: { id: string; email: string; name: string };
    hub_user_id?: string | null;
    category: string;
    subject: string;
    body: string;
    priority?: string;
    attachments?: { url: string; name?: string; size?: number; mime?: string }[];
  }) => hubBridgeRequest<{ ticket_id: string; ticket_number: number; ticket_code?: string }>('POST', '/bridge/v1/support/tickets', { body }),
  listTickets: (saasUserId: string) =>
    hubBridgeRequest<any[]>('GET', '/bridge/v1/support/tickets', { query: { saas_user_id: saasUserId } }),
  ticketThread: (ticketId: string, saasUserId: string) =>
    hubBridgeRequest('GET', `/bridge/v1/support/tickets/${enc(ticketId)}/messages`, { query: { saas_user_id: saasUserId } }),
  replyTicket: (ticketId: string, body: { saas_user_id: string; content?: string; attachments?: any[] }) =>
    hubBridgeRequest('POST', `/bridge/v1/support/tickets/${enc(ticketId)}/messages`, { body }),
  setTicketStatus: (ticketId: string, action: 'close' | 'reopen', saasUserId: string) =>
    hubBridgeRequest('POST', `/bridge/v1/support/tickets/${enc(ticketId)}/${action}`, { body: { saas_user_id: saasUserId } }),

  timeTotals: (body: { date: string; entries: { hub_card_id: string; hub_partner_user_id: string; minutes: number }[] }) =>
    hubBridgeRequest('POST', '/bridge/v1/time-totals', { body, timeoutMs: 30_000 }),
  staff: (hubUserId: string) =>
    hubBridgeRequest<{
      hub_user_id: string;
      email: string | null;
      name: string | null;
      avatar_url: string | null;
      is_staff: boolean;
      active: boolean;
    }>('GET', `/bridge/v1/staff/${enc(hubUserId)}`),
};
