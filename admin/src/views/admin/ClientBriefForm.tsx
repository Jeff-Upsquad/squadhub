'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import { STATES_BY_COUNTRY_NAME, LANGUAGE_OPTIONS } from './locationLanguageOptions';

// The internal-facing clone of the public /connect brief form — identical UI,
// layout, copy, and fields. The salesperson fills out exactly what the client
// would. Multi-select roles create one internal_brief card per role (mirroring
// /connect), each tagged source='internal_brief' + created_by via the admin
// endpoint. The slider picks which brief to open:
//   'creative'   → Designer / Editor / Designer + Editor   (/connect)
//   'accountant' → Accountant                              (/connect/accountant)
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

type RoleOption = { slug: string; title: string; service_type: string; description: string };

// Mirrors /connect's ROLE_OPTIONS. Multi-select; each maps to a canonical
// service_type label, and each selected role becomes its own card.
const ROLE_OPTIONS: RoleOption[] = [
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

const ACCOUNTANT_ROLE: RoleOption = {
  slug: 'accountant',
  title: 'Accountant',
  service_type: 'Accountants',
  description: 'Bookkeeping, GST, reconciliations, audits, payroll, and financial reporting.',
};

const COUNTRY_CODES = [
  { code: '+91', flag: '🇮🇳' }, { code: '+1', flag: '🇺🇸' }, { code: '+44', flag: '🇬🇧' },
  { code: '+971', flag: '🇦🇪' }, { code: '+65', flag: '🇸🇬' }, { code: '+61', flag: '🇦🇺' },
  { code: '+49', flag: '🇩🇪' }, { code: '+33', flag: '🇫🇷' }, { code: '+81', flag: '🇯🇵' }, { code: '+86', flag: '🇨🇳' },
];

const DEFAULT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));

// Build-your-own-subscription workflow (mirrors upsquadconnect.com/pricing):
// experience level(s) → plan → budget. Display labels are plural; stored
// values match subscription_cards.target_tiers' CHECK (Junior/Pro/Top Talents).
const EXPERIENCE_LEVELS: { label: string; value: string }[] = [
  { label: 'Juniors', value: 'Junior' },
  { label: 'Pros', value: 'Pro' },
  { label: 'Top Talents', value: 'Top Talents' },
];

// Plans differ by availability (Mon–Fri) — the same five bands seeded for
// every subscription/tier (subscription_plans). Stored as plan_name on the
// card. Numeric hours drive the compact picker; the pct/capacity/perDay/
// perWeek/bestFor labels drive the full "Compare plans" modal (mirrors the
// pricing-page comparison table).
const PLAN_OPTIONS: {
  name: string;
  dailyHours: number;
  weeklyHours: number;
  monthlyHours: number;
  pct: string;
  capacity: string;
  perDay: string;
  perWeek: string;
  bestFor: string;
  tagline: string;
  recommended?: boolean;
}[] = [
  { name: 'Starter', dailyHours: 1, weeklyHours: 5, monthlyHours: 20, pct: '10%', capacity: 'Light-touch creative support', perDay: '~1 hour per day', perWeek: '~5 hours per week', bestFor: 'Small brands & startups', tagline: 'For brands that are starting out.' },
  { name: 'Basic', dailyHours: 2, weeklyHours: 10, monthlyHours: 40, pct: '25%', capacity: 'Quarter of a full-time employee', perDay: '2–3 hours per day', perWeek: '10 hours per week', bestFor: 'Active brands', tagline: 'Our standard and most affordable plan.' },
  { name: 'Plus', dailyHours: 4, weeklyHours: 20, monthlyHours: 80, pct: '50%', capacity: 'Half employee capacity', perDay: '4–5 hours per day', perWeek: '20 hours per week', bestFor: 'High-volume teams & agencies', tagline: 'Get your tasks completed faster with elevated priority.', recommended: true },
  { name: 'Pro', dailyHours: 6, weeklyHours: 30, monthlyHours: 120, pct: '80%', capacity: 'Nearly full-time employee', perDay: '6–7 hours per day', perWeek: '30 hours per week', bestFor: 'Growing businesses', tagline: 'Highest speed and fastest response time.' },
  { name: 'Personal', dailyHours: 8, weeklyHours: 40, monthlyHours: 160, pct: '100%', capacity: 'Dedicated full-time equivalent', perDay: '~8 hours per day', perWeek: '~40 hours per week', bestFor: 'Founders & creators wanting close collaboration', tagline: 'Your own personal designer, like an in-house partner.' },
];

const AVAILABILITY_INFO = 'Availability shows the number of hours your selected talent will be available on a per-day and per-week basis.';

// The "Access to Our Platform" cell — identical across all plans.
const ACCESS_CELL = (
  <span className="text-[12px] leading-snug text-[#3A3A3A]">
    <span className="font-semibold text-[#0a0a0a]">One user:</span> free access
    <br />
    <span className="font-semibold text-[#0a0a0a]">Additional user:</span> ₹500 per month
  </span>
);

// Feature rows for the "Compare plans" modal, in PLAN_OPTIONS order. Booleans
// render as ✓ / ✕; strings/nodes render as-is. `info` adds an ⓘ tooltip on the
// row label. Copy mirrors upsquadconnect.com/pricing verbatim. (Availability +
// Best For rows are derived from PLAN_OPTIONS.)
const PLAN_FEATURES: { label: string; values: React.ReactNode[]; info?: string }[] = [
  { label: 'Unlimited work requests', values: [true, true, true, true, true], info: 'Unlimited work request means you can place as many design or video edit requests with us. We will deliver them one by one based on your applicable plan.' },
  { label: 'Squad Manager', values: [true, true, true, true, true], info: 'You will also be given a resource called Squad Manager, who will help you manage all the works. Coordinate works with designers and editors, and ensure delivery on time.' },
  { label: 'Urgent Works', values: [false, false, true, true, true], info: 'For starter, basic, and plus plan. We do not entertain urgent work meaning placing request today and expecting delivery today itself. If our designers or editors are available, we will try to accommodate it, but it is not guaranteed.' },
  { label: 'Access to Our Platform', values: [ACCESS_CELL, ACCESS_CELL, ACCESS_CELL, ACCESS_CELL, ACCESS_CELL], info: 'We use our own platform called SquadHub to manage all the work. You will be able to view the work submitted, progress, chat, and interact with the designers and editors through this.' },
  { label: 'Meetings', values: ['By request', 'By request', 'By request', 'By request', 'Instant call + meeting access'], info: 'If you want to take a meeting with the designers or editors, you need to schedule it. Instant meetings are not available. Instant meeting is only available in personal plan.' },
  { label: 'Live Collaboration', values: ['No', 'No', 'No', 'No', 'Yes — screen share & live edits'] },
  { label: 'Shared Resource', values: ['Shared', 'Shared', 'Shared', 'Shared (High Priority)', 'Personal (exclusive)'] },
];

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
};

const initialForm: FormData = {
  brand_name: '', business_nature: '', business_note: '',
  contact_name: '', email: '', country_code: '+91', phone: '',
  business_location: '', country_id: '', state_regions: [],
  languages: [], working_days: DEFAULT_DAYS,
};

type RoleReq = { note: string; tiers: string[]; plan: string; budget: string };
const EMPTY_REQ: RoleReq = { note: '', tiers: [], plan: '', budget: '' };

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
  // Creative starts on the role step; accountant has a single fixed role.
  const [step, setStep] = useState<1 | 2>(type === 'accountant' ? 2 : 1);
  const [roles, setRoles] = useState<string[]>([]);
  const [roleReqs, setRoleReqs] = useState<Record<string, RoleReq>>({});
  // Slug of the role whose "Compare plans" modal is open (null = closed).
  const [comparePlanRole, setComparePlanRole] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(initialForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
  const languageOptions = useMemo(() => uniq([...LANGUAGE_OPTIONS, ...form.languages]), [form.languages]);
  // ₹ for India (default), $ for the other countries we serve.
  const currencySymbol = selectedCountryName && selectedCountryName !== 'India' ? '$' : '₹';

  // Roles whose requirement cards + cards get created. Accountant is the single
  // fixed role; creative is whatever was ticked on step 1.
  const selectedRoles: RoleOption[] =
    type === 'accountant' ? [ACCOUNTANT_ROLE] : ROLE_OPTIONS.filter((r) => roles.includes(r.slug));

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
  function toggleRole(slug: string) {
    setRoles((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
  }
  function getReq(slug: string): RoleReq {
    return roleReqs[slug] || EMPTY_REQ;
  }
  function setReq(slug: string, key: 'note' | 'plan' | 'budget', value: string) {
    setRoleReqs((prev) => ({ ...prev, [slug]: { ...(prev[slug] || EMPTY_REQ), [key]: value } }));
  }
  function toggleReqTier(slug: string, value: string) {
    setRoleReqs((prev) => {
      const cur = prev[slug] || EMPTY_REQ;
      const tiers = cur.tiers.includes(value)
        ? cur.tiers.filter((t) => t !== value)
        : [...cur.tiers, value];
      return { ...prev, [slug]: { ...cur, tiers } };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
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

    const shared = {
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
    };

    setSubmitting(true);
    try {
      // One card per selected role — mirrors /connect creating a card per service_type.
      await Promise.all(
        selectedRoles.map((r) => {
          const req = getReq(r.slug);
          const budgetNum = req.budget.trim() ? Math.round(Number(req.budget)) : NaN;
          return api.post('/admin/subscription-cards/client-brief', {
            ...shared,
            service_type: r.service_type,
            requirement_note: req.note.trim() || undefined,
            target_tiers: req.tiers.length ? req.tiers : undefined,
            plan_name: req.plan || undefined,
            proposed_price:
              Number.isFinite(budgetNum) && budgetNum >= 0 ? budgetNum : undefined,
          });
        }),
      );
      const n = selectedRoles.length;
      showToast(`${n} client brief${n > 1 ? 's' : ''} created — find ${n > 1 ? 'them' : 'it'} in New Deals`, 'success');
      qc.invalidateQueries({ queryKey: ['admin-internal-brief-submissions'] });
      qc.invalidateQueries({ queryKey: ['admin-published-cards'] });
      onCreated();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err.message || 'Failed to create brief';
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
          Back to Published Cards
        </button>

        <header className="mb-6 text-center sm:mb-8">
          <h1 className="text-[24px] font-semibold tracking-tight text-foreground sm:text-[28px]">
            Tell us about your brand
          </h1>
          <p className="mt-1.5 text-sm text-foreground-muted sm:text-base">
            A few quick details so we can match you with the right talent.
          </p>
        </header>

        {step === 1 && type === 'creative' && (
          <section className="flex flex-col items-center">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-foreground-muted">
              What do you need?
            </h2>
            <p className="mb-2 max-w-md text-center text-sm text-foreground-muted">
              Designers create static visuals, Editors craft motion and video, or pick a hybrid who does both.
            </p>
            <p className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-ink bg-[#F2FCBC] px-3 py-1 text-xs font-semibold text-foreground">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              You can pick one or more
            </p>

            <div className="mb-2 inline-flex flex-wrap justify-center gap-2">
              {ROLE_OPTIONS.map((opt) => {
                const on = roles.includes(opt.slug);
                return (
                  <button
                    key={opt.slug}
                    type="button"
                    onClick={() => toggleRole(opt.slug)}
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

            {roles.length === 0 ? (
              <p className="mt-4 text-sm font-medium text-[#C97744]">Pick at least one to continue.</p>
            ) : (
              <div className="mt-4 w-full max-w-md space-y-2">
                {ROLE_OPTIONS.filter((o) => roles.includes(o.slug)).map((opt) => (
                  <div key={opt.slug} className="connect-role-card">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#FCF487] ring-1 ring-ink" />
                      <span className="text-sm font-bold text-foreground">{opt.title}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-foreground-muted">{opt.description}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 w-full max-w-md">
              <button
                type="button"
                onClick={() => setStep(2)}
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
              onClick={() => (type === 'accountant' ? onClose() : setStep(1))}
              className="-ml-1 mb-2 flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>

            {error && (
              <div className="rounded-lg border border-[#E0B7A2] bg-[#FBEFE9] px-4 py-3 text-sm text-[#8B3A1A]">
                {error}
              </div>
            )}

            <Section
              eyebrow="Customer"
              title="Your contact"
              hint="How we'll reach you to confirm and schedule the kickoff call."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Email" required>
                  <input
                    type="email"
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
              title="About your brand"
              hint="Helps creators understand your space and pitch ideas that fit."
            >
              <Field label="Brand Name" required>
                <input
                  type="text"
                  value={form.brand_name}
                  onChange={(e) => update('brand_name', e.target.value)}
                  placeholder="Your brand name"
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

            <Section
              eyebrow="Subscription"
              title="Experience level & plan"
              hint="Pick the talent experience and a weekly plan per role, add a short note, and name a monthly budget. All optional — we can finalize on the call."
            >
              {selectedRoles.map((opt) => {
                const req = getReq(opt.slug);
                return (
                  <div key={opt.slug} className="connect-role-req overflow-hidden">
                    <div className="-mx-4 -mt-3.5 mb-4 flex items-center gap-2.5 border-b border-[#E0DCCE] bg-[#F2FCBC] px-4 py-3">
                      <span className="h-3.5 w-3.5 rounded-full bg-[#FCF487] ring-1 ring-ink" />
                      <span className="text-lg font-bold tracking-tight text-foreground">{opt.title}</span>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="mb-1 flex items-baseline gap-2 text-sm font-medium text-foreground">
                          <span>Experience level(s)</span>
                          <span className="text-xs font-normal text-foreground-muted">(optional)</span>
                        </label>
                        <p className="mb-3 text-xs text-foreground-muted">
                          Select one or more — we&apos;ll match talent across all chosen levels.
                        </p>
                        <div className="flex flex-wrap gap-1.5 sm:gap-2">
                          {EXPERIENCE_LEVELS.map((lvl) => {
                            const on = req.tiers.includes(lvl.value);
                            return (
                              <button
                                key={lvl.value}
                                type="button"
                                onClick={() => toggleReqTier(opt.slug, lvl.value)}
                                aria-pressed={on}
                                className={`connect-chip ${on ? 'connect-chip-on' : ''}`}
                              >
                                {on ? `✓ ${lvl.label}` : lvl.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <label className="flex items-baseline gap-2 text-sm font-medium text-foreground">
                            <span>Plan</span>
                            <span className="text-xs font-normal text-foreground-muted">(optional)</span>
                          </label>
                          {req.tiers.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setComparePlanRole(opt.slug)}
                              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[#0a0a0a] bg-[#F2FCBC] px-3 py-1.5 text-xs font-bold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a] transition hover:bg-[#FCF487] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_0_#0a0a0a]"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <rect x="3" y="4" width="18" height="16" rx="1.5" />
                                <path d="M9 4v16M15 4v16" />
                              </svg>
                              Compare all plans
                            </button>
                          )}
                        </div>
                        <p className="mb-3 text-xs text-foreground-muted">
                          Plans differ by availability — how much of a creative partner you get each week.
                        </p>
                        {req.tiers.length === 0 ? (
                          <p className="text-sm font-medium text-[#C97744]">
                            Pick an experience level to see plan options.
                          </p>
                        ) : (
                          <div className="overflow-hidden rounded-xl border border-[#D9D5C7]">
                            <table className="w-full border-collapse text-left text-sm">
                              <thead>
                                <tr className="bg-[#F4F1E8] text-[11px] font-semibold uppercase tracking-wide text-[#7A7568]">
                                  <th className="px-2 py-2 sm:px-3">Plan</th>
                                  <th className="px-2 py-2 text-right sm:px-3">Day</th>
                                  <th className="px-2 py-2 text-right sm:px-3">Week</th>
                                  <th className="px-2 py-2 text-right sm:px-3">Month</th>
                                </tr>
                              </thead>
                              <tbody>
                                {PLAN_OPTIONS.map((p) => {
                                  const on = req.plan === p.name;
                                  return (
                                    <tr
                                      key={p.name}
                                      role="button"
                                      aria-pressed={on}
                                      onClick={() => setReq(opt.slug, 'plan', on ? '' : p.name)}
                                      className={`cursor-pointer border-t border-[#E8E5DD] transition ${on ? 'bg-[#F2FCBC]' : 'bg-white hover:bg-[#FBFAF6]'}`}
                                    >
                                      <td className="px-2 py-2.5 font-semibold text-[#0a0a0a] sm:px-3">
                                        <span className="flex items-center gap-2">
                                          <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${on ? 'border-[#0a0a0a] bg-[#FCF487]' : 'border-[#C9C4B5]'}`}>
                                            {on && (
                                              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                              </svg>
                                            )}
                                          </span>
                                          {p.name}
                                        </span>
                                      </td>
                                      <td className="px-2 py-2.5 text-right text-[#3A3A3A] sm:px-3">{p.dailyHours} hr{p.dailyHours > 1 ? 's' : ''}</td>
                                      <td className="px-2 py-2.5 text-right text-[#3A3A3A] sm:px-3">{p.weeklyHours} hrs</td>
                                      <td className="px-2 py-2.5 text-right text-[#3A3A3A] sm:px-3">{p.monthlyHours} hrs</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      <Field
                        label="Monthly budget"
                        optional
                        hint={`Your target monthly spend in ${currencySymbol}.`}
                      >
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={req.budget}
                          onChange={(e) => setReq(opt.slug, 'budget', e.target.value)}
                          placeholder={`e.g. ${currencySymbol}25000`}
                          className="connect-input"
                        />
                      </Field>

                      <Field label="Short note" optional>
                        <textarea
                          rows={2}
                          value={req.note}
                          onChange={(e) => setReq(opt.slug, 'note', e.target.value)}
                          placeholder="Explain the kind of work you're looking to get done."
                          className="connect-input resize-none"
                        />
                      </Field>
                    </div>
                  </div>
                );
              })}
            </Section>

            <Section
              eyebrow="Talent preferences"
              title="Who you'd like to work with"
              hint="Where the talent should be based, what they should speak, and when they should work."
            >
              <Field label="Country" required hint="India is the default. Pick a different country if your talent should be elsewhere.">
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
              <button type="submit" disabled={submitting} className="connect-submit">
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </form>
        )}
      </div>

      {comparePlanRole && (() => {
        const role = selectedRoles.find((r) => r.slug === comparePlanRole);
        if (!role) return null;
        return (
          <PlanCompareModal
            roleTitle={role.title}
            selectedPlan={getReq(role.slug).plan}
            onSelect={(name) => setReq(role.slug, 'plan', name)}
            onClose={() => setComparePlanRole(null)}
          />
        );
      })()}

      <style jsx global>{globalStyles}</style>
    </div>
  );
}

// Small ⓘ with a hover/focus tooltip, used on comparison-table row labels.
function InfoTip({ text }: { text: string }) {
  return (
    <span className="group/info relative ml-1 inline-flex align-middle">
      <button
        type="button"
        aria-label={text}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#C9C4B5] text-[10px] font-bold leading-none text-[#7A7568] transition hover:border-[#0a0a0a] hover:text-[#0a0a0a]"
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-30 mt-2 w-52 whitespace-normal rounded-lg bg-[#0a0a0a] px-3 py-2 text-left text-[11px] font-normal normal-case leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/info:opacity-100 group-focus-within/info:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

// Full plan comparison (mirrors the pricing page table) shown in a modal.
// Selecting a plan here sets the same plan_name the compact picker uses.
function PlanCompareModal({
  roleTitle, selectedPlan, onSelect, onClose,
}: {
  roleTitle: string;
  selectedPlan: string;
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Plan-column cell styling: lime border for the recommended plan, soft tint
  // for the currently-selected plan.
  const colCls = (p: (typeof PLAN_OPTIONS)[number], extra = '') =>
    `${p.recommended ? 'border-x-2 border-[#C6F24E]' : ''} ${selectedPlan === p.name ? 'bg-[#FCFBE8]' : 'bg-white'} ${extra}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border-2 border-[#0a0a0a] bg-white shadow-[6px_6px_0_0_rgba(10,10,10,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E8E5DD] px-5 py-3.5">
          <div>
            <h3 className="text-base font-bold text-[#0a0a0a]">Compare plans</h3>
            <p className="text-xs text-[#7A7568]">{roleTitle} · pick the weekly availability that fits</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-2xl leading-none text-[#5C5C5C] transition hover:bg-[#F4F1E8] hover:text-[#0a0a0a]"
          >
            ×
          </button>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-white px-4 py-4" />
                {PLAN_OPTIONS.map((p) => (
                  <th key={p.name} className={colCls(p, `px-4 pb-4 pt-5 text-center align-top ${p.recommended ? 'border-t-2' : ''}`)}>
                    {p.recommended && (
                      <span className="mb-2 inline-block rounded-full border border-[#0a0a0a] bg-[#C6F24E] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0a0a0a]">
                        Most popular
                      </span>
                    )}
                    <div className="text-base font-extrabold text-[#0a0a0a]">{p.name}</div>
                    <p className="mx-auto mt-1 max-w-[150px] text-[11px] font-normal leading-snug text-[#7A7568]">{p.tagline}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[#EFECE3]">
                <td className="sticky left-0 z-20 bg-white px-4 py-4 align-top font-semibold text-[#3A3A3A] hover:z-40">
                  <span className="inline-flex items-center whitespace-nowrap">Availability<InfoTip text={AVAILABILITY_INFO} /></span>
                </td>
                {PLAN_OPTIONS.map((p) => (
                  <td key={p.name} className={colCls(p, 'px-4 py-4 text-center align-top')}>
                    <div className="text-2xl font-extrabold leading-none text-[#0a0a0a]">{p.pct}</div>
                    <div className="mt-1.5 text-[11px] leading-tight text-[#7A7568]">{p.capacity}</div>
                    <div className="mt-1.5 text-[11px] text-[#3A3A3A]">{p.perDay}</div>
                    <div className="text-[11px] italic text-[#7A7568]">{p.perWeek}</div>
                  </td>
                ))}
              </tr>
              {PLAN_FEATURES.map((row) => (
                <tr key={row.label} className="border-t border-[#EFECE3]">
                  <td className="sticky left-0 z-20 bg-white px-4 py-3 font-medium text-[#3A3A3A] hover:z-40">
                    <span className="inline-flex items-center">{row.label}{row.info && <InfoTip text={row.info} />}</span>
                  </td>
                  {row.values.map((v, i) => (
                    <td key={i} className={colCls(PLAN_OPTIONS[i], 'px-4 py-3 text-center align-middle')}>
                      {typeof v === 'boolean' ? (
                        v ? (
                          <svg className="mx-auto h-4 w-4 text-[#1FA85A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="mx-auto h-4 w-4 text-[#D1573B]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )
                      ) : typeof v === 'string' ? (
                        <span className="text-[12px] leading-tight text-[#3A3A3A]">{v}</span>
                      ) : (
                        v
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-[#EFECE3]">
                <td className="sticky left-0 z-20 bg-white px-4 py-3 font-medium text-[#3A3A3A]">Best For</td>
                {PLAN_OPTIONS.map((p) => (
                  <td key={p.name} className={colCls(p, 'px-4 py-3 text-center align-middle')}>
                    <span className="text-[12px] leading-tight text-[#3A3A3A]">{p.bestFor}</span>
                  </td>
                ))}
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t border-[#EFECE3]">
                <td className="sticky left-0 z-20 bg-white px-4 py-4" />
                {PLAN_OPTIONS.map((p) => {
                  const on = selectedPlan === p.name;
                  return (
                    <td key={p.name} className={colCls(p, `px-3 py-4 text-center ${p.recommended ? 'border-b-2' : ''}`)}>
                      <button
                        type="button"
                        onClick={() => onSelect(p.name)}
                        aria-pressed={on}
                        className={`w-full rounded-lg border-2 border-[#0a0a0a] px-2 py-2 text-xs font-bold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a] transition active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0_0_#0a0a0a] ${on ? 'bg-[#C6F24E]' : 'bg-white hover:bg-[#F2FCBC]'}`}
                      >
                        {on ? 'Selected ✓' : 'Select Plan'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
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
      <p className="mb-2 text-xs text-foreground-muted">
        Days you need the talent to be available — we&apos;ll match people whose schedule fits yours.
      </p>
      <p className="mb-3 text-xs text-foreground-muted">
        Mon–Fri are included by default. Add{' '}
        <span className="font-semibold text-foreground">Sat</span> and/or{' '}
        <span className="font-semibold text-foreground">Sun</span> if you need weekend coverage.
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
          Less chance of talent accepting the request if weekends are selected.
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
