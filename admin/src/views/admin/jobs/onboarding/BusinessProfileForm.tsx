'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BusinessProfile, BusinessProfilePhoto } from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

// Business profile — the required parent of the onboarding hierarchy. Every
// field is candidate-facing: the goal is that a candidate understands the
// business without asking questions (plan §B).

const SOCIAL_KEYS = ['linkedin', 'instagram', 'facebook', 'x', 'youtube'] as const;

type FormState = {
  name: string;
  about: string;
  industry: string;
  company_size: string;
  website: string;
  socials: Record<string, string>;
  logo_url: string;
  photos: BusinessProfilePhoto[];
  culture: string;
  perks: string[];
  founded_year: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
};

function toForm(p: BusinessProfile | null): FormState {
  return {
    name: p?.name ?? '',
    about: p?.about ?? '',
    industry: p?.industry ?? '',
    company_size: p?.company_size ?? '',
    website: p?.website ?? '',
    socials: p?.socials ?? {},
    logo_url: p?.logo_url ?? '',
    photos: p?.photos ?? [],
    culture: p?.culture ?? '',
    perks: p?.perks ?? [],
    founded_year: p?.founded_year ? String(p.founded_year) : '',
    contact_name: p?.contact_name ?? '',
    contact_email: p?.contact_email ?? '',
    contact_phone: p?.contact_phone ?? '',
  };
}

export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-foreground">
        {label}
        {required && <span className="text-[#C13515]"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-foreground-dim">{hint}</p>}
    </div>
  );
}

export const inputCls =
  'w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none';

// Simple editable string list (perks, responsibilities, …) — one input per
// row + add/remove.
export function StringListEditor({
  values,
  onChange,
  placeholder,
  addLabel,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  addLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="text"
            value={v}
            onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder={placeholder}
            className={inputCls}
          />
          <button
            type="button"
            aria-label="Remove"
            onClick={() => onChange(values.filter((_, j) => j !== i))}
            className="shrink-0 rounded-md p-1.5 text-foreground-dim transition hover:bg-canvas hover:text-foreground"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, ''])}
        className="rounded-md border border-dashed border-divider px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:border-ink hover:text-foreground"
      >
        + {addLabel}
      </button>
    </div>
  );
}

export function PhotoListEditor({
  photos,
  onChange,
}: {
  photos: BusinessProfilePhoto[];
  onChange: (next: BusinessProfilePhoto[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      {photos.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="text"
            value={p.url}
            onChange={(e) => onChange(photos.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
            placeholder="Photo URL"
            className={inputCls}
          />
          <input
            type="text"
            value={p.caption ?? ''}
            onChange={(e) => onChange(photos.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))}
            placeholder="Caption (optional)"
            className={inputCls}
          />
          <button
            type="button"
            aria-label="Remove photo"
            onClick={() => onChange(photos.filter((_, j) => j !== i))}
            className="shrink-0 rounded-md p-1.5 text-foreground-dim transition hover:bg-canvas hover:text-foreground"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...photos, { url: '', caption: '' }])}
        className="rounded-md border border-dashed border-divider px-3 py-1.5 text-xs font-medium text-foreground-muted transition hover:border-ink hover:text-foreground"
      >
        + Add photo
      </button>
    </div>
  );
}

export default function BusinessProfileForm({
  profile,
  leadSubmissionId,
  clientId,
  onSaved,
  onCancel,
}: {
  /** Existing profile to edit, or null to create a new one. */
  profile: BusinessProfile | null;
  /** Lead/client linkage for NEW profiles (chk_bp_owner: at least one required). */
  leadSubmissionId?: string | null;
  clientId?: string | null;
  onSaved: (profile: BusinessProfile) => void;
  onCancel?: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(() => toForm(profile));
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const yearNum = form.founded_year.trim() ? Number(form.founded_year) : null;
      const body = {
        name: form.name.trim(),
        about: form.about.trim() || null,
        industry: form.industry.trim() || null,
        company_size: form.company_size.trim() || null,
        website: form.website.trim() || null,
        socials: Object.fromEntries(Object.entries(form.socials).filter(([, v]) => v.trim())),
        logo_url: form.logo_url.trim() || null,
        photos: form.photos.filter((p) => p.url.trim()),
        culture: form.culture.trim() || null,
        perks: form.perks.map((p) => p.trim()).filter(Boolean),
        founded_year: Number.isFinite(yearNum) && yearNum ? Math.round(yearNum) : null,
        contact_name: form.contact_name.trim() || null,
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
      };
      const res = profile
        ? await api.patch(`/admin/jobs/business-profiles/${profile.id}`, body)
        : await api.post('/admin/jobs/business-profiles', {
            ...body,
            lead_submission_id: leadSubmissionId ?? null,
            client_id: clientId ?? null,
          });
      return res.data?.data as BusinessProfile;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['admin-job-business-profiles'] });
      qc.invalidateQueries({ queryKey: ['admin-job-business-profile', saved.id] });
      showToast(profile ? 'Business profile updated.' : 'Business profile created.', 'success');
      onSaved(saved);
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || err.message || 'Failed to save business profile', 'error');
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!form.name.trim()) {
          showToast('Business name is required.', 'error');
          return;
        }
        save.mutate();
      }}
      className="space-y-4"
    >
      <Field label="Business name" required>
        <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Legal / trading name" className={inputCls} />
      </Field>
      <Field label="About the business" hint="What the business does, who it serves — written for candidates.">
        <textarea rows={4} value={form.about} onChange={(e) => set('about', e.target.value)} className={`${inputCls} resize-none`} placeholder="What you do, who you serve, what makes you different." />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Industry">
          <input type="text" value={form.industry} onChange={(e) => set('industry', e.target.value)} placeholder="e.g. Retail, SaaS, Education" className={inputCls} />
        </Field>
        <Field label="Company size">
          <select value={form.company_size} onChange={(e) => set('company_size', e.target.value)} className={inputCls}>
            <option value="">— Not set —</option>
            {['1-10', '11-50', '51-200', '201-500', '500+'].map((s) => (
              <option key={s} value={s}>{s} people</option>
            ))}
          </select>
        </Field>
        <Field label="Website">
          <input type="text" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" className={inputCls} />
        </Field>
        <Field label="Founded year">
          <input type="number" min={1800} max={2100} value={form.founded_year} onChange={(e) => set('founded_year', e.target.value)} placeholder="e.g. 2015" className={inputCls} />
        </Field>
      </div>
      <Field label="Logo URL">
        <input type="text" value={form.logo_url} onChange={(e) => set('logo_url', e.target.value)} placeholder="https://…" className={inputCls} />
      </Field>
      <Field label="Social links">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SOCIAL_KEYS.map((k) => (
            <input
              key={k}
              type="text"
              value={form.socials[k] ?? ''}
              onChange={(e) => set('socials', { ...form.socials, [k]: e.target.value })}
              placeholder={`${k.charAt(0).toUpperCase() + k.slice(1)} URL`}
              className={inputCls}
            />
          ))}
        </div>
      </Field>
      <Field label="Photos" hint="Office / team photos shown to candidates.">
        <PhotoListEditor photos={form.photos} onChange={(p) => set('photos', p)} />
      </Field>
      <Field label="Culture" hint="Work culture, values, what it's like to work here.">
        <textarea rows={3} value={form.culture} onChange={(e) => set('culture', e.target.value)} className={`${inputCls} resize-none`} />
      </Field>
      <Field label="Perks">
        <StringListEditor values={form.perks} onChange={(p) => set('perks', p)} placeholder="e.g. Health insurance" addLabel="Add perk" />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Contact name">
          <input type="text" value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Contact email">
          <input type="email" value={form.contact_email} onChange={(e) => set('contact_email', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Contact phone">
          <input type="text" value={form.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} className={inputCls} />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-divider pt-4">
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-md border border-divider px-4 py-2 text-sm font-medium text-foreground-muted transition hover:text-foreground">
            Cancel
          </button>
        )}
        <button type="submit" disabled={save.isPending} className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
          {save.isPending ? 'Saving…' : profile ? 'Save changes' : 'Create business profile'}
        </button>
      </div>
    </form>
  );
}
