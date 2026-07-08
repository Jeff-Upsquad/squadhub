'use client';

import { useMemo, useState } from 'react';
import type { JobMatchRules } from '@squadhub/shared';
import { STATES_BY_COUNTRY_NAME, LANGUAGE_OPTIONS } from '../locationLanguageOptions';

// Candidate preference rules editor — the JobMatchRules vocabulary (cross-repo
// contract §3, SquadHire matcher keys are BINDING): target_tiers,
// min/max_experience_years, target_languages, target_country_names,
// target_regions, min/max_age, target_genders, target_districts.
// category_ids is NOT edited here — it's sourced from the job profile's
// squadhire_category_ids by the payload builder.
//
// The same row/field editors back both surfaces:
//  - PreferenceRulesEditor (job profile defaults — plain values)
//  - RuleOverridesEditor (per-card Inherited/Overridden/Cleared toggle rows)

export type Country = { id: string; name: string };

// Rows group the paired range keys so "Experience" and "Age range" read as one
// rule each (matching how the card-level override toggles work per rule).
export type RuleRowId =
  | 'tiers'
  | 'experience'
  | 'languages'
  | 'countries'
  | 'regions'
  | 'districts'
  | 'age'
  | 'genders';

export type RuleRow = {
  id: RuleRowId;
  label: string;
  hint: string;
  keys: (keyof JobMatchRules)[];
};

export const RULE_ROWS: RuleRow[] = [
  { id: 'tiers', label: 'Experience tiers', hint: 'SquadHire talent tiers to match. Empty = any tier.', keys: ['target_tiers'] },
  { id: 'experience', label: 'Experience (years)', hint: 'Minimum and/or maximum years of experience.', keys: ['min_experience_years', 'max_experience_years'] },
  { id: 'age', label: 'Age range', hint: 'Candidate age bounds. A bounded rule fails closed when the talent has no age on file.', keys: ['min_age', 'max_age'] },
  { id: 'genders', label: 'Gender', hint: 'Match only these genders. Empty = any.', keys: ['target_genders'] },
  { id: 'languages', label: 'Languages', hint: 'Languages the candidate should speak.', keys: ['target_languages'] },
  { id: 'countries', label: 'Countries', hint: 'Country names the candidate should be based in.', keys: ['target_country_names'] },
  { id: 'regions', label: 'States / regions', hint: 'Region names within the selected countries. Blank = anywhere.', keys: ['target_regions'] },
  { id: 'districts', label: 'Districts', hint: 'Preferred districts (matched against the talent’s preferred/current district).', keys: ['target_districts'] },
];

const GENDER_OPTIONS: { value: string; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];

const TIER_OPTIONS = ['Junior', 'Pro', 'Top Talents'];

const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));

// ------------------------------------------------------------
// Small field primitives
// ------------------------------------------------------------

function ChipToggleList({
  options,
  selected,
  onToggle,
  labels,
}: {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  labels?: Record<string, string>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const on = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            aria-pressed={on}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              on
                ? 'border-ink bg-[#F2FCBC] text-[#0a0a0a] shadow-[inset_0_0_0_1px_#0a0a0a]'
                : 'border-divider bg-surface text-foreground-muted hover:border-ink hover:text-foreground'
            }`}
          >
            {on ? '✓ ' : ''}
            {labels?.[opt] ?? opt}
          </button>
        );
      })}
    </div>
  );
}

// Chip list with a free-text add box — for districts (and any list where the
// canonical options don't cover everything).
function FreeChipList({
  selected,
  onChange,
  suggestions = [],
  placeholder,
}: {
  selected: string[];
  onChange: (values: string[]) => void;
  suggestions?: string[];
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  const add = (value: string) => {
    const v = value.trim();
    if (!v) return;
    onChange(uniq([...selected, v]));
    setDraft('');
  };
  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full border border-ink bg-[#F2FCBC] px-2.5 py-0.5 text-xs font-medium text-[#0a0a0a]"
            >
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => onChange(selected.filter((s) => s !== v))}
                className="text-[#0a0a0a]/60 transition hover:text-[#0a0a0a]"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            }
          }}
          placeholder={placeholder}
          className="w-full rounded-md border border-divider bg-surface px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => add(draft)}
          disabled={!draft.trim()}
          className="shrink-0 rounded-md border border-divider px-2.5 py-1.5 text-xs font-semibold text-foreground-muted transition hover:border-ink hover:text-foreground disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions
            .filter((s) => !selected.includes(s))
            .slice(0, 18)
            .map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => add(s)}
                className="rounded-full border border-dashed border-divider px-2 py-0.5 text-[11px] text-foreground-dim transition hover:border-ink hover:text-foreground"
              >
                + {s}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function RangeInputs({
  minValue,
  maxValue,
  onMin,
  onMax,
  minPlaceholder,
  maxPlaceholder,
}: {
  minValue: number | undefined;
  maxValue: number | undefined;
  onMin: (v: number | undefined) => void;
  onMax: (v: number | undefined) => void;
  minPlaceholder: string;
  maxPlaceholder: string;
}) {
  const parse = (raw: string): number | undefined => {
    if (!raw.trim()) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
  };
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        value={minValue ?? ''}
        onChange={(e) => onMin(parse(e.target.value))}
        placeholder={minPlaceholder}
        className="w-24 rounded-md border border-divider bg-surface px-2.5 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
      />
      <span className="text-xs text-foreground-dim">to</span>
      <input
        type="number"
        min={0}
        value={maxValue ?? ''}
        onChange={(e) => onMax(parse(e.target.value))}
        placeholder={maxPlaceholder}
        className="w-24 rounded-md border border-divider bg-surface px-2.5 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
      />
    </div>
  );
}

// ------------------------------------------------------------
// Per-row value editor — shared by the profile editor and the card overrides.
// `value` is a partial JobMatchRules holding just this row's keys.
// ------------------------------------------------------------

export function RuleRowValueEditor({
  row,
  value,
  onChange,
  countries,
}: {
  row: RuleRow;
  value: JobMatchRules;
  onChange: (patch: JobMatchRules) => void;
  countries: Country[];
}) {
  const toggleIn = (key: keyof JobMatchRules, v: string) => {
    const cur = (value[key] as string[] | undefined) ?? [];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    onChange({ [key]: next } as JobMatchRules);
  };

  switch (row.id) {
    case 'tiers':
      return (
        <ChipToggleList
          options={TIER_OPTIONS}
          selected={value.target_tiers ?? []}
          onToggle={(v) => toggleIn('target_tiers', v)}
        />
      );
    case 'experience':
      return (
        <RangeInputs
          minValue={value.min_experience_years}
          maxValue={value.max_experience_years}
          onMin={(v) => onChange({ min_experience_years: v })}
          onMax={(v) => onChange({ max_experience_years: v })}
          minPlaceholder="Min yrs"
          maxPlaceholder="Max yrs"
        />
      );
    case 'age':
      return (
        <RangeInputs
          minValue={value.min_age}
          maxValue={value.max_age}
          onMin={(v) => onChange({ min_age: v })}
          onMax={(v) => onChange({ max_age: v })}
          minPlaceholder="Min age"
          maxPlaceholder="Max age"
        />
      );
    case 'genders':
      return (
        <ChipToggleList
          options={GENDER_OPTIONS.map((g) => g.value)}
          labels={Object.fromEntries(GENDER_OPTIONS.map((g) => [g.value, g.label]))}
          selected={value.target_genders ?? []}
          onToggle={(v) => toggleIn('target_genders', v)}
        />
      );
    case 'languages':
      return (
        <FreeChipList
          selected={value.target_languages ?? []}
          onChange={(vals) => onChange({ target_languages: vals })}
          suggestions={LANGUAGE_OPTIONS}
          placeholder="Add a language…"
        />
      );
    case 'countries':
      return (
        <FreeChipList
          selected={value.target_country_names ?? []}
          onChange={(vals) => onChange({ target_country_names: vals })}
          suggestions={countries.map((c) => c.name)}
          placeholder="Add a country…"
        />
      );
    case 'regions': {
      const regionSuggestions = uniq(
        (value.target_country_names ?? []).flatMap((name) => STATES_BY_COUNTRY_NAME[name] || []),
      );
      return (
        <FreeChipList
          selected={value.target_regions ?? []}
          onChange={(vals) => onChange({ target_regions: vals })}
          suggestions={regionSuggestions}
          placeholder="Add a state / region…"
        />
      );
    }
    case 'districts':
      return (
        <FreeChipList
          selected={value.target_districts ?? []}
          onChange={(vals) => onChange({ target_districts: vals })}
          placeholder="Add a district…"
        />
      );
    default:
      return null;
  }
}

/** Human summary of a row's current values — used by the override rows to show
 *  what's being inherited. */
export function summarizeRuleRow(row: RuleRow, rules: JobMatchRules): string {
  switch (row.id) {
    case 'tiers':
      return (rules.target_tiers ?? []).join(', ') || 'Any tier';
    case 'experience': {
      const min = rules.min_experience_years;
      const max = rules.max_experience_years;
      if (min == null && max == null) return 'Any experience';
      if (min != null && max != null) return `${min}–${max} yrs`;
      return min != null ? `${min}+ yrs` : `Up to ${max} yrs`;
    }
    case 'age': {
      const min = rules.min_age;
      const max = rules.max_age;
      if (min == null && max == null) return 'Any age';
      if (min != null && max != null) return `${min}–${max}`;
      return min != null ? `${min}+` : `Up to ${max}`;
    }
    case 'genders':
      return (rules.target_genders ?? []).map((g) => g.charAt(0).toUpperCase() + g.slice(1)).join(', ') || 'Any gender';
    case 'languages':
      return (rules.target_languages ?? []).join(', ') || 'Any language';
    case 'countries':
      return (rules.target_country_names ?? []).join(', ') || 'Anywhere';
    case 'regions':
      return (rules.target_regions ?? []).join(', ') || 'Anywhere';
    case 'districts':
      return (rules.target_districts ?? []).join(', ') || 'Any district';
    default:
      return '';
  }
}

// ------------------------------------------------------------
// The full profile-defaults editor (plain values, no override semantics).
// ------------------------------------------------------------

export default function PreferenceRulesEditor({
  value,
  onChange,
  countries,
}: {
  value: JobMatchRules;
  onChange: (next: JobMatchRules) => void;
  countries: Country[];
}) {
  // Merge a row-level patch into the whole rules object, dropping empty
  // arrays / undefined so the stored JSONB stays sparse.
  const applyPatch = (patch: JobMatchRules) => {
    const next: JobMatchRules = { ...value, ...patch };
    (Object.keys(next) as (keyof JobMatchRules)[]).forEach((k) => {
      const v = next[k];
      if (v === undefined || (Array.isArray(v) && v.length === 0)) delete next[k];
    });
    onChange(next);
  };

  const rows = useMemo(() => RULE_ROWS, []);

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.id}>
          <p className="text-sm font-medium text-foreground">{row.label}</p>
          <p className="mb-2 text-xs text-foreground-muted">{row.hint}</p>
          <RuleRowValueEditor row={row} value={value} onChange={applyPatch} countries={countries} />
        </div>
      ))}
    </div>
  );
}
