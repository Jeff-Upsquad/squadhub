'use client';

import { useEffect, useRef, useState } from 'react';

// Kept in sync with admin/locationLanguageOptions.ts.
// Inlined here because /web has no /admin dependency by design.
const STATES_BY_COUNTRY_NAME: Record<string, string[]> = {
  India: [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
    'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
    'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
    'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
    'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
    'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
    'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh',
  ],
  'United States': [
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
    'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
    'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana',
    'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
    'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
    'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
    'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
    'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
    'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
    'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia',
  ],
  'United Kingdom': ['England', 'Scotland', 'Wales', 'Northern Ireland'],
  'United Arab Emirates': [
    'Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain',
    'Ras Al Khaimah', 'Fujairah',
  ],
  Singapore: ['Central', 'East', 'North', 'North-East', 'West'],
  Australia: [
    'New South Wales', 'Victoria', 'Queensland', 'Western Australia',
    'South Australia', 'Tasmania', 'Australian Capital Territory',
    'Northern Territory',
  ],
  Canada: [
    'Alberta', 'British Columbia', 'Manitoba', 'New Brunswick',
    'Newfoundland and Labrador', 'Nova Scotia', 'Ontario',
    'Prince Edward Island', 'Quebec', 'Saskatchewan',
    'Northwest Territories', 'Nunavut', 'Yukon',
  ],
};

type Country = { id: string; name: string; currency: string; sort_order: number };

const LANGUAGES = [
  'English', 'Hindi', 'Tamil', 'Telugu', 'Malayalam', 'Kannada',
  'Marathi', 'Bengali', 'Gujarati', 'Punjabi', 'Urdu',
  'Arabic', 'Spanish', 'French', 'German', 'Mandarin',
];

const COUNTRY_CODES = [
  { code: '+91', flag: '🇮🇳' },
  { code: '+1', flag: '🇺🇸' },
  { code: '+44', flag: '🇬🇧' },
  { code: '+971', flag: '🇦🇪' },
  { code: '+65', flag: '🇸🇬' },
  { code: '+61', flag: '🇦🇺' },
  { code: '+49', flag: '🇩🇪' },
  { code: '+33', flag: '🇫🇷' },
  { code: '+81', flag: '🇯🇵' },
  { code: '+86', flag: '🇨🇳' },
];

// Multi-select roles. Mirrors upsquadconnect.com's three service-type pills
// (Designers / Editors / Designer plus Editor). At submit time, any
// combination collapses to a single canonical service_type — picking
// "Designer plus Editor" OR picking both Designer + Editor both map to
// the hybrid service_type.
// Step-1 pills are accountant specialties. They all roll up to the single
// 'accountant' subscription/service_type, so any selection produces exactly
// one card; the chosen specialties are folded into that card's note on submit.
type RoleSlug =
  | 'bookkeeping'
  | 'gst_tds'
  | 'payroll'
  | 'reporting'
  | 'tax'
  | 'audit';
type ServiceType = 'accountant';

const ROLE_OPTIONS: {
  slug: RoleSlug;
  title: string;
  description: string;
}[] = [
  {
    slug: 'bookkeeping',
    title: 'Bookkeeping',
    description: 'Day-to-day books — recording transactions, reconciliations, and keeping your accounts up to date.',
  },
  {
    slug: 'gst_tds',
    title: 'GST & TDS',
    description: 'Indirect tax & withholding — GST returns, TDS deductions, and statutory filings before each deadline.',
  },
  {
    slug: 'payroll',
    title: 'Payroll',
    description: 'Salary processing — payslips, PF/ESI, and monthly payroll runs for your team.',
  },
  {
    slug: 'reporting',
    title: 'Financial reporting',
    description: 'MIS & statements — monthly reports, P&L, balance sheet, and numbers you can act on.',
  },
  {
    slug: 'tax',
    title: 'Income tax',
    description: 'Direct tax — income tax computation, advance tax, and annual return filing.',
  },
  {
    slug: 'audit',
    title: 'Audit support',
    description: 'Audit readiness — schedules, documentation, and support through statutory or internal audits.',
  },
];

function rolesToServiceType(roles: RoleSlug[]): ServiceType | null {
  return roles.length > 0 ? 'accountant' : null;
}

// Every accountant specialty maps to the one 'accountant' subscription, so a
// selection of any size yields a single card. The picked specialties are
// summarised into that card's requirement note in handleSubmit.
function rolesToServiceTypes(roles: RoleSlug[]): ServiceType[] {
  return roles.length > 0 ? ['accountant'] : [];
}

// Phone is stored as "+91 9447402340". Split on autofill by longest-matching
// prefix in COUNTRY_CODES; fallback to +91.
function splitPhone(stored: string | null | undefined): { code: string; number: string } {
  const fallback = { code: '+91', number: '' };
  if (!stored) return fallback;
  const trimmed = stored.trim();
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  for (const c of sorted) {
    if (trimmed.startsWith(c.code)) {
      return { code: c.code, number: trimmed.slice(c.code.length).trim() };
    }
  }
  return { code: fallback.code, number: trimmed };
}

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
};

const initialForm: FormData = {
  brand_name: '',
  business_nature: '',
  business_note: '',
  contact_name: '',
  email: '',
  country_code: '+91',
  phone: '',
  business_location: '',
  country_id: '',
  state_regions: [],
  languages: [],
  working_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
};

// Per-role requirement details, captured in the "Requirement" section on
// Step 2. One sub-row per role ticked in Step 1. Both fields optional —
// kept here as strings (not narrowed to selected roles) so toggling a
// role off and back on preserves what the user already typed.
type RoleRequirement = { note: string; hours: string };
const emptyRoleRequirements: Record<RoleSlug, RoleRequirement> = {
  bookkeeping: { note: '', hours: '' },
  gst_tds: { note: '', hours: '' },
  payroll: { note: '', hours: '' },
  reporting: { note: '', hours: '' },
  tax: { note: '', hours: '' },
  audit: { note: '', hours: '' },
};

export default function AccountantConnectPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [roles, setRoles] = useState<RoleSlug[]>([]);
  const [form, setForm] = useState<FormData>(initialForm);
  const [roleRequirements, setRoleRequirements] =
    useState<Record<RoleSlug, RoleRequirement>>(emptyRoleRequirements);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [countries, setCountries] = useState<Country[]>([]);
  // Autofill state — silent single-field lookup (email OR phone). On match,
  // pre-fill contact + latest brand + talent prefs. The user can edit
  // brand_name to start a fresh brand; that path clears brand-specific
  // fields and dismisses the banner.
  const [prefilledFromLead, setPrefilledFromLead] = useState(false);
  const prefilledBrandRef = useRef<string | null>(null);
  const lastLookupKeyRef = useRef<string | null>(null);

  // Fetch country list once. Default to India (matching the upsquad onboard
  // form's behavior) but let the user pick any country we serve.
  useEffect(() => {
    fetch('/clients/countries')
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.data)) {
          setCountries(data.data);
          const india = data.data.find((c: Country) => c.name === 'India');
          setForm((prev) => ({
            ...prev,
            country_id: prev.country_id || india?.id || data.data[0]?.id || '',
          }));
        }
      })
      .catch(() => {/* non-fatal — admin can fix country on review */});
  }, []);

  // Debounced lookup: fire when email looks valid OR phone has ≥7 digits.
  // Don't re-fire once we've already prefilled — would clobber edits the
  // user makes after the autofill.
  useEffect(() => {
    if (prefilledFromLead) return;
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
    const phoneDigits = form.phone.replace(/\D/g, '');
    const phoneOk = phoneDigits.length >= 7;
    if (!emailOk && !phoneOk) return;
    const phoneForLookup = phoneOk ? `${form.country_code} ${form.phone.trim()}`.trim() : '';
    const key = `${emailOk ? form.email.trim().toLowerCase() : ''}|${phoneForLookup}`;
    if (key === lastLookupKeyRef.current) return;
    lastLookupKeyRef.current = key;

    const t = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (emailOk) params.set('email', form.email.trim());
        if (phoneOk) params.set('phone', phoneForLookup);
        const r = await fetch(`/leads/lookup?${params.toString()}`);
        const data = await r.json();
        if (!data?.success || !data.data?.found) return;
        const lead = data.data.lead;
        const brand = (data.data.brands || [])[0];
        if (!lead) return;

        // Re-check the guard inside the timer — the user may have
        // dismissed the banner during the debounce.
        setPrefilledFromLead((already) => {
          if (already) return true;

          const phoneParts = splitPhone(lead.phone);
          setForm((prev) => ({
            ...prev,
            contact_name: prev.contact_name || lead.contact_name || '',
            email: prev.email || lead.email || '',
            country_code: prev.phone ? prev.country_code : phoneParts.code,
            phone: prev.phone || phoneParts.number,
            // Brand + talent prefs from the most recent brand (if any).
            brand_name: brand?.brand_name || prev.brand_name,
            business_nature: brand?.business_nature || prev.business_nature,
            business_note: brand?.business_note || prev.business_note,
            // Per-role requirement details live on subscription_cards now,
            // not on the brand. They're tied to Step 1 (which we don't
            // autofill either), so we leave the Requirement section empty
            // on rehydration — same rationale as the role pills below.
            business_location: brand?.business_location || prev.business_location,
            country_id: brand?.country_id || prev.country_id,
            state_regions: brand?.target_regions?.length ? brand.target_regions : prev.state_regions,
            languages: brand?.target_languages?.length ? brand.target_languages : prev.languages,
            working_days: brand?.working_days?.length ? brand.working_days : prev.working_days,
          }));

          // Step 1 (role pills) is intentionally NOT autofilled. The brand row
          // stores a single collapsed service_type slug, so rehydrating from
          // it would silently overwrite multi-pick selections (Designer +
          // Editor) with the combo. Make the user pick roles fresh every
          // submission instead.

          prefilledBrandRef.current = brand?.brand_name || null;
          return true;
        });
      } catch {
        // Silent — autofill is a UX nicety, not load-bearing.
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [form.email, form.phone, form.country_code, prefilledFromLead]);

  const selectedCountryName = countries.find((c) => c.id === form.country_id)?.name || '';
  const stateOptions = STATES_BY_COUNTRY_NAME[selectedCountryName] || [];

  function update<K extends keyof FormData>(field: K, value: FormData[K]) {
    setForm((prev) => {
      // "Different brand?" path: once prefilled, if the user changes the
      // brand_name away from the autofilled one, clear the brand-specific
      // fields and dismiss the banner. Contact + talent prefs stay — same
      // lead is most likely still the same lead.
      if (
        field === 'brand_name' &&
        prefilledFromLead &&
        prefilledBrandRef.current &&
        typeof value === 'string' &&
        value.trim().toLowerCase() !== prefilledBrandRef.current.toLowerCase()
      ) {
        setPrefilledFromLead(false);
        prefilledBrandRef.current = null;
        return {
          ...prev,
          brand_name: value as FormData['brand_name'],
          business_nature: '',
          business_note: '',
          business_location: '',
        };
      }
      return { ...prev, [field]: value };
    });
  }

  function changeCountry(newCountryId: string) {
    // Drop any selected states — they're country-specific and won't make
    // sense if the user switches countries.
    setForm((prev) => ({ ...prev, country_id: newCountryId, state_regions: [] }));
  }

  function toggle(field: 'state_regions' | 'languages' | 'working_days', value: string) {
    setForm((prev) => {
      const arr = prev[field];
      return {
        ...prev,
        [field]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value],
      };
    });
  }

  function toggleRole(slug: RoleSlug) {
    setRoles((prev) =>
      prev.includes(slug) ? prev.filter((r) => r !== slug) : [...prev, slug],
    );
  }

  function updateRoleReq(
    slug: RoleSlug,
    field: keyof RoleRequirement,
    value: string,
  ) {
    setRoleRequirements((prev) => ({
      ...prev,
      [slug]: { ...prev[slug], [field]: value },
    }));
  }

  function goToStep2() {
    if (roles.length === 0) return;
    setStep(2);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const serviceTypes = rolesToServiceTypes(roles);
    if (serviceTypes.length === 0) {
      setStep(1);
      return;
    }
    setError('');

    if (form.languages.length === 0) {
      setError('Please pick at least one language.');
      return;
    }
    if (form.working_days.length === 0) {
      setError('Please pick at least one working day.');
      return;
    }

    // All chosen accountant specialties roll up into the single 'accountant'
    // card. Summarise the picked specialties + any per-specialty notes/hours
    // into that one card's requirement note so the admin sees the full picture.
    const titleOf = (slug: RoleSlug) =>
      ROLE_OPTIONS.find((o) => o.slug === slug)?.title ?? slug;
    const noteLines: string[] = [];
    if (roles.length > 0) {
      noteLines.push(`Services needed: ${roles.map(titleOf).join(', ')}`);
    }
    for (const r of roles) {
      const note = roleRequirements[r].note.trim();
      if (note) noteLines.push(`${titleOf(r)} — ${note}`);
    }
    const hoursVals = roles
      .map((r) => roleRequirements[r].hours.trim())
      .filter(Boolean);
    const combinedNote = noteLines.join('\n');
    const combinedHours = hoursVals.join(' · ');
    const roleReqsPayload: Record<string, { note?: string; hours?: string }> =
      combinedNote || combinedHours
        ? {
            accountant: {
              ...(combinedNote ? { note: combinedNote } : {}),
              ...(combinedHours ? { hours: combinedHours } : {}),
            },
          }
        : {};

    setSubmitting(true);
    try {
      const res = await fetch('/leads/landing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_types: serviceTypes,
          brand_name: form.brand_name.trim(),
          business_nature: form.business_nature.trim(),
          business_note: form.business_note.trim(),
          contact_name: form.contact_name.trim(),
          email: form.email.trim(),
          phone: `${form.country_code} ${form.phone.trim()}`.trim(),
          business_location: form.business_location.trim() || undefined,
          country_id: form.country_id,
          state_regions: form.state_regions,
          languages: form.languages,
          working_days: form.working_days,
          ...(Object.keys(roleReqsPayload).length > 0
            ? { role_requirements: roleReqsPayload }
            : {}),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      setSubmitted(true);
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    } catch {
      setError('Failed to submit. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="connect-bg flex min-h-screen items-center justify-center px-4 py-8">
        <div className="w-full max-w-md rounded-2xl bg-white border border-[#E8E5DD] p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F4F1E8]">
            <svg className="h-8 w-8 text-[#3A3A3A]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-[#222]">Thank you!</h1>
          <p className="mt-2 text-base text-[#5C5C5C]">
            Your brief is in. Our team will review it and reach out within one business day to confirm next steps.
          </p>
        </div>
        <style jsx global>{globalStyles}</style>
      </div>
    );
  }

  return (
    <div className="connect-bg min-h-screen px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 sm:mb-8 text-center">
          <h1 className="text-[24px] sm:text-[28px] font-semibold tracking-tight text-[#222]">
            Tell us about your business
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-[#5C5C5C]">
            A few quick details so we can match you with the right accountant.
          </p>
        </header>

        {step === 1 && (
          <section className="flex flex-col items-center">
            <h2 className="mb-2 text-xs font-semibold tracking-[0.12em] text-[#7A7568] uppercase">
              What do you need help with?
            </h2>
            <p className="mb-2 max-w-md text-center text-sm text-[#5C5C5C]">
              Pick the accounting work you need — bookkeeping, GST &amp; TDS, payroll, reporting, tax, or audit support.
            </p>
            <p className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-[#0a0a0a] bg-[#F2FCBC] px-3 py-1 text-xs font-semibold text-[#0a0a0a]">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              You can pick one or more
            </p>

            <div className="mb-2 inline-flex flex-wrap justify-center gap-2">
              {ROLE_OPTIONS.map((opt) => {
                const selected = roles.includes(opt.slug);
                return (
                  <button
                    key={opt.slug}
                    type="button"
                    onClick={() => toggleRole(opt.slug)}
                    aria-pressed={selected}
                    className={`connect-pill ${selected ? 'connect-pill-on' : ''}`}
                  >
                    {selected && (
                      <svg className="-mt-0.5 mr-1.5 inline-block h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {opt.title}
                  </button>
                );
              })}
            </div>

            {roles.length === 0 ? (
              <p className="mt-4 text-sm font-medium text-[#C97744]">
                Pick at least one to continue.
              </p>
            ) : (
              <div className="mt-4 w-full max-w-md space-y-2">
                {ROLE_OPTIONS.filter((o) => roles.includes(o.slug)).map((opt) => (
                  <div key={opt.slug} className="connect-role-card">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#FCF487] ring-1 ring-[#0a0a0a]" />
                      <span className="text-sm font-bold text-[#0a0a0a]">{opt.title}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-[#5C5C5C]">{opt.description}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 w-full max-w-md">
              <button
                type="button"
                onClick={goToStep2}
                disabled={roles.length === 0}
                className="connect-submit"
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <form onSubmit={handleSubmit} className="space-y-5 pb-8">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="-ml-1 mb-2 flex items-center gap-1 text-sm text-[#5C5C5C] hover:text-[#222]"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>

            {prefilledFromLead && (
              <div className="rounded-lg border border-[#0a0a0a] bg-[#F2FCBC] px-4 py-3 text-sm text-[#0a0a0a]">
                <span className="font-semibold">Welcome back —</span>{' '}
                pre-filled from your last brief. Change brand name to start a new brand.
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-[#FBEFE9] border border-[#E0B7A2] px-4 py-3 text-sm text-[#8B3A1A]">
                {error}
              </div>
            )}

            {/* Section: Contact (first so we can autofill on email/phone) */}
            <Section
              eyebrow="Customer"
              title="Your contact"
              hint="How we'll reach you to confirm and schedule the kickoff call."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Email" required>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                    placeholder="you@company.com"
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
                      required
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
                    required
                    value={form.contact_name}
                    onChange={(e) => update('contact_name', e.target.value)}
                    placeholder="Full name"
                    className="connect-input"
                  />
                </Field>
              </div>
            </Section>

            {/* Section: Brand */}
            <Section
              eyebrow="Client brief"
              title="About your brand"
              hint="Helps creators understand your space and pitch ideas that fit."
            >
              <Field label="Brand Name" required>
                <input
                  type="text"
                  required
                  value={form.brand_name}
                  onChange={(e) => update('brand_name', e.target.value)}
                  placeholder="Your brand name"
                  className="connect-input"
                />
              </Field>
              <Field label="Nature of Business" required>
                <input
                  type="text"
                  required
                  value={form.business_nature}
                  onChange={(e) => update('business_nature', e.target.value)}
                  placeholder="e.g. Retail, SaaS, Education"
                  className="connect-input"
                />
              </Field>
              <Field label="Short Note About the Business" required>
                <textarea
                  required
                  rows={3}
                  value={form.business_note}
                  onChange={(e) => update('business_note', e.target.value)}
                  placeholder="What you do, who you serve, what makes you different."
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

            {/* Section: Requirement — one mini-card per role ticked on Step 1.
                Both fields optional. Empties are filtered out on submit, so
                a role with no detail simply doesn't get a role_requirements
                entry (and the resulting subscription_card stays with NULL
                requirement_note + hours_note). */}
            <Section
              eyebrow="Requirement"
              title="What each service should cover"
              hint="A quick note per service helps us match the right accountant. All fields optional."
            >
              {ROLE_OPTIONS.filter((o) => roles.includes(o.slug)).map((opt) => (
                <div key={opt.slug} className="connect-role-req">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#FCF487] ring-1 ring-[#0a0a0a]" />
                    <span className="text-sm font-semibold text-[#0a0a0a]">{opt.title}</span>
                  </div>
                  <div className="space-y-3">
                    <Field label="Short note" optional>
                      <textarea
                        rows={2}
                        value={roleRequirements[opt.slug].note}
                        onChange={(e) => updateRoleReq(opt.slug, 'note', e.target.value)}
                        placeholder="What you'd like this service to cover first."
                        className="connect-input resize-none"
                      />
                    </Field>
                    <Field label="Hours" optional hint="Daily or weekly — however you usually think about it.">
                      <input
                        type="text"
                        value={roleRequirements[opt.slug].hours}
                        onChange={(e) => updateRoleReq(opt.slug, 'hours', e.target.value)}
                        placeholder="e.g. 4 hrs daily or 20 hrs/week"
                        className="connect-input"
                      />
                    </Field>
                  </div>
                </div>
              ))}
            </Section>

            {/* Section: Accountant preferences */}
            <Section
              eyebrow="Accountant preferences"
              title="Who you'd like to work with"
              hint="Where the accountant should be based, what they should speak, and when they should work."
            >
              <Field label="Country" required hint="India is the default. Pick a different country if your accountant should be elsewhere.">
                <select
                  required
                  value={form.country_id}
                  onChange={(e) => changeCountry(e.target.value)}
                  className="connect-input"
                >
                  {countries.length === 0 && <option value="">Loading…</option>}
                  {countries.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>

              {stateOptions.length > 0 && (
                <ChipField
                  label="States / regions"
                  hint="Preferred states for the accountant. Helpful when local tax rules or context matter."
                  optional
                  options={stateOptions}
                  selected={form.state_regions}
                  onToggle={(v) => toggle('state_regions', v)}
                />
              )}
              <ChipField
                label="Languages"
                hint="Languages the accountant should be fluent in. Pick all that apply."
                required
                options={LANGUAGES}
                selected={form.languages}
                onToggle={(v) => toggle('languages', v)}
              />
              <WorkingDaysSelector
                selected={form.working_days}
                onToggle={(v) => toggle('working_days', v)}
              />
            </Section>

            {/* Submit (sticky on mobile) */}
            <div className="connect-submit-wrap">
              <button
                type="submit"
                disabled={submitting}
                className="connect-submit"
              >
                {submitting ? 'Submitting…' : 'Submit'}
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
    <section className="rounded-2xl bg-white border border-[#E8E5DD] p-5 sm:p-6 shadow-sm">
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

// Mirrors the upsquad website's WorkingDaysSelector behaviour:
// Mon–Fri are the default 5-day week; Sat/Sun are explicitly optional.
// A warning surfaces once a weekend day is added on top of a full week
// (or any selection > 5 days), since both reduce the chance of talent
// accepting the brief.
const WORKING_DAYS = [
  { key: 'Mon', optional: false },
  { key: 'Tue', optional: false },
  { key: 'Wed', optional: false },
  { key: 'Thu', optional: false },
  { key: 'Fri', optional: false },
  { key: 'Sat', optional: true },
  { key: 'Sun', optional: true },
] as const;

function WorkingDaysSelector({
  selected, onToggle,
}: { selected: string[]; onToggle: (value: string) => void }) {
  const weekdaySet = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const weekendCount = selected.filter((d) => d === 'Sat' || d === 'Sun').length;
  const allWeekdaysSelected = weekdaySet.every((d) => selected.includes(d));
  const showWeekendWarning =
    weekendCount > 0 && (allWeekdaysSelected || selected.length > 5);

  return (
    <div>
      <label className="mb-1 flex items-baseline gap-2 text-sm font-medium text-[#222]">
        <span>Working Days<span className="text-[#C13515]">*</span></span>
      </label>
      <p className="mb-2 text-xs text-[#7A7568]">
        Days you need the accountant to be available — we'll match people whose schedule fits yours.
      </p>
      <p className="mb-3 text-xs text-[#7A7568]">
        Mon–Fri are included by default. Add{' '}
        <span className="font-semibold text-[#3A3A3A]">Sat</span> and/or{' '}
        <span className="font-semibold text-[#3A3A3A]">Sun</span> if you need weekend coverage
        {weekendCount > 0 && (
          <span className="text-[#5C5C5C]">
            {' '}— currently {weekendCount} weekend day{weekendCount > 1 ? 's' : ''} added
          </span>
        )}.
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
                <span className="mt-0.5 text-[9px] uppercase tracking-widest text-[#9C9486]">opt</span>
              )}
              {isOn && (
                <svg className="absolute top-1 right-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
      {showWeekendWarning && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#E0B7A2] bg-[#FBEFE9] p-3">
          <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#C97744]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-xs font-medium leading-relaxed text-[#8B3A1A]">
            Less chance of an accountant accepting the request if weekends are selected.
          </span>
        </div>
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

/* Submit lives at the natural end of the form on every viewport.
   Tried sticky and fixed earlier — both fight the Android soft keyboard
   and end up either covering the active input or floating mid-form.
   Letting it scroll with content is the only reliable behaviour. */
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

/* Per-role row inside the Requirement section. Lighter than the Step 1
   role card — it's a sub-block inside an existing Section, not its own
   highlighted card. Vertical gap between rows is handled by the parent
   Section's space-y-4. */
.connect-role-req {
  background: #FBFAF6;
  border: 1px solid #E8E5DD;
  border-radius: 12px;
  padding: 14px 16px;
}

/* Selected chips (states, languages) — brand lime soft fill, ink ring */
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

/* Selected working day cell — same brand lime treatment */
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
