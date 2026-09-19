import type { Request } from 'express';

// Client platform that created a task. Orthogonal to `source_kind`
// (domain origin: course/meeting/sop/post). Keep in sync with:
//   - supabase/migrations/20260920000000_task_created_via.sql (CHECK)
//   - shared Task.created_via + CLIENT_SOURCE_LABELS
export const CLIENT_SOURCES = [
  'web',
  'mobile_web',
  'desktop_app',
  'companion',
  'partner_app',
  'internal_app',
  'business_app',
  'mobile_app',
  'public_form',
  'system',
  'api',
  'unknown',
] as const;

export type ClientSource = (typeof CLIENT_SOURCES)[number];

const ALIASES: Record<string, ClientSource> = {
  companion_app: 'companion',
  'desktop-companion': 'companion',
  desktop_companion: 'companion',
  desktop: 'desktop_app',
  tauri: 'desktop_app',
  mobile: 'mobile_app',
  android: 'mobile_app',
  ios: 'mobile_app',
  partner: 'partner_app',
  internal: 'internal_app',
  business: 'business_app',
  web_app: 'web',
  browser: 'web',
};

function normalize(raw: unknown): ClientSource | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase().replace(/-/g, '_');
  if ((CLIENT_SOURCES as readonly string[]).includes(v)) return v as ClientSource;
  return ALIASES[v] ?? null;
}

function fromUserAgent(ua: string | undefined): ClientSource | null {
  if (!ua) return null;
  // Native Android/iOS HTTP stacks (OkHttp, Dalvik, NSURLSession, Expo).
  // These builds predate the X-Client-Source header, so they land here as
  // generic 'mobile_app' until upgraded to send partner_app/internal_app/business_app.
  if (/Dalvik|OkHttp|NSURLSession|CFNetwork|Expo|ReactNative|Capacitor/i.test(ua)) {
    return 'mobile_app';
  }
  // Tauri WebView: default UA is the plain WebView UA, but some shells append a marker.
  if (/Tauri/i.test(ua)) return 'desktop_app';
  // Mobile browsers (incl. the responsive /mobile shell) vs desktop browsers.
  if (/Mobi|Android|iPhone|iPad|Mobile/i.test(ua)) return 'mobile_web';
  if (/Mozilla|Chrome|Safari|Firefox|Edg|OPR/i.test(ua)) return 'web';
  return null;
}

/**
 * Resolve which client platform is creating a task.
 *
 * Precedence: explicit body field > X-Client-Source header > User-Agent
 * heuristics > fallback. Never throws, never returns null — unknown writers
 * get `fallback` (default 'unknown') so old app versions keep working.
 *
 * Contract for all writers (web, desktop-app shell, menu-bar companion, the 3
 * native Android apps Partner/Internal/Business): send
 * `X-Client-Source: <value>` (preferred) or body `{ client_source: <value> }`.
 */
export function resolveClientSource(
  req: Pick<Request, 'headers'>,
  opts: { explicit?: unknown; fallback?: ClientSource } = {},
): ClientSource {
  const fallback = opts.fallback ?? 'unknown';
  return (
    normalize(opts.explicit) ??
    normalize((req.headers as Record<string, unknown>)['x-client-source']) ??
    fromUserAgent(
      (req.headers as Record<string, unknown>)['user-agent'] as string | undefined,
    ) ??
    fallback
  );
}
