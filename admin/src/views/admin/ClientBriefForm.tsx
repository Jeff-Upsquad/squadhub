'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import { STATES_BY_COUNTRY_NAME, LANGUAGE_OPTIONS } from './locationLanguageOptions';

// The internal-facing twin of the public /connect brief form — same two-step
// layout, copy, and cream styling so a salesperson fills out exactly what the
// client would. Posts to the admin endpoint, which tags the card with
// source='internal_brief' + created_by. Two brief types from the slider:
//   'creative'   → Designer / Editor / Designer + Editor   (role step → details)
//   'accountant' → Accountant                              (straight to details)
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

// Mirrors /connect's ROLE_OPTIONS. Single-select here (the admin creates one
// card), so each maps straight to a canonical service_type label.
const ROLE_OPTIONS: {
  slug: string;
  title: string;
  service_type: string;
  description: string;
}[] = [
  {
    slug: 'designer',
    title: 'Designer',
    service_type: 'Designers',
    description: 'Static visuals — graphics, logos, branding, presentations, UI/UX, print collateral.',
  },
  {
    slug: 'editor',
    title: 'Editor',
    service_type: 'Editors',
    description: 'Motion & video — short-form reels, long-form edits, ads, corporate videos, animations.',
  },
  {
    slug: 'designer_plus_editor',
    title: 'Designer + Editor',
    service_type: 'Designer plus Editor',
    description: 'One person who does both — design work and video editing — instead of hiring two separate specialists.',
  },
];

const COUNTRY_CODES = [
  { code: '+91', flag: '🇮🇳' }, { code: '+1', flag: '🇺🇸' }, { code: '+44', flag: '🇬🇧' },
  { code: '+971', flag: '🇦🇪' }, { code: '+65', flag: '🇸🇬' }, { code: '+61', flag: '🇦🇺' },
  { code: '+49', flag: '🇩🇪' }, { code: '+33', flag: '🇫🇷' }, { code: '+81', flag: '🇯🇵' }, { code: '+86', flag: '🇨🇳' },
];

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

const initialForm: FormData = {
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
  // Creative starts on the role step; accountant skips straight to details.
  const [step, setStep] = useState<1 | 2>(type === 'accountant' ? 2 : 1);
  const [role, setRole] = useState<string>('designer');
  const [form, setForm] = useState<FormData>(initialForm);
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
  const stateOptions = useMemo(
    () => uniq([...(STATES_BY_COUNTRY_NAME[selectedCountryName] || []), ...form.state_regions]),
    [selectedCountryName, form.state_regions],
  );

  const typeMeta = BRIEF_TYPES.find((t) => t.key === type)!;
  const selectedRole = ROLE_OPTIONS.find((r) => r.slug === role)!;
  const serviceType = type === 'accountant' ? 'Accountants' : selectedRole.service_type;
  const requirementLabel = type === 'accountant' ? 'Accountant' : selectedRole.title;

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
      setError('Brand name, nature of business, and a short note are required.');
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
    <div className="connect-bg fixed inset-0 z-40 overflow-y-auto px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={onClose}
          className="-ml-1 mb-3 flex items-center gap-1 text-sm text-foreground-muted transition hover:text-foreground"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Published Cards
        </button>

        <header className="mb-6 text-center sm:mb-8">
          <h1 className="text-[24px] font-semibold tracking-tight text-foreground sm:text-[28px]">
            New client brief
          </h1>
          <p className="mt-1.5 text-sm text-foreground-muted sm:text-base">
            {typeMeta.blurb} You&apos;re capturing this on the client&apos;s behalf — it lands in Form Requests.
          </p>
        </header>

        {step === 1 && type === 'creative' && (
          <section className="flex flex-col items-center">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-foreground-muted">
              What do you need?
            </h2>
            <p className="mb-6 max-w-md text-center text-sm text-foreground-muted">
              Designers create static visuals, Editors craft motion and video, or pick a hybrid who does both.
            </p>

            <div className="mb-2 inline-flex flex-wrap justify-center gap-2">
              {ROLE_OPTIONS.map((opt) => {
                const on = role === opt.slug;
                return (
                  <button
                    key={opt.slug}
                    type="button"
                    onClick={() => setRole(opt.slug)}
                    aria-pressed={on}
                    className={`connect-pill ${on ? 'connect-pill-on' : ''}`}
                  >
                    {on && (
                      <svg className="-mt-0.5 mr-1.5 inline-block h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {opt.title}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 w-full max-w-md">
              <div className="connect-role-card">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FCF487] ring-1 ring-ink" />
                  <span className="text-sm font-bold text-foreground">{selectedRole.title}</span>
                </div>
                <p className="text-xs leading-relaxed text-foreground-muted">{selectedRole.description}</p>
              </div>
            </div>

            <div className="mt-6 w-full max-w-md">
              <button type="button" onClick={() => setStep(2)} className="connect-submit">
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <form onSubmit={handleSubmit} className="space-y-5 pb-8">
            {type === 'creative' && (
              <button
                type="button"
                onClick={() => setStep(1)}
                className="-ml-1 mb-2 flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Change role
              </button>
            )}

            {error && (
              <div className="rounded-lg border border-[#E0B7A2] bg-[#FBEFE9] px-4 py-3 text-sm text-[#8B3A1A]">
                {error}
              </div>
            )}

            <Section
              eyebrow="Customer"
              title="Client contact"
              hint="How we'll reach the client to confirm and schedule the kickoff call."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Email" required>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                    placeholder="client@company.com"
                    className="connect-input"
                  />
                </Field>
                <Field label="Phone" required hint="Ideally a WhatsApp number">
                  <div className="connect-phone">
                    <select
                      value={form.country_code}
                      onChange={(e) => update('country_code', e.target.value)}
                      className="connect-phone-cc"
                      aria-label="Country code"
                    >
                      {COUNTRY_CODES.map((c) => (
                        <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                      ))}
                    </select>
                    <span className="connect-phone-divider" />
                    <input
                      type="tel"
                      inputMode="tel"
                      value={form.phone}
                      onChange={(e) => update('phone', e.target.value)}
                      placeholder="Phone number"
                      className="connect-phone-input"
                    />
                  </div>
                </Field>
                <Field label="Contact Person Name" required>
                  <input
                    type="text"
                    value={form.contact_name}
                    onChange={(e) => update('contact_name', e.target.value)}
                    placeholder="Full name"
                    className="connect-input"
                  />
                </Field>
              </div>
            </Section>

            <Section
              eyebrow="Client brief"
              title="About the brand"
              hint="Helps talent understand the client's space and pitch ideas that fit."
            >
              <Field label="Brand Name" required>
                <input
                  type="text"
                  value={form.brand_name}
                  onChange={(e) => update('brand_name', e.target.value)}
                  placeholder="The client's brand name"
                  className="connect-input"
                />
              </Field>
              <Field label="Nature of Business" required>
                <input
                  type="text"
                  value={form.business_nature}
                  onChange={(e) => update('business_nature', e.target.value)}
                  placeholder="e.g. Retail, SaaS, Education"
                  className="connect-input"
                />
              </Field>
              <Field label="Short Note About the Business" required>
                <textarea
                  rows={3}
                  value={form.business_note}
                  onChange={(e) => update('business_note', e.target.value)}
                  placeholder="What they do, who they serve, what makes them different."
                  className="connect-input resize-none"
                />
              </Field>
              <Field label="Location of Business" optional>
                <input
                  type="text"
                  value={form.business_location}
                  onChange={(e) => update('business_location', e.target.value)}
                  placeholder="City, area"
                  className="connect-input"
                />
              </Field>
            </Section>

            <Section
              eyebrow="Requirement"
              title="What the role will work on"
              hint="A quick note helps us match the right talent. All fields optional."
            >
              <div className="connect-role-req">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FCF487] ring-1 ring-ink" />
                  <span className="text-sm font-semibold text-foreground">{requirementLabel}</span>
                </div>
                <div className="space-y-3">
                  <Field label="Short note" optional>
                    <textarea
                      rows={2}
                      value={form.requirement_note}
                      onChange={(e) => update('requirement_note', e.target.value)}
                      placeholder="What the client would like this role to work on first."
                      className="connect-input resize-none"
                    />
                  </Field>
                  <Field label="Hours" optional hint="Daily or weekly — however the client usually thinks about it.">
                    <input
                      type="text"
                      value={form.hours_note}
                      onChange={(e) => update('hours_note', e.target.value)}
                      placeholder="e.g. 4 hrs daily or 20 hrs/week"
                      className="connect-input"
                    />
                  </Field>
                </div>
              </div>
            </Section>

            <Section
              eyebrow="Talent preferences"
              title="Who they'd like to work with"
              hint="Where the talent should be based, what they should speak, and when they should work."
            >
              <Field label="Country" required hint="India is the default. Pick a different country if the talent should be elsewhere.">
                <select
                  value={form.country_id}
                  onChange={(e) => changeCountry(e.target.value)}
                  className="connect-input"
                >
                  <option value="">{countries.length === 0 ? 'Loading…' : 'Select a country'}</option>
                  {countries.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>

              {stateOptions.length > 0 && (
                <ChipField
                  label="States / regions"
                  hint="Preferred states for the talent. Helpful when local context or culture matters."
                  optional
                  options={stateOptions}
                  selected={form.state_regions}
                  onToggle={(v) => toggle('state_regions', v)}
                />
              )}
              <ChipField
                label="Languages"
                hint="Languages the talent should be fluent in. Pick all that apply."
                required
                options={uniq([...LANGUAGE_OPTIONS, ...form.languages])}
                selected={form.languages}
                onToggle={(v) => toggle('languages', v)}
              />
              <WorkingDaysSelector
                selected={form.working_days}
                onToggle={(v) => toggle('working_days', v)}
              />
            </Section>

            <div className="connect-submit-wrap">
              <button type="submit" disabled={create.isPending} className="connect-submit">
                {create.isPending ? 'Creating…' : 'Create brief'}
              </button>
            </div>
          </form>
        )}
      </div>

      <style jsx global>{globalStyles}</style>
    </div>
  );
}

function Section({
  eyebrow, title, hint, children,
}: { eyebrow: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-sh-warm-border bg-surface p-5 shadow-sm sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-muted">{eyebrow}</p>
      <h2 className="mt-1 text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-foreground-muted">{hint}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label, required, optional, hint, children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-baseline gap-2 text-sm font-medium text-foreground">
        <span>
          {label}
          {required && <span className="text-[#C13515]">*</span>}
        </span>
        {optional && <span className="text-xs font-normal text-foreground-muted">(optional)</span>}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-foreground-muted">{hint}</p>}
    </div>
  );
}

const WORKING_DAYS = [
  { key: 'Mon', optional: false }, { key: 'Tue', optional: false },
  { key: 'Wed', optional: false }, { key: 'Thu', optional: false },
  { key: 'Fri', optional: false }, { key: 'Sat', optional: true },
  { key: 'Sun', optional: true },
] as const;

function WorkingDaysSelector({
  selected, onToggle,
}: { selected: string[]; onToggle: (value: string) => void }) {
  const weekendCount = selected.filter((d) => d === 'Sat' || d === 'Sun').length;
  const allWeekdaysSelected = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].every((d) => selected.includes(d));
  const showWeekendWarning = weekendCount > 0 && (allWeekdaysSelected || selected.length > 5);

  return (
    <div>
      <label className="mb-1 flex items-baseline gap-2 text-sm font-medium text-foreground">
        <span>Working Days<span className="text-[#C13515]">*</span></span>
      </label>
      <p className="mb-3 text-xs text-foreground-muted">
        Days the talent should be available. Mon–Fri are included by default; add{' '}
        <span className="font-semibold text-foreground">Sat</span> and/or{' '}
        <span className="font-semibold text-foreground">Sun</span> if weekend coverage is needed.
      </p>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {WORKING_DAYS.map((day) => {
          const isOn = selected.includes(day.key);
          const cls = `connect-day ${isOn ? 'connect-day-on' : ''} ${!isOn && day.optional ? 'connect-day-opt' : ''}`;
          return (
            <button
              key={day.key}
              type="button"
              onClick={() => onToggle(day.key)}
              aria-pressed={isOn}
              title={day.optional ? `${day.key} (optional)` : day.key}
              className={cls}
            >
              <span>{day.key}</span>
              {day.optional && !isOn && (
                <span className="mt-0.5 text-[9px] uppercase tracking-widest text-foreground-muted">opt</span>
              )}
              {isOn && (
                <svg className="absolute right-1 top-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
      {showWeekendWarning && (
        <p className="mt-3 text-xs font-medium text-[#8B3A1A]">
          Fewer talents accept briefs that require weekend work.
        </p>
      )}
    </div>
  );
}

function ChipField({
  label, hint, required, optional, options, selected, onToggle,
}: {
  label: string;
  hint: string;
  required?: boolean;
  optional?: boolean;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 flex items-baseline gap-2 text-sm font-medium text-foreground">
        <span>
          {label}
          {required && <span className="text-[#C13515]">*</span>}
        </span>
        {optional && <span className="text-xs font-normal text-foreground-muted">(optional)</span>}
      </label>
      <p className="mb-3 text-xs text-foreground-muted">{hint}</p>
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {options.map((opt) => {
          const isOn = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              className={`connect-chip ${isOn ? 'connect-chip-on' : ''}`}
              aria-pressed={isOn}
            >
              {isOn ? `✓ ${opt}` : opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const globalStyles = `
.connect-bg {
  background: #F8F6F0;
  background-image:
    radial-gradient(circle at 0% 0%, rgba(244, 241, 232, 0.8) 0%, transparent 40%),
    radial-gradient(circle at 100% 100%, rgba(232, 229, 221, 0.6) 0%, transparent 40%);
}
.connect-input {
  width: 100%;
  border-radius: 10px;
  border: 1px solid #D9D5C7;
  padding: 10px 12px;
  font-size: 16px;
  color: #222;
  background: #FBFAF6;
  transition: border-color 0.15s, box-shadow 0.15s, background-color 0.15s;
}
.connect-input:focus {
  outline: none;
  border-color: #3A3A3A;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(58, 58, 58, 0.08);
}
.connect-input::placeholder { color: #9C9486; }
.connect-phone {
  display: flex;
  align-items: stretch;
  border: 1px solid #D9D5C7;
  border-radius: 10px;
  background: #FBFAF6;
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s, background-color 0.15s;
}
.connect-phone:focus-within {
  border-color: #3A3A3A;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(58, 58, 58, 0.08);
}
.connect-phone-cc {
  appearance: none;
  -webkit-appearance: none;
  border: none;
  outline: none;
  background: transparent;
  padding: 10px 24px 10px 12px;
  font-size: 15px;
  color: #222;
  cursor: pointer;
}
.connect-phone-divider {
  width: 1px;
  background: #E8E5DD;
  margin: 8px 0;
  flex-shrink: 0;
}
.connect-phone-input {
  flex: 1;
  border: none;
  outline: none;
  padding: 10px 12px;
  font-size: 16px;
  color: #222;
  background: transparent;
  min-width: 0;
}
.connect-phone-input::placeholder { color: #9C9486; }
.connect-submit-wrap {
  margin-top: 8px;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.connect-submit {
  display: block;
  width: 100%;
  border-radius: 12px;
  background: #FCF487;
  color: #0a0a0a;
  font-weight: 700;
  font-size: 16px;
  padding: 14px 16px;
  transition: background-color 0.15s, box-shadow 0.15s, transform 0.05s;
  border: 2px solid #0a0a0a;
  box-shadow: 3px 3px 0 0 #0a0a0a;
}
.connect-submit:hover:not(:disabled) {
  background: #F0E660;
  box-shadow: 4px 4px 0 0 #0a0a0a;
}
.connect-submit:active:not(:disabled) {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 0 #0a0a0a;
}
.connect-submit:disabled {
  background: #F2FCBC;
  color: #6b6b6b;
  border-color: #c0c0c0;
  box-shadow: 3px 3px 0 0 #c0c0c0;
  cursor: not-allowed;
}
.connect-pill {
  padding: 8px 20px;
  border-radius: 9999px;
  font-size: 14px;
  font-weight: 600;
  background: #fff;
  color: #5C5C5C;
  border: 2px solid rgba(10, 10, 10, 0.3);
  transition: border-color 0.15s, color 0.15s, background-color 0.15s, box-shadow 0.15s, transform 0.05s;
  cursor: pointer;
}
.connect-pill:hover {
  border-color: #0a0a0a;
  color: #0a0a0a;
}
.connect-pill:active { transform: translateY(1px); }
.connect-pill-on {
  background: #FCF487;
  color: #0a0a0a;
  border-color: #0a0a0a;
  box-shadow: 3px 3px 0 0 #0a0a0a;
}
.connect-pill-on:hover {
  background: #F0E660;
  color: #0a0a0a;
}
.connect-role-card {
  background: #fff;
  border: 2px solid #0a0a0a;
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: 3px 3px 0 0 #0a0a0a;
}
.connect-role-req {
  background: #FBFAF6;
  border: 1px solid #E8E5DD;
  border-radius: 12px;
  padding: 14px 16px;
}
.connect-chip {
  min-height: 36px;
  padding: 6px 14px;
  border-radius: 9999px;
  font-size: 14px;
  font-weight: 500;
  background: #fff;
  color: #3A3A3A;
  border: 1px solid #D9D5C7;
  transition: border-color 0.15s, background-color 0.15s, color 0.15s;
  cursor: pointer;
}
.connect-chip:hover { border-color: #0a0a0a; }
.connect-chip-on {
  background: #F2FCBC;
  color: #0a0a0a;
  border-color: #0a0a0a;
  box-shadow: inset 0 0 0 1px #0a0a0a;
}
.connect-day {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
  background: #fff;
  color: #3A3A3A;
  border: 1px solid #D9D5C7;
  transition: background-color 0.15s, color 0.15s, border-color 0.15s;
  cursor: pointer;
}
.connect-day:hover { border-color: #0a0a0a; color: #0a0a0a; }
.connect-day-opt {
  border-style: dashed;
  color: #7A7568;
}
.connect-day-on {
  background: #F2FCBC;
  color: #0a0a0a;
  border-color: #0a0a0a;
  border-style: solid;
  box-shadow: inset 0 0 0 1px #0a0a0a;
}
`;
