'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import { STATES_BY_COUNTRY_NAME, LANGUAGE_OPTIONS } from './locationLanguageOptions';

// The internal-facing client brief form. Captures the same brief a client would
// submit, but posts to the admin endpoint, which tags the card with
// source='internal_brief' + created_by. Styled with the admin design system
// (sh-* / Section / Field / PillCheckbox) so it reads as a native admin editor.
// Two brief types:
//   'creative'   → Designer / Video Editor / Designer + Editor
//   'accountant' → Accountant
export type BriefType = 'creative' | 'accountant';

export const BRIEF_TYPES: { key: BriefType; title: string; blurb: string }[] = [
  {
    key: 'creative',
    title: 'Designer / Video Editor',
    blurb: 'Creative brief — designers, video editors, or both.',
  },
  {
    key: 'accountant',
    title: 'Accountant',
    blurb: 'Finance brief — bookkeeping, GST, audits, and more.',
  },
];

// Creative role choice → canonical service_type label the rest of the system
// keys off (see SERVICE_TYPE_TO_SLUG / SERVICE_TYPE_BADGES).
const CREATIVE_ROLES: { key: string; label: string; service_type: string }[] = [
  { key: 'designer', label: 'Designer', service_type: 'Designers' },
  { key: 'editor', label: 'Video Editor', service_type: 'Editors' },
  { key: 'both', label: 'Designer + Editor', service_type: 'Designer plus Editor' },
];

const COUNTRY_CODES = [
  { code: '+91', flag: '🇮🇳' }, { code: '+1', flag: '🇺🇸' }, { code: '+44', flag: '🇬🇧' },
  { code: '+971', flag: '🇦🇪' }, { code: '+65', flag: '🇸🇬' }, { code: '+61', flag: '🇦🇺' },
  { code: '+49', flag: '🇩🇪' }, { code: '+33', flag: '🇫🇷' },
];

const WORKING_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));

type Country = { id: string; name: string };

type FormData = {
  brand_name: string;
  business_nature: string;
  business_note: string;
  contact_name: string;
  email: string;
  country_code: string;
  phone: string;
  business_location: string;
  country_id: string;
  state_regions: string[];
  languages: string[];
  working_days: string[];
  requirement_note: string;
  hours_note: string;
};

const emptyForm: FormData = {
  brand_name: '', business_nature: '', business_note: '',
  contact_name: '', email: '', country_code: '+91', phone: '',
  business_location: '', country_id: '', state_regions: [],
  languages: [], working_days: DEFAULT_DAYS, requirement_note: '', hours_note: '',
};

export default function ClientBriefForm({
  type,
  onClose,
  onCreated,
}: {
  type: BriefType;
  onClose: () => void;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const [role, setRole] = useState<string>('designer');
  const [form, setForm] = useState<FormData>(emptyForm);
  const [error, setError] = useState('');

  const countriesQuery = useQuery({
    queryKey: ['admin-countries'],
    queryFn: () => api.get('/admin/countries').then((r) => r.data?.data || []),
  });
  const countries: Country[] = countriesQuery.data || [];

  const selectedCountryName = useMemo(
    () => countries.find((c) => c.id === form.country_id)?.name || '',
    [countries, form.country_id],
  );
  const regionOptions = useMemo(
    () => uniq([...(STATES_BY_COUNTRY_NAME[selectedCountryName] || []), ...form.state_regions]),
    [selectedCountryName, form.state_regions],
  );
  const languageOptions = useMemo(() => uniq([...LANGUAGE_OPTIONS, ...form.languages]), [form.languages]);

  const serviceType =
    type === 'accountant'
      ? 'Accountants'
      : CREATIVE_ROLES.find((r) => r.key === role)?.service_type || 'Designers';
  const typeMeta = BRIEF_TYPES.find((t) => t.key === type)!;

  function update<K extends keyof FormData>(field: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }
  function changeCountry(newId: string) {
    setForm((prev) => ({ ...prev, country_id: newId, state_regions: [] }));
  }
  function toggle(field: 'state_regions' | 'languages' | 'working_days', value: string) {
    setForm((prev) => {
      const set = new Set(prev[field]);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      return { ...prev, [field]: Array.from(set) };
    });
  }

  const create = useMutation({
    mutationFn: () =>
      api
        .post('/admin/subscription-cards/client-brief', {
          service_type: serviceType,
          brand_name: form.brand_name.trim(),
          business_nature: form.business_nature.trim(),
          business_note: form.business_note.trim(),
          contact_name: form.contact_name.trim(),
          email: form.email.trim(),
          phone: `${form.country_code} ${form.phone.trim()}`.trim(),
          business_location: form.business_location.trim() || undefined,
          country_id: form.country_id || undefined,
          state_regions: form.state_regions,
          languages: form.languages,
          working_days: form.working_days,
          requirement_note: form.requirement_note.trim() || undefined,
          hours_note: form.hours_note.trim() || undefined,
        })
        .then((r) => r.data),
    onSuccess: () => {
      showToast('Client brief created — find it in Form Requests', 'success');
      qc.invalidateQueries({ queryKey: ['admin-internal-brief-submissions'] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      onCreated();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error || err.message || 'Failed to create brief';
      setError(msg);
      showToast(msg, 'error');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.contact_name.trim() || !form.email.trim() || !form.phone.trim()) {
      setError('Contact name, email, and phone are required.');
      return;
    }
    if (!form.brand_name.trim() || !form.business_nature.trim() || !form.business_note.trim()) {
      setError('Brand, nature of business, and the requirement are required.');
      return;
    }
    if (!form.country_id) {
      setError('Please select a country.');
      return;
    }
    if (form.languages.length === 0) {
      setError('Please select at least one language.');
      return;
    }
    if (form.working_days.length === 0) {
      setError('Please select at least one working day.');
      return;
    }
    create.mutate();
  }

  return (
    <div className="flex h-full flex-col sh-surface">
      {/* Header — matches the AdminCardEditor editor view */}
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
        <div className="space-y-2">
          <button onClick={onClose} className="sh-btn-ghost sh-btn-ghost-sm">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <h1 className="sh-display text-2xl sm:text-3xl">{typeMeta.title} brief</h1>
          <p className="text-sm text-[var(--color-sh-ink-muted)]">{typeMeta.blurb}</p>
        </div>
        <span className="sh-eyebrow shrink-0">
          <span className="sh-eyebrow-dot" />
          New client brief
        </span>
      </div>

      {/* Form body */}
      <div className="flex-1 overflow-y-auto px-6 pb-10">
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl space-y-6">
          {error && (
            <div className="rounded-[10px] border border-[#E0B7A2] bg-[#FBEFE9] px-4 py-3 text-sm font-medium text-[#8B3A1A]">
              {error}
            </div>
          )}

          {type === 'creative' && (
            <Section title="Service">
              <Field label="What do you need?">
                <div className="flex flex-wrap gap-2">
                  {CREATIVE_ROLES.map((r) => (
                    <PillCheckbox
                      key={r.key}
                      active={role === r.key}
                      onClick={() => setRole(r.key)}
                      label={r.label}
                    />
                  ))}
                </div>
              </Field>
            </Section>
          )}

          <Section title="Client contact">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Contact name" required>
                <input
                  type="text"
                  value={form.contact_name}
                  onChange={(e) => update('contact_name', e.target.value)}
                  placeholder="Full name"
                  className="sh-input"
                />
              </Field>
              <Field label="Email" required>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  placeholder="email@company.com"
                  className="sh-input"
                />
              </Field>
            </div>
            <Field label="Contact number" required>
              <div className="flex gap-2">
                <select
                  value={form.country_code}
                  onChange={(e) => update('country_code', e.target.value)}
                  className="sh-input w-28 shrink-0"
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                  ))}
                </select>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  placeholder="Phone number"
                  className="sh-input flex-1"
                />
              </div>
            </Field>
          </Section>

          <Section title="Brand & requirement">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Brand / business name" required>
                <input
                  type="text"
                  value={form.brand_name}
                  onChange={(e) => update('brand_name', e.target.value)}
                  placeholder="Brand or business name"
                  className="sh-input"
                />
              </Field>
              <Field label="Nature of business" required>
                <input
                  type="text"
                  value={form.business_nature}
                  onChange={(e) => update('business_nature', e.target.value)}
                  placeholder="e.g. Healthcare, D2C skincare, SaaS"
                  className="sh-input"
                />
              </Field>
            </div>
            <Field label="What do they need?" required>
              <textarea
                rows={3}
                value={form.business_note}
                onChange={(e) => update('business_note', e.target.value)}
                placeholder="Describe the work the client needs help with"
                className="sh-input resize-none"
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Business location" optional>
                <input
                  type="text"
                  value={form.business_location}
                  onChange={(e) => update('business_location', e.target.value)}
                  placeholder="City / area"
                  className="sh-input"
                />
              </Field>
              <Field label="Hours / availability" optional>
                <input
                  type="text"
                  value={form.hours_note}
                  onChange={(e) => update('hours_note', e.target.value)}
                  placeholder="e.g. ~4 hours/day, full-time"
                  className="sh-input"
                />
              </Field>
            </div>
            <Field label="Specific requirements" optional>
              <textarea
                rows={2}
                value={form.requirement_note}
                onChange={(e) => update('requirement_note', e.target.value)}
                placeholder="Tools, style, deliverables, references…"
                className="sh-input resize-none"
              />
            </Field>
          </Section>

          <Section title="Talent preferences">
            <Field label="Country" required>
              <select
                value={form.country_id}
                onChange={(e) => changeCountry(e.target.value)}
                className="sh-input"
              >
                <option value="">Select a country</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>

            {regionOptions.length > 0 && (
              <Field label="States / regions" optional>
                <p className="mb-2 text-xs text-[var(--color-sh-ink-faint)]">Leave empty to consider the whole country.</p>
                <div className="flex flex-wrap gap-2">
                  {regionOptions.map((opt) => (
                    <PillCheckbox
                      key={opt}
                      active={form.state_regions.includes(opt)}
                      onClick={() => toggle('state_regions', opt)}
                      label={opt}
                    />
                  ))}
                </div>
              </Field>
            )}

            <Field label="Languages" required>
              <div className="flex flex-wrap gap-2">
                {languageOptions.map((opt) => (
                  <PillCheckbox
                    key={opt}
                    active={form.languages.includes(opt)}
                    onClick={() => toggle('languages', opt)}
                    label={opt}
                  />
                ))}
              </div>
            </Field>

            <Field label="Working days" required>
              <p className="mb-2 text-xs text-[var(--color-sh-ink-faint)]">Mon–Fri by default; add Sat/Sun for weekend coverage.</p>
              <div className="flex flex-wrap gap-2">
                {WORKING_DAYS.map((day) => (
                  <PillCheckbox
                    key={day}
                    active={form.working_days.includes(day)}
                    onClick={() => toggle('working_days', day)}
                    label={day}
                  />
                ))}
              </div>
            </Field>
          </Section>

          <div className="flex items-center justify-end gap-2 pb-2">
            <button type="button" onClick={onClose} className="sh-btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={create.isPending} className="sh-btn-primary sh-btn-primary-sm">
              {create.isPending ? 'Creating…' : 'Create brief'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="sh-section-heading mb-3 px-1">{title}</h2>
      <div className="sh-card space-y-4 p-5">{children}</div>
    </div>
  );
}

function Field({
  label, required, optional, children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-[var(--color-sh-ink-muted)]">
        <span>
          {label}
          {required && <span className="ml-0.5 text-[#C13515]">*</span>}
        </span>
        {optional && <span className="font-normal text-[var(--color-sh-ink-faint)]">(optional)</span>}
      </label>
      {children}
    </div>
  );
}

function PillCheckbox({
  active, onClick, label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border-[1.5px] px-3.5 py-1.5 text-xs font-semibold transition"
      style={
        active
          ? { background: 'var(--color-sh-lime-soft)', color: 'var(--color-sh-ink)', borderColor: 'var(--color-sh-ink)' }
          : { background: '#fff', color: 'var(--color-sh-ink)', borderColor: 'var(--color-sh-warm-border)' }
      }
    >
      {active && <span className="mr-1">✓</span>}{label}
    </button>
  );
}
