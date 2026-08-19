/**
 * Match a card's service line to a Squad CRM pipeline.
 *
 * CRM runs a pipeline family per service line — "Designer and Editor Leads",
 * "Accountant Deals", "Marketing - Accountant leads" — so the same customer can
 * sit in several pipelines at once. A card should take its owner from the
 * pipeline that matches what the card is FOR: an accountant card follows the
 * accountant pipelines, a designer/editor card follows those.
 *
 * Matching is by name rather than a hardcoded table, so a service line added
 * later (digital marketer, photographer…) starts working the moment someone
 * names its pipeline after it — no code change here.
 */

/**
 * Words that describe the pipeline's ROLE, not its service line. Stripping them
 * first is what keeps "Marketing - Accountant leads" from colliding with a
 * future "Digital Marketer" card.
 */
const PIPELINE_NOISE = new Set([
  'lead',
  'deal',
  'nurture',
  'marketing',
  'pipeline',
  'client',
  'customer',
  'onboarding',
  'main',
  'default',
  'old',
  'new',
  'general',
  'misc',
  'other',
  'archive',
  'archived',
  'and',
  'or',
  'plus',
  'the',
  'with',
  'for',
  'team',
  'squad',
]);

/** Lowercase → split on any non-letter/digit → drop noise → naive singular. */
export function serviceTokens(label: string | null | undefined): string[] {
  if (!label) return [];
  const out = new Set<string>();
  for (const raw of label.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || raw.length < 3) continue;
    const word = raw.endsWith('s') && raw.length > 3 ? raw.slice(0, -1) : raw;
    if (PIPELINE_NOISE.has(word)) continue;
    out.add(word);
  }
  return Array.from(out);
}

/**
 * Two tokens are the same service if they're equal, or if one is a prefix of
 * the other and long enough for that to be meaningful ("account" ⊂
 * "accountant"). The length floor keeps short accidental prefixes apart.
 */
const MIN_STEM = 5;

function sameService(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= MIN_STEM && b.startsWith(a)) return true;
  if (b.length >= MIN_STEM && a.startsWith(b)) return true;
  return false;
}

/**
 * Does this pipeline belong to the card's service line? Returns false when
 * either side has nothing to go on — an unknown service line must never look
 * like a confident match.
 */
export function pipelineMatchesService(
  pipelineName: string | null | undefined,
  cardServiceLabel: string | null | undefined,
): boolean {
  const cardTokens = serviceTokens(cardServiceLabel);
  const pipeTokens = serviceTokens(pipelineName);
  if (cardTokens.length === 0 || pipeTokens.length === 0) return false;
  return cardTokens.some((c) => pipeTokens.some((p) => sameService(c, p)));
}

/**
 * The opposite question: does this pipeline clearly belong to a DIFFERENT
 * service line? Only true when both sides name a service and none of them
 * overlap — so an unnamed or generic pipeline ("Main Deals") never counts as a
 * conflict, it is simply neutral.
 */
export function pipelineConflictsWithService(
  pipelineName: string | null | undefined,
  cardServiceLabel: string | null | undefined,
): boolean {
  const cardTokens = serviceTokens(cardServiceLabel);
  const pipeTokens = serviceTokens(pipelineName);
  if (cardTokens.length === 0 || pipeTokens.length === 0) return false;
  return !cardTokens.some((c) => pipeTokens.some((p) => sameService(c, p)));
}
