// ============================================================
// Link unfurl service — fetches OpenGraph metadata for the first URL
// in a message. Non-blocking on the send path; if it fails, message
// still posts with unfurl=null.
//
// Lightweight regex-based parser (no cheerio dep). Trades robustness
// for zero dependencies; covers the 95% case (og:title, og:description,
// og:image, og:site_name, <title>).
// ============================================================

const URL_RE = /(https?:\/\/[^\s<>"']+)/i;
const FETCH_TIMEOUT_MS = 4000;
const MAX_BYTES = 512 * 1024; // 512 KB max — head + opening tags only

export interface UnfurlResult {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  site_name?: string;
}

// Block private IP ranges to avoid SSRF. Coarse: skip the common
// metadata endpoints + loopback + RFC1918.
function isSafeUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '0.0.0.0') return false;
    if (host === '169.254.169.254') return false; // EC2 / GCP metadata
    if (/^127\./.test(host)) return false;
    if (/^10\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

// Pull the first URL from a message body, if any.
export function findFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(URL_RE);
  return m ? m[1].replace(/[)\].,;:!?]+$/, '') : null;
}

function pickMeta(html: string, names: string[]): string | undefined {
  for (const name of names) {
    // Match either <meta property="og:title" content="..."> or content first.
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, 'i');
    const m = html.match(re1) || html.match(re2);
    if (m && m[1]) return decode(m[1]).trim();
  }
  return undefined;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export async function unfurl(rawUrl: string): Promise<UnfurlResult | null> {
  if (!isSafeUrl(rawUrl)) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const resp = await fetch(rawUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'SquadHubBot/1.0 (+https://squadhub.in)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timer);

    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    if (!ct.toLowerCase().includes('text/html')) return null;

    // Read up to MAX_BYTES then stop.
    const reader = resp.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (received < MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
      }
    }
    try { await reader.cancel(); } catch { /* ignore */ }
    const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');

    const title =
      pickMeta(html, ['og:title', 'twitter:title']) ||
      (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim());
    const description = pickMeta(html, ['og:description', 'twitter:description', 'description']);
    let image = pickMeta(html, ['og:image', 'og:image:url', 'twitter:image']);
    const site_name = pickMeta(html, ['og:site_name']);

    // Resolve relative image URLs against the final response URL.
    if (image && !/^https?:\/\//i.test(image)) {
      try {
        image = new URL(image, resp.url).toString();
      } catch {
        image = undefined;
      }
    }

    if (!title && !description && !image) return null;

    return { url: rawUrl, title, description, image, site_name };
  } catch {
    return null;
  }
}
