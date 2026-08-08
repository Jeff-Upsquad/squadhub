'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatStoredPhone,
  normalizeNationalNumber,
  splitStoredPhone,
} from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

// Hiring brief — the Job Cards clone of ClientBriefForm. Covers designers,
// video editors + the hybrid; each selected role becomes its own job card
// (POST /admin/job-cards/client-brief with role_service_types[], one POST
// creates one card per role server-side). The brief lands in New Deals and
// find-or-creates the lead by contact identity.

type JobRole = 'Designers' | 'Editors' | 'Designer plus Editor';

const ROLE_OPTIONS: { value: JobRole; title: string; description: string }[] = [
  {
    value: 'Designers',
    title: 'Designer',
    description: 'Static visuals — graphics, logos, branding, presentations, UI/UX, print collateral.',
  },
  {
    value: 'Editors',
    title: 'Video Editor',
    description: 'Motion & video — short-form reels, long-form edits, ads, corporate videos, animations.',
  },
  {
    value: 'Designer plus Editor',
    title: 'Designer + Editor',
    description: 'One person who does both — design work and video editing — instead of hiring two separate specialists.',
  },
];

const COUNTRY_CODES = [
  { code: '+91', flag: '🇮🇳' }, { code: '+1', flag: '🇺🇸' }, { code: '+44', flag: '🇬🇧' },
  { code: '+971', flag: '🇦🇪' }, { code: '+65', flag: '🇸🇬' }, { code: '+61', flag: '🇦🇺' },
];

type Country = { id: string; name: string };

export default function JobBriefForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const [roles, setRoles] = useState<JobRole[]>([]);
  const [contactName, setContactName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [businessLocation, setBusinessLocation] = useState('');
  const [countryId, setCountryId] = useState('');
  const [briefNote, setBriefNote] = useState('');
  const [packageMin, setPackageMin] = useState('');
  const [packageMax, setPackageMax] = useState('');
  const [packageCurrency, setPackageCurrency] = useState('INR');
  const [packagePeriod, setPackagePeriod] = useState<'monthly' | 'annual'>('monthly');
  const [packageNotes, setPackageNotes] = useState('');
  const [openings, setOpenings] = useState('1');
  const [expectedJoiningDate, setExpectedJoiningDate] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [leadMatch, setLeadMatch] = useState<{ id: string; business_name: string | null } | null>(null);

  const countriesQuery = useQuery({
    queryKey: ['admin-countries'],
    queryFn: () => api.get('/admin/countries').then((r) => r.data?.data || []),
  });
  const countries: Country[] = countriesQuery.data || [];

  // Live lead autofill: once a plausible email or phone is typed, look up the
  // newest matching lead (same identity matching the submit-time
  // find-or-create uses) and prefill whatever is still empty. Uses refs for
  // the "still empty" check so the debounce doesn't retrigger on every field.
  const prefillRef = useRef({ businessName, contactName, email, phone, businessLocation, countryId });
  prefillRef.current = { businessName, contactName, email, phone, businessLocation, countryId };
  useEffect(() => {
    const e = email.trim();
    const digits = phone.replace(/\D/g, '');
    const hasEmail = e.includes('@') && e.includes('.');
    const hasPhone = digits.length >= 6;
    if (!hasEmail && !hasPhone) {
      setLeadMatch(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api.get('/admin/job-cards/lead-lookup', {
          params: {
            email: hasEmail ? e : undefined,
            phone: hasPhone ? formatStoredPhone(countryCode, phone) : undefined,
          },
        });
        const d = r.data?.data;
        if (!d) {
          setLeadMatch(null);
          return;
        }
        setLeadMatch({ id: d.submission_id, business_name: d.business_name });
        const cur = prefillRef.current;
        if (!cur.businessName.trim() && d.business_name) setBusinessName(d.business_name);
        if (!cur.contactName.trim() && d.contact_person) setContactName(d.contact_person);
        if (!cur.email.trim() && d.email) setEmail(d.email);
        if (!cur.businessLocation.trim() && d.business_location) setBusinessLocation(d.business_location);
        if (!cur.countryId && d.country_id) setCountryId(d.country_id);
        if (!cur.phone.trim() && d.phone) {
          const parts = splitStoredPhone(d.phone);
          setCountryCode(parts.code);
          setPhone(normalizeNationalNumber(parts.number, parts.code));
        }
      } catch {
        // soft-fail: autofill is a convenience, never an error state
      }
    }, 600);
    return () => clearTimeout(t);
    // countryCode omitted intentionally: changing it alone shouldn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, phone]);

  const toggleRole = (r: JobRole) =>
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const parseAmount = (raw: string): number | undefined => {
    if (!raw.trim()) return undefined;
    const n = Math.round(Number(raw));
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (roles.length === 0) {
      setError('Pick at least one role.');
      return;
    }
    if (!businessName.trim() && !contactName.trim()) {
      setError('Give at least the business or contact name.');
      return;
    }
    const openingsNum = Math.round(Number(openings));
    setSubmitting(true);
    try {
      await api.post('/admin/job-cards/client-brief', {
        role_service_types: roles,
        contact_name: contactName.trim() || undefined,
        business_name: businessName.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() ? formatStoredPhone(countryCode, phone) : undefined,
        business_location: businessLocation.trim() || undefined,
        country_id: countryId || undefined,
        brief_note: briefNote.trim() || undefined,
        package_min: parseAmount(packageMin),
        package_max: parseAmount(packageMax),
        package_currency: packageCurrency.trim() || undefined,
        package_period: packagePeriod,
        package_notes: packageNotes.trim() || undefined,
        openings_count: Number.isFinite(openingsNum) && openingsNum >= 1 ? openingsNum : undefined,
        expected_joining_date: expectedJoiningDate || undefined,
      });
      const n = roles.length;
      showToast(`${n} job brief${n > 1 ? 's' : ''} created — find ${n > 1 ? 'them' : 'it'} in New Deals`, 'success');
      qc.invalidateQueries({ queryKey: ['admin-job-cards'] });
      onCreated();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err.message || 'Failed to create the job brief';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="hire-bg fixed inset-0 z-40 overflow-y-auto px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={onClose}
          className="-ml-1 mb-3 flex items-center gap-1 text-sm text-foreground-muted transition hover:text-foreground"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Job Cards
        </button>

        <header className="mb-6 text-center sm:mb-8">
          <h1 className="text-[24px] font-semibold tracking-tight text-foreground sm:text-[28px]">
            Hiring brief
          </h1>
          <p className="mt-1.5 text-sm text-foreground-muted sm:text-base">
            A few details about the business and the role — the brief lands in New Deals.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5 pb-8">
          {error && (
            <div className="rounded-lg border border-red-300/40 bg-red-500/10 px-4 py-3 text-sm text-red-500">
              {error}
            </div>
          )}

          <Section eyebrow="Roles" title="Role to hire" hint="One job card is created per selected role.">
            <div className="space-y-2">
              {ROLE_OPTIONS.map((opt) => {
                const on = roles.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleRole(opt.value)}
                    aria-pressed={on}
                    className={`flex w-full items-start gap-3 rounded-xl border-2 px-4 py-3 text-left transition ${
                      on ? 'border-sh-ink bg-sh-lime-soft' : 'border-divider bg-surface hover:border-sh-ink'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        on ? 'border-sh-ink bg-sh-lime' : 'border-divider'
                      }`}
                    >
                      {on && (
                        // text-black: the dot stays constant lime in both modes, so the check stays near-black (sh-ink would flip light in dark).
                        <svg className="h-2.5 w-2.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-foreground">{opt.title}</span>
                      <span className="mt-0.5 block text-xs text-foreground-muted">{opt.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section eyebrow="Customer" title="The business & contact" hint="Phone or email first — existing leads autofill the rest.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Phone" hint="Ideally a WhatsApp number">
                <div className="hire-phone">
                  <select
                    value={countryCode}
                    onChange={(e) => {
                      const code = e.target.value;
                      setCountryCode(code);
                      setPhone((prev) => normalizeNationalNumber(prev, code));
                    }}
                    className="hire-phone-cc"
                    aria-label="Country code"
                  >
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                    ))}
                  </select>
                  <span className="hire-phone-divider" />
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(normalizeNationalNumber(e.target.value, countryCode))}
                    placeholder="Phone number"
                    className="hire-phone-input"
                  />
                </div>
              </Field>
              <Field label="Email">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="hire-input" />
              </Field>
              <Field label="Business name">
                <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Company / brand" className="hire-input" />
              </Field>
              <Field label="Contact person">
                <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Full name" className="hire-input" />
              </Field>
              <Field label="Business location">
                <input type="text" value={businessLocation} onChange={(e) => setBusinessLocation(e.target.value)} placeholder="City, area" className="hire-input" />
              </Field>
              <Field label="Country">
                <select value={countryId} onChange={(e) => setCountryId(e.target.value)} className="hire-input">
                  <option value="">{countries.length === 0 ? 'Loading…' : 'Select a country'}</option>
                  {countries.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
            </div>
            {leadMatch && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-foreground-muted">
                <svg className="h-3.5 w-3.5 text-sh-success" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Matched existing lead{leadMatch.business_name ? ` — ${leadMatch.business_name}` : ''}. Empty fields were prefilled; the brief links to this lead.
              </p>
            )}
          </Section>

          <Section eyebrow="The role" title="Package & openings" hint="All optional — the details firm up during onboarding.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Salary package — min">
                <input type="number" min="0" inputMode="numeric" value={packageMin} onChange={(e) => setPackageMin(e.target.value)} placeholder="e.g. 25000" className="hire-input" />
              </Field>
              <Field label="Salary package — max">
                <input type="number" min="0" inputMode="numeric" value={packageMax} onChange={(e) => setPackageMax(e.target.value)} placeholder="e.g. 40000" className="hire-input" />
              </Field>
              <Field label="Currency">
                <input type="text" value={packageCurrency} onChange={(e) => setPackageCurrency(e.target.value)} placeholder="INR" className="hire-input" />
              </Field>
              <Field label="Period">
                <select value={packagePeriod} onChange={(e) => setPackagePeriod(e.target.value as 'monthly' | 'annual')} className="hire-input">
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual (CTC)</option>
                </select>
              </Field>
              <Field label="Openings per role">
                <input type="number" min="1" inputMode="numeric" value={openings} onChange={(e) => setOpenings(e.target.value)} className="hire-input" />
              </Field>
              <Field label="Expected joining date">
                <input type="date" value={expectedJoiningDate} onChange={(e) => setExpectedJoiningDate(e.target.value)} className="hire-input" />
              </Field>
            </div>
            <Field label="Package notes">
              <textarea rows={2} value={packageNotes} onChange={(e) => setPackageNotes(e.target.value)} placeholder="Incentives, variable pay, anything package-related." className="hire-input resize-none" />
            </Field>
            <Field label="Short note about the requirement">
              <textarea rows={3} value={briefNote} onChange={(e) => setBriefNote(e.target.value)} placeholder="What kind of person is needed, context, urgency." className="hire-input resize-none" />
            </Field>
          </Section>

          <div className="hire-submit-wrap">
            <button type="submit" disabled={submitting} className="hire-submit">
              {submitting ? 'Submitting…' : 'Submit'}
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
    <section className="rounded-2xl border border-sh-warm-border bg-surface p-5 shadow-sm sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-muted">{eyebrow}</p>
      <h2 className="mt-1 text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-foreground-muted">{hint}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-foreground-muted">{hint}</p>}
    </div>
  );
}

// Same skin as ClientBriefForm, but namespaced hire-* (ClientBriefForm injects
// identical GLOBAL connect-* classes — reusing those names would let whichever
// form mounts last restyle the other) and rebuilt on the theme variables so
// the form flips with .dark.
const globalStyles = `
.hire-bg {
  background: var(--sh-cream);
}
.hire-input {
  width: 100%;
  border-radius: 10px;
  border: 1px solid var(--divider-strong);
  padding: 10px 12px;
  font-size: 16px;
  color: var(--foreground);
  background: var(--surface);
  transition: border-color 0.15s, box-shadow 0.15s, background-color 0.15s;
}
.hire-input:focus {
  outline: none;
  border-color: var(--foreground-muted);
  background: var(--surface-alt);
  box-shadow: 0 0 0 3px rgba(128, 128, 128, 0.15);
}
.hire-input::placeholder { color: var(--foreground-dim); }
.hire-phone {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--divider-strong);
  border-radius: 10px;
  background: var(--surface);
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s, background-color 0.15s;
}
.hire-phone:focus-within {
  border-color: var(--foreground-muted);
  background: var(--surface-alt);
  box-shadow: 0 0 0 3px rgba(128, 128, 128, 0.15);
}
.hire-phone-cc {
  appearance: none;
  -webkit-appearance: none;
  border: none;
  outline: none;
  background: transparent;
  padding: 10px 24px 10px 12px;
  font-size: 15px;
  color: var(--foreground);
  cursor: pointer;
}
.hire-phone-divider {
  width: 1px;
  background: var(--divider);
  margin: 8px 0;
  flex-shrink: 0;
}
.hire-phone-input {
  flex: 1;
  border: none;
  outline: none;
  padding: 10px 12px;
  font-size: 16px;
  color: var(--foreground);
  background: transparent;
  min-width: 0;
}
.hire-phone-input::placeholder { color: var(--foreground-dim); }
.hire-submit-wrap {
  margin-top: 8px;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
/* Constant-lime exception: the submit stays lime in BOTH modes, so its text
 * and border stay near-black (var(--sh-ink) would flip light in dark and
 * vanish against the lime). The hard shadow uses var(--sh-offset), which
 * flips to a light rgba in dark so the neo-brutalist pop survives. */
.hire-submit {
  display: block;
  width: 100%;
  border-radius: 12px;
  background: var(--sh-lime);
  color: #0a0a0a;
  font-weight: 700;
  font-size: 16px;
  padding: 14px 16px;
  transition: background-color 0.15s, box-shadow 0.15s, transform 0.05s;
  border: 2px solid #0a0a0a;
  box-shadow: 3px 3px 0 0 var(--sh-offset);
}
.hire-submit:hover:not(:disabled) {
  background: var(--sh-lime-hover);
  box-shadow: 4px 4px 0 0 var(--sh-offset);
}
.hire-submit:active:not(:disabled) {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 0 var(--sh-offset);
}
.hire-submit:disabled {
  background: var(--sh-lime-soft);
  color: var(--sh-ink-subtle);
  border-color: var(--divider-strong);
  box-shadow: 3px 3px 0 0 var(--divider-strong);
  cursor: not-allowed;
}
`;
