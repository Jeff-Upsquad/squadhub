import type { JobMatchRules, JobRuleOverrides } from '@squadhub/shared';

/**
 * Effective match-rule computation for job cards.
 *
 * job_profiles.preference_rules is the base; job_cards.rule_overrides wins
 * key-by-key. An EXPLICIT null in the overrides means "clear this rule" — the
 * profile default is dropped from the effective rules entirely (an absent key
 * just inherits). The output key vocabulary is BINDING per the cross-repo
 * contract (§3, Profiles' matcher vocabulary wins) and maps 1:1 onto the
 * webhook match_rules. Effective rules are computed at payload-build /
 * preview time — never stored.
 */

export const JOB_MATCH_RULE_KEYS = [
  'category_ids',
  'target_tiers',
  'min_experience_years',
  'max_experience_years',
  'target_languages',
  'target_country_names',
  'target_regions',
  'min_age',
  'max_age',
  'target_genders',
  'target_districts',
] as const;

export type JobMatchRuleKey = (typeof JOB_MATCH_RULE_KEYS)[number];

/**
 * True when the value is worth sending to the matcher. Empty arrays and
 * non-positive numbers are noise: SquadHire treats an absent axis as "no
 * filter", and sending `min_age: 0` would needlessly fail-closed talents with
 * a null age (bounded age rules fail closed on the Profiles matcher).
 */
function meaningful(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  return true;
}

export function mergeJobRules(
  base: JobMatchRules | null | undefined,
  overrides: JobRuleOverrides | null | undefined,
): JobMatchRules {
  const merged: Record<string, unknown> = {};
  for (const key of JOB_MATCH_RULE_KEYS) {
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
      const ov = (overrides as Record<string, unknown>)[key];
      // Explicit null = "clear this rule" — skip the base value too.
      if (ov === null) continue;
      if (ov !== undefined) {
        if (meaningful(ov)) merged[key] = ov;
        continue;
      }
    }
    const bv = base ? (base as Record<string, unknown>)[key] : undefined;
    if (meaningful(bv)) merged[key] = bv;
  }
  return merged as JobMatchRules;
}
