'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { showToast } from '@/components/Toast';

// Hiring brief — the Job Cards clone of ClientBriefForm. Phase 1 covers
// designers + video editors; each selected role becomes its own job card
// (POST /admin/job-cards/client-brief with role_service_types[], one POST
// creates one card per role server-side). The brief lands in New Deals and
// find-or-creates the lead by contact identity.

type JobRole = 'Designers' | 'Editors';

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

  const countriesQuery = useQuery({
    queryKey: ['admin-countries'],
    queryFn: () => api.get('/admin/countries').then((r) => r.data?.data || []),
  });
  const countries: Country[] = countriesQuery.data || [];

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
        phone: phone.trim() ? `${countryCode} ${phone.trim()}`.trim() : undefined,
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
            <div className="rounded-lg border border-[#E0B7A2] bg-[#FBEFE9] px-4 py-3 text-sm text-[#8B3A1A]">
              {error}
            </div>
          )}

          <Section eyebrow="Roles" title="Who are they hiring?" hint="One job card is created per selected role.">
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
                      on ? 'border-[#0a0a0a] bg-[#F2FCBC]' : 'border-divider bg-surface hover:border-[#0a0a0a]'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        on ? 'border-[#0a0a0a] bg-[#FCF487]' : 'border-divider'
                      }`}
                    >
                      {on && (
                        <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
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

          <Section eyebrow="Customer" title="The business & contact" hint="Used to find-or-create the lead in the Clients module.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Business name">
                <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Company / brand" className="connect-input" />
              </Field>
              <Field label="Contact person">
                <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Full name" className="connect-input" />
              </Field>
              <Field label="Email">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="connect-input" />
              </Field>
              <Field label="Phone" hint="Ideally a WhatsApp number">
                <div className="connect-phone">
                  <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)} className="connect-phone-cc" aria-label="Country code">
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                    ))}
                  </select>
                  <span className="connect-phone-divider" />
                  <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" className="connect-phone-input" />
                </div>
              </Field>
              <Field label="Business location">
                <input type="text" value={businessLocation} onChange={(e) => setBusinessLocation(e.target.value)} placeholder="City, area" className="connect-input" />
              </Field>
              <Field label="Country">
                <select value={countryId} onChange={(e) => setCountryId(e.target.value)} className="connect-input">
                  <option value="">{countries.length === 0 ? 'Loading…' : 'Select a country'}</option>
                  {countries.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>

          <Section eyebrow="The role" title="Package & openings" hint="All optional — the details firm up during onboarding.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Salary package — min">
                <input type="number" min="0" inputMode="numeric" value={packageMin} onChange={(e) => setPackageMin(e.target.value)} placeholder="e.g. 25000" className="connect-input" />
              </Field>
              <Field label="Salary package — max">
                <input type="number" min="0" inputMode="numeric" value={packageMax} onChange={(e) => setPackageMax(e.target.value)} placeholder="e.g. 40000" className="connect-input" />
              </Field>
              <Field label="Currency">
                <input type="text" value={packageCurrency} onChange={(e) => setPackageCurrency(e.target.value)} placeholder="INR" className="connect-input" />
              </Field>
              <Field label="Period">
                <select value={packagePeriod} onChange={(e) => setPackagePeriod(e.target.value as 'monthly' | 'annual')} className="connect-input">
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual (CTC)</option>
                </select>
              </Field>
              <Field label="Openings per role">
                <input type="number" min="1" inputMode="numeric" value={openings} onChange={(e) => setOpenings(e.target.value)} className="connect-input" />
              </Field>
              <Field label="Expected joining date">
                <input type="date" value={expectedJoiningDate} onChange={(e) => setExpectedJoiningDate(e.target.value)} className="connect-input" />
              </Field>
            </div>
            <Field label="Package notes">
              <textarea rows={2} value={packageNotes} onChange={(e) => setPackageNotes(e.target.value)} placeholder="Incentives, variable pay, anything package-related." className="connect-input resize-none" />
            </Field>
            <Field label="Short note about the requirement">
              <textarea rows={3} value={briefNote} onChange={(e) => setBriefNote(e.target.value)} placeholder="What kind of person they're hiring, context, urgency." className="connect-input resize-none" />
            </Field>
          </Section>

          <div className="connect-submit-wrap">
            <button type="submit" disabled={submitting} className="connect-submit">
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

// Same connect-* skin as ClientBriefForm so both briefs feel identical.
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
`;
