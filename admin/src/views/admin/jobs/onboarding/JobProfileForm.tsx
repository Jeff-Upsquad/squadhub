'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BrandProfile,
  BusinessLocation,
  JobEmploymentType,
  JobMatchRules,
  JobProfile,
  JobSalaryPeriod,
  JobWorkMode,
} from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import PreferenceRulesEditor, { type Country } from '../PreferenceRulesEditor';
import { Field, inputCls, StringListEditor } from './BusinessProfileForm';

// Job profile — everything a candidate needs to understand the role without
// asking questions (plan §B), plus the default preference rules that cards
// override per-card and the SquadHire categories that gate publish.

const EMPLOYMENT_TYPES: { value: JobEmploymentType; label: string }[] = [
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
  { value: 'contract', label: 'Contract' },
  { value: 'internship', label: 'Internship' },
];

const WORK_MODES: { value: JobWorkMode; label: string }[] = [
  { value: 'onsite', label: 'On-site' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
];

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function JobProfileForm({
  businessProfileId,
  brands,
  locations,
  profile,
  onSaved,
  onCancel,
}: {
  businessProfileId: string;
  brands: BrandProfile[];
  locations: BusinessLocation[];
  /** Existing job profile to edit, or null to create. */
  profile: JobProfile | null;
  onSaved: (profile: JobProfile) => void;
  onCancel?: () => void;
}) {
  const qc = useQueryClient();

  const [title, setTitle] = useState(profile?.title ?? '');
  const [brandProfileId, setBrandProfileId] = useState<string>(profile?.brand_profile_id ?? '');
  const [description, setDescription] = useState(profile?.description ?? '');
  const [responsibilities, setResponsibilities] = useState<string[]>(profile?.responsibilities ?? []);
  const [requirements, setRequirements] = useState<string[]>(profile?.requirements ?? []);
  const [skills, setSkills] = useState<string[]>(profile?.skills ?? []);
  const [minExp, setMinExp] = useState<string>(profile?.min_experience_years != null ? String(profile.min_experience_years) : '');
  const [maxExp, setMaxExp] = useState<string>(profile?.max_experience_years != null ? String(profile.max_experience_years) : '');
  const [education, setEducation] = useState(profile?.education ?? '');
  const [employmentType, setEmploymentType] = useState<JobEmploymentType>(profile?.employment_type ?? 'full_time');
  const [workMode, setWorkMode] = useState<JobWorkMode>(profile?.work_mode ?? 'onsite');
  const [locationId, setLocationId] = useState<string>(profile?.location_id ?? '');
  const [workingDays, setWorkingDays] = useState<string[]>(profile?.working_days?.length ? profile.working_days : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  const [hoursStart, setHoursStart] = useState(profile?.working_hours?.start ?? '');
  const [hoursEnd, setHoursEnd] = useState(profile?.working_hours?.end ?? '');
  const [timezone, setTimezone] = useState(profile?.working_hours?.timezone ?? 'Asia/Kolkata');
  const [salaryMin, setSalaryMin] = useState<string>(profile?.salary_min != null ? String(profile.salary_min) : '');
  const [salaryMax, setSalaryMax] = useState<string>(profile?.salary_max != null ? String(profile.salary_max) : '');
  const [salaryCurrency, setSalaryCurrency] = useState(profile?.salary_currency ?? 'INR');
  const [salaryPeriod, setSalaryPeriod] = useState<JobSalaryPeriod>(profile?.salary_period ?? 'monthly');
  const [benefits, setBenefits] = useState<string[]>(profile?.benefits ?? []);
  const [growthPath, setGrowthPath] = useState(profile?.growth_path ?? '');
  const [preferenceRules, setPreferenceRules] = useState<JobMatchRules>(profile?.preference_rules ?? {});
  const [categoryIds, setCategoryIds] = useState<string[]>(profile?.squadhire_category_ids ?? []);

  const countriesQuery = useQuery({
    queryKey: ['admin-countries'],
    queryFn: () => api.get('/admin/countries').then((r) => r.data?.data || []),
  });
  const countries: Country[] = countriesQuery.data || [];

  // Same query key AdminCardEditor uses so the cache is shared. Coerce the
  // proxied shape defensively — it's external-service data.
  const squadhireCategoriesQuery = useQuery({
    queryKey: ['squadhire-categories'],
    queryFn: () => api.get('/admin/integrations/squadhire/categories').then((r) => r.data?.data || []),
    staleTime: 10 * 60 * 1000,
  });
  const squadhireCategories: Array<{ id: string; name: string; slug: string }> = useMemo(
    () =>
      (Array.isArray(squadhireCategoriesQuery.data) ? squadhireCategoriesQuery.data : []).filter(
        (c: any): c is { id: string; name: string; slug: string } => !!c && typeof c.id === 'string',
      ),
    [squadhireCategoriesQuery.data],
  );

  const parseInt0 = (raw: string): number | null => {
    if (!raw.trim()) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        business_profile_id: businessProfileId,
        brand_profile_id: brandProfileId || null,
        title: title.trim(),
        description: description.trim() || null,
        responsibilities: responsibilities.map((s) => s.trim()).filter(Boolean),
        requirements: requirements.map((s) => s.trim()).filter(Boolean),
        skills: skills.map((s) => s.trim()).filter(Boolean),
        min_experience_years: parseInt0(minExp),
        max_experience_years: parseInt0(maxExp),
        education: education.trim() || null,
        employment_type: employmentType,
        work_mode: workMode,
        location_id: locationId || null,
        working_days: workingDays,
        working_hours:
          hoursStart || hoursEnd
            ? { start: hoursStart || undefined, end: hoursEnd || undefined, timezone: timezone || undefined }
            : null,
        salary_min: parseInt0(salaryMin),
        salary_max: parseInt0(salaryMax),
        salary_currency: salaryCurrency || 'INR',
        salary_period: salaryPeriod,
        benefits: benefits.map((s) => s.trim()).filter(Boolean),
        growth_path: growthPath.trim() || null,
        preference_rules: preferenceRules,
        squadhire_category_ids: categoryIds,
      };
      const res = profile
        ? await api.patch(`/admin/jobs/job-profiles/${profile.id}`, body)
        : await api.post('/admin/jobs/job-profiles', body);
      return res.data?.data as JobProfile;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['admin-job-profiles'] });
      qc.invalidateQueries({ queryKey: ['admin-job-business-profile', businessProfileId] });
      qc.invalidateQueries({ queryKey: ['admin-job-cards'] });
      showToast(profile ? 'Job profile updated.' : 'Job profile created.', 'success');
      onSaved(saved);
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to save job profile', 'error');
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) {
          showToast('Job title is required.', 'error');
          return;
        }
        save.mutate();
      }}
      className="space-y-5"
    >
      <section className="space-y-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">The role</h4>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Job title" required>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Senior Graphic Designer" className={inputCls} />
          </Field>
          <Field label="Brand" hint="Leave unset to hang the job directly off the business profile.">
            <select value={brandProfileId} onChange={(e) => setBrandProfileId(e.target.value)} className={inputCls}>
              <option value="">— Business itself (no brand) —</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Description" hint="Candidate-facing — explain the role so it needs no follow-up questions.">
          <textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputCls} resize-none`} />
        </Field>
        <Field label="Responsibilities">
          <StringListEditor values={responsibilities} onChange={setResponsibilities} placeholder="e.g. Own the monthly social media calendar" addLabel="Add responsibility" />
        </Field>
        <Field label="Requirements">
          <StringListEditor values={requirements} onChange={setRequirements} placeholder="e.g. 3+ years in a design role" addLabel="Add requirement" />
        </Field>
        <Field label="Skills">
          <StringListEditor values={skills} onChange={setSkills} placeholder="e.g. Figma" addLabel="Add skill" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Min experience (yrs)">
            <input type="number" min={0} value={minExp} onChange={(e) => setMinExp(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Max experience (yrs)">
            <input type="number" min={0} value={maxExp} onChange={(e) => setMaxExp(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Education">
            <input type="text" value={education} onChange={(e) => setEducation(e.target.value)} placeholder="e.g. Any degree" className={inputCls} />
          </Field>
        </div>
      </section>

      <section className="space-y-4 border-t border-divider pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Work setup</h4>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Employment type">
            <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as JobEmploymentType)} className={inputCls}>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Work mode">
            <select value={workMode} onChange={(e) => setWorkMode(e.target.value as JobWorkMode)} className={inputCls}>
              {WORK_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Location" hint="Saved on the business profile.">
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
              <option value="">— Not set —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Working days">
          <div className="flex flex-wrap gap-1.5">
            {WEEK_DAYS.map((d) => {
              const on = workingDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setWorkingDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
                  }
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    on
                      ? 'border-ink bg-sh-lime-soft text-sh-ink shadow-[inset_0_0_0_1px_var(--sh-ink)]'
                      : 'border-divider bg-surface text-foreground-muted hover:border-ink hover:text-foreground'
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Hours start">
            <input type="time" value={hoursStart} onChange={(e) => setHoursStart(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Hours end">
            <input type="time" value={hoursEnd} onChange={(e) => setHoursEnd(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Timezone">
            <input type="text" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Kolkata" className={inputCls} />
          </Field>
        </div>
      </section>

      <section className="space-y-4 border-t border-divider pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Compensation & growth</h4>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Field label="Salary min">
            <input type="number" min={0} value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Salary max">
            <input type="number" min={0} value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Currency">
            <input type="text" value={salaryCurrency} onChange={(e) => setSalaryCurrency(e.target.value)} placeholder="INR" className={inputCls} />
          </Field>
          <Field label="Period">
            <select value={salaryPeriod} onChange={(e) => setSalaryPeriod(e.target.value as JobSalaryPeriod)} className={inputCls}>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </select>
          </Field>
        </div>
        <Field label="Benefits">
          <StringListEditor values={benefits} onChange={setBenefits} placeholder="e.g. Health insurance" addLabel="Add benefit" />
        </Field>
        <Field label="Growth path" hint="How the role grows — candidates ask this first.">
          <textarea rows={3} value={growthPath} onChange={(e) => setGrowthPath(e.target.value)} className={`${inputCls} resize-none`} />
        </Field>
      </section>

      <section className="space-y-4 border-t border-divider pt-4">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">SquadHire categories</h4>
          <p className="mt-1 text-[11px] text-foreground-dim">
            Required to broadcast — talents subscribed to these categories receive the card.
          </p>
        </div>
        {squadhireCategories.length === 0 ? (
          <p className="text-xs text-foreground-dim">No categories loaded.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {squadhireCategories.map((c) => {
              const on = categoryIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setCategoryIds((prev) => (prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]))
                  }
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    on
                      ? 'border-ink bg-sh-lime-soft text-sh-ink shadow-[inset_0_0_0_1px_var(--sh-ink)]'
                      : 'border-divider bg-surface text-foreground-muted hover:border-ink hover:text-foreground'
                  }`}
                >
                  {on ? '✓ ' : ''}
                  {c.name}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4 border-t border-divider pt-4">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground-dim">Candidate preference rules</h4>
          <p className="mt-1 text-[11px] text-foreground-dim">
            Defaults for every card built on this profile — cards can override each rule individually.
          </p>
        </div>
        <PreferenceRulesEditor value={preferenceRules} onChange={setPreferenceRules} countries={countries} />
      </section>

      <div className="flex items-center justify-end gap-2 border-t border-divider pt-4">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-md border border-divider px-4 py-2 text-sm font-medium text-foreground-muted transition hover:text-foreground">
            Cancel
          </button>
        )}
        <button type="submit" disabled={save.isPending} className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
          {save.isPending ? 'Saving…' : profile ? 'Save changes' : 'Create job profile'}
        </button>
      </div>
    </form>
  );
}
