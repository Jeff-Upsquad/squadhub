'use client';

import type { JobMatchRules, JobRuleOverrides } from '@squadhub/shared';
import {
  RULE_ROWS,
  RuleRowValueEditor,
  summarizeRuleRow,
  type Country,
  type RuleRow,
} from './PreferenceRulesEditor';

// Card-level rule overrides over the job profile's preference_rules — one
// toggle row per rule (contract §3: same JobMatchRules key vocabulary). Three
// states per rule, matching the rule_overrides JSONB semantics exactly:
//   Inherited  — key absent from rule_overrides (profile default applies)
//   Overridden — key present with a value (card wins)
//   Cleared    — key present with an EXPLICIT null (mergeJobRules drops the
//                axis entirely — "match anyone on this rule")

type RowMode = 'inherited' | 'overridden' | 'cleared';

function rowMode(row: RuleRow, overrides: JobRuleOverrides): RowMode {
  const present = row.keys.filter((k) => k in overrides);
  if (present.length === 0) return 'inherited';
  if (present.every((k) => overrides[k] === null) && present.length === row.keys.length) return 'cleared';
  return 'overridden';
}

/** Row values as plain JobMatchRules for the shared value editor (nulls → undefined). */
function rowValues(row: RuleRow, overrides: JobRuleOverrides): JobMatchRules {
  const out: Record<string, unknown> = {};
  row.keys.forEach((k) => {
    const v = overrides[k];
    if (v !== null && v !== undefined) out[k] = v;
  });
  return out as JobMatchRules;
}

export default function RuleOverridesEditor({
  profileRules,
  overrides,
  onChange,
  countries,
}: {
  /** The linked job profile's preference_rules (the inherited defaults). */
  profileRules: JobMatchRules;
  overrides: JobRuleOverrides;
  onChange: (next: JobRuleOverrides) => void;
  countries: Country[];
}) {
  const setMode = (row: RuleRow, mode: RowMode) => {
    const next: JobRuleOverrides = { ...overrides };
    if (mode === 'inherited') {
      row.keys.forEach((k) => delete next[k]);
    } else if (mode === 'cleared') {
      row.keys.forEach((k) => {
        next[k] = null;
      });
    } else {
      // Seed the override with the profile's current values so the admin
      // starts from what would have applied, then edits.
      row.keys.forEach((k) => {
        const seed = profileRules[k];
        (next as Record<string, unknown>)[k] = seed !== undefined ? seed : null;
      });
    }
    onChange(next);
  };

  const patchRow = (row: RuleRow, patch: JobMatchRules) => {
    const next: JobRuleOverrides = { ...overrides };
    row.keys.forEach((k) => {
      if (k in patch) {
        const v = patch[k];
        // Inside an overridden row an emptied value stays an override (empty
        // array / undefined ⇒ null = clear this axis), never silently reverts
        // to inherited.
        (next as Record<string, unknown>)[k] = v === undefined || (Array.isArray(v) && v.length === 0) ? null : v;
      }
    });
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {RULE_ROWS.map((row) => {
        const mode = rowMode(row, overrides);
        // Whether the job profile actually sets this rule — clearing an
        // already-"Any" rule is a no-op, so don't alarm with the red warning.
        const hasProfileDefault = row.keys.some((k) => {
          const v = (profileRules as Record<string, unknown>)[k];
          return Array.isArray(v) ? v.length > 0 : v != null;
        });
        return (
          <div key={row.id} className="rounded-lg border border-divider bg-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{row.label}</p>
                <p className="text-[11px] text-foreground-dim">
                  Profile default: <span className="font-medium text-foreground-muted">{summarizeRuleRow(row, profileRules)}</span>
                </p>
              </div>
              <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-divider text-[11px] font-semibold">
                {(['inherited', 'overridden', 'cleared'] as RowMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(row, m)}
                    aria-pressed={mode === m}
                    className={`px-2.5 py-1 transition ${
                      mode === m
                        ? m === 'cleared'
                          ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                          : m === 'overridden'
                            ? 'bg-sh-lime-soft text-sh-ink'
                            : 'bg-surface-alt text-foreground'
                        : 'bg-surface text-foreground-dim hover:text-foreground'
                    }`}
                    title={
                      m === 'inherited'
                        ? 'Use the job profile default'
                        : m === 'overridden'
                          ? 'Override this rule on the card'
                          : 'Clear this rule entirely — match anyone on this axis'
                    }
                  >
                    {m === 'inherited' ? 'Inherited' : m === 'overridden' ? 'Overridden' : 'Cleared'}
                  </button>
                ))}
              </div>
            </div>
            {mode === 'overridden' && (
              <div className="mt-3 border-t border-divider pt-3">
                <RuleRowValueEditor
                  row={row}
                  value={rowValues(row, overrides)}
                  onChange={(patch) => patchRow(row, patch)}
                  countries={countries}
                />
              </div>
            )}
            {mode === 'cleared' &&
              (hasProfileDefault ? (
                <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">
                  Rule cleared — the profile default is dropped and this axis matches anyone.
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-foreground-dim">
                  Same as Inherited here — the profile default is already Any.
                </p>
              ))}
          </div>
        );
      })}
    </div>
  );
}
