// Shared URL detection used by every place that turns plain text into links
// (chat messages, task descriptions, inbox details). Keeping one definition
// avoids the surfaces drifting apart — e.g. chat linking a URL that the inbox
// leaves as plain text.

// Common top-level domains accepted for *bare* (scheme-less) URLs. A bare
// domain is only linked when it ends in one of these OR is followed by a path,
// so everyday tokens like "Node.js", "config.json", or "README.md" stay plain.
const COMMON_TLD =
  'com|net|org|io|co|ai|app|dev|gov|edu|info|biz|xyz|me|tv|gg|live|link|page|site|cloud|tech|us|uk|ca|in';
const HOST = String.raw`(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+`;

// Matches three URL shapes, in priority order:
//   1. scheme URLs   — https://example.com/x
//   2. www. hosts    — www.example.com/x
//   3. bare domains  — meet.google.com/x, t.meet/x
// Exposed as a source string (only non-capturing groups) so callers can embed
// it inside a larger regex — e.g. the chat inline-markdown splitter relies on
// there being exactly one capture group, so this must add none.
export const URL_PATTERN =
  String.raw`\b(?:` +
  String.raw`https?:\/\/[^\s<>"']+` + // scheme URL
  String.raw`|www\.[^\s<>"']+` + // www. host
  `|${HOST}(?:${COMMON_TLD})\\b(?:\\/[^\\s<>"']*)?` + // bare domain w/ common TLD
  `|${HOST}[a-z]{2,}\\/[^\\s<>"']+` + // bare domain w/ any TLD + path
  `)`;

// Anchored single-token test, for callers that already hold an isolated token.
export const URL_TEST = new RegExp(`^(?:${URL_PATTERN})$`, 'i');

const TRAILING_PUNCT_RE = /[.,!?;:)\]}'"]+$/;

// Sentence punctuation often trails a URL in prose but isn't part of it
// ("join meet.google.com." → link "meet.google.com", text ".").
export function splitTrailingPunct(token: string): { url: string; tail: string } {
  const m = token.match(TRAILING_PUNCT_RE);
  if (!m) return { url: token, tail: '' };
  return { url: token.slice(0, token.length - m[0].length), tail: m[0] };
}

// Build an href from a matched token, adding https:// when there's no scheme.
export function toHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
