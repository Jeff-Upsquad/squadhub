'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import { STATES_BY_COUNTRY_NAME, LANGUAGE_OPTIONS } from './locationLanguageOptions';

// The internal-facing twin of the public /connect brief form. Same fields and
// look (so a brief a salesperson fills out is identical to what the client would
// submit), but it posts to the admin endpoint, which tags the card with
// source='internal_brief' + created_by. Two brief types:
//   - 'creative'   → Designer / Video Editor / Designer + Editor
//   - 'accountant' → Accountant
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
    <div className="connect-bg fixed inset-0 z-40 overflow-y-auto px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex items-center justify-between">
          <button onClick={onClose} className="text-sm font-medium text-[#5C5C5C] hover:text-[#222]">
            ← Back
          </button>
          <span className="rounded-full bg-[#F2FCBC] px-3 py-1 text-xs font-semibold text-[#0a0a0a] ring-1 ring-[#0a0a0a]">
            New client brief
          </span>
        </div>

        <div className="mb-6 text-center">
          <h1 className="text-[26px] font-semibold text-[#222]">{typeMeta.title} brief</h1>
          <p className="mt-1 text-base text-[#5C5C5C]">{typeMeta.blurb}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="rounded-lg border border-[#E0B7A2] bg-[#FBEFE9] px-4 py-3 text-sm font-medium text-[#8B3A1A]">
              {error}
            </div>
          )}

          {type === 'creative' && (
            <Section eyebrow="Service" title="What do you need?" hint="Pick the role this brief is for.">
              <div className="flex flex-wrap gap-2">
                {CREATIVE_ROLES.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setRole(r.key)}
                    className={`connect-chip ${role === r.key ? 'connect-chip-on' : ''}`}
                    aria-pressed={role === r.key}
                  >
                    {role === r.key ? `✓ ${r.label}` : r.label}
                  </button>
                ))}
              </div>
            </Section>
          )}

          <Section eyebrow="Client" title="Client contact" hint="Who the brief is for — we'll reach them here.">
            <Field label="Contact name" required>
              <input
                type="text"
                required
                value={form.contact_name}
                onChange={(e) => update('contact_name', e.target.value)}
                placeholder="Full name"
                className="connect-input"
              />
            </Field>
            <Field label="Email" required>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="email@company.com"
                className="connect-input"
              />
            </Field>
            <Field label="Contact number" required hint="Ideally a WhatsApp number.">
              <div className="connect-phone">
                <select
                  value={form.country_code}
                  onChange={(e) => update('country_code', e.target.value)}
                  className="connect-phone-cc"
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                  ))}
                </select>
                <div className="connect-phone-divider" />
                <input
                  type="tel"
                  required
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  placeholder="Phone number"
                  className="connect-phone-input"
                />
              </div>
            </Field>
          </Section>

          <Section eyebrow="Brand" title="Brand & requirement" hint="What the client does and what they need.">
            <Field label="Brand / business name" required>
              <input
                type="text"
                required
                value={form.brand_name}
                onChange={(e) => update('brand_name', e.target.value)}
                placeholder="Brand or business name"
                className="connect-input"
              />
            </Field>
            <Field label="Nature of business" required>
              <input
                type="text"
                required
                value={form.business_nature}
                onChange={(e) => update('business_nature', e.target.value)}
                placeholder="e.g. Healthcare, D2C skincare, SaaS"
                className="connect-input"
              />
            </Field>
            <Field label="What do they need?" required hint="A short brief of the work.">
              <textarea
                required
                rows={3}
                value={form.business_note}
                onChange={(e) => update('business_note', e.target.value)}
                placeholder="Describe the work the client needs help with"
                className="connect-input resize-none"
              />
            </Field>
            <Field label="Business location" optional>
              <input
                type="text"
                value={form.business_location}
                onChange={(e) => update('business_location', e.target.value)}
                placeholder="City / area"
                className="connect-input"
              />
            </Field>
            <Field label="Specific requirements" optional hint="Tools, style, deliverables, references…">
              <textarea
                rows={2}
                value={form.requirement_note}
                onChange={(e) => update('requirement_note', e.target.value)}
                placeholder="Anything specific the talent should know"
                className="connect-input resize-none"
              />
            </Field>
            <Field label="Hours / availability" optional>
              <input
                type="text"
                value={form.hours_note}
                onChange={(e) => update('hours_note', e.target.value)}
                placeholder="e.g. ~4 hours/day, full-time"
                className="connect-input"
              />
            </Field>
          </Section>

          <Section eyebrow="Preferences" title="Talent preferences" hint="Where the talent should be, languages, and working days.">
            <Field label="Country" required>
              <select
                required
                value={form.country_id}
                onChange={(e) => changeCountry(e.target.value)}
                className="connect-input"
              >
                <option value="">Select a country</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>

            {regionOptions.length > 0 && (
              <ChipField
                label="States / regions"
                optional
                hint="Leave empty to consider the whole country."
                options={regionOptions}
                selected={form.state_regions}
                onToggle={(v) => toggle('state_regions', v)}
              />
            )}

            <ChipField
              label="Languages"
              required
              hint="Languages the talent should be comfortable in."
              options={languageOptions}
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
      </div>

      <style jsx global>{globalStyles}</style>
    </div>
  );
}

function Section({
  eyebrow, title, hint, children,
}: { eyebrow: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#E8E5DD] bg-white p-5 shadow-sm sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7A7568]">{eyebrow}</p>
      <h2 className="mt-1 text-lg font-semibold text-[#222]">{title}</h2>
      <p className="mt-1 text-sm text-[#5C5C5C]">{hint}</p>
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
      <label className="mb-1.5 flex items-baseline gap-2 text-sm font-medium text-[#222]">
        <span>
          {label}
          {required && <span className="text-[#C13515]">*</span>}
        </span>
        {optional && <span className="text-xs font-normal text-[#9C9486]">(optional)</span>}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-[#7A7568]">{hint}</p>}
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
  return (
    <div>
      <label className="mb-1 flex items-baseline gap-2 text-sm font-medium text-[#222]">
        <span>Working days<span className="text-[#C13515]">*</span></span>
      </label>
      <p className="mb-3 text-xs text-[#7A7568]">
        Days the talent should be available. Mon–Fri by default; add Sat/Sun for weekend coverage.
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
              className={cls}
            >
              <span>{day.key}</span>
              {day.optional && !isOn && (
                <span className="mt-0.5 text-[9px] uppercase tracking-widest text-[#9C9486]">opt</span>
              )}
            </button>
          );
        })}
      </div>
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
      <label className="mb-1 flex items-baseline gap-2 text-sm font-medium text-[#222]">
        <span>
          {label}
          {required && <span className="text-[#C13515]">*</span>}
        </span>
        {optional && <span className="text-xs font-normal text-[#9C9486]">(optional)</span>}
      </label>
      <p className="mb-3 text-xs text-[#7A7568]">{hint}</p>
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
