'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

// Web has no shared component lib by design — these constants/components mirror
// the /connect brief form so a shared link looks identical to the form the
// client would otherwise fill from scratch.
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

// Phone is stored as "+91 9447402340". Split by longest-matching prefix; +91 fallback.
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

function expiryLabel(iso?: string): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expiring soon';
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h >= 1 ? `in ${h}h ${m}m` : `in ${m}m`;
}

const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));

// Mirrors the /connect brief form's subscription section. Display labels are
// plural; stored values match subscription_cards.target_tiers' CHECK.
// Descriptions mirror the UpSquad landing page so the client knows what each
// level means before choosing.
// Same five availability bands as /connect; stored as plan_name on the card.
const PLAN_OPTIONS: { name: string; dailyHours: number; weeklyHours: number; monthlyHours: number }[] = [
  { name: 'Starter', dailyHours: 1, weeklyHours: 5, monthlyHours: 20 },
  { name: 'Basic', dailyHours: 2, weeklyHours: 10, monthlyHours: 40 },
  { name: 'Plus', dailyHours: 4, weeklyHours: 20, monthlyHours: 80 },
  { name: 'Pro', dailyHours: 6, weeklyHours: 30, monthlyHours: 120 },
  { name: 'Personal', dailyHours: 8, weeklyHours: 40, monthlyHours: 160 },
];

type Prefill = {
  brand_name: string | null;
  business_nature: string | null;
  business_note: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  business_location: string | null;
  service_type: string | null;
  working_days: string[];
  languages: string[];
  country_id: string | null;
  state_regions: string[];
  requirement_note: string | null;
  hours_note: string | null;
  plan_name: string | null;
  tiers: string[];
  // Per-tier monthly budget (the client's proposed price for that level),
  // keyed by tier value. Empty when no pricing was captured yet.
  tier_budgets: Record<string, number>;
};

type LinkMeta = {
  valid: boolean;
  expired: boolean;
  completed: boolean;
  expires_at?: string;
  prefill?: Prefill;
};

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
  tiers: string[];
  plan: string;
  // Single monthly budget for the chosen plan (as the client types it).
  budget: string;
  // Per-tier budget as the client types it, keyed by tier value. Retained for
  // prefill back-compat; the UI now captures one budget for the whole plan.
  tierBudgets: Record<string, string>;
};

const DEFAULT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const emptyForm: FormData = {
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
  working_days: [],
  requirement_note: '',
  hours_note: '',
  tiers: [],
  plan: '',
  budget: '',
  tierBudgets: {},
};

export default function CardShareTokenPage() {
  const params = useParams();
  const token = (params?.token as string) || '';

  const [linkMeta, setLinkMeta] = useState<LinkMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [countries, setCountries] = useState<Country[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  // Optional requirement voice note (uploaded to R2 on submit).
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    if (!token) {
      setMetaLoading(false);
      setLinkMeta({ valid: false, expired: false, completed: false });
      return;
    }
    fetch(`/leads/card-link/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data) {
          setLinkMeta(data.data);
          const pf: Prefill | undefined = data.data.prefill;
          if (data.data.valid && pf) {
            const phone = splitPhone(pf.phone);
            setForm({
              brand_name: pf.brand_name || '',
              business_nature: pf.business_nature || '',
              business_note: pf.business_note || '',
              contact_name: pf.contact_name || '',
              email: pf.email || '',
              country_code: phone.code,
              phone: phone.number,
              business_location: pf.business_location || '',
              country_id: pf.country_id || '',
              state_regions: pf.state_regions || [],
              languages: pf.languages || [],
              working_days: pf.working_days?.length ? pf.working_days : DEFAULT_DAYS,
              requirement_note: pf.requirement_note || '',
              hours_note: pf.hours_note || '',
              tiers: pf.tiers || [],
              plan: pf.plan_name || '',
              // Collapse any prefilled per-tier budgets to one plan budget.
              budget: (() => {
                const vals = Object.values(pf.tier_budgets || {}).filter((v) => v > 0);
                return vals.length ? String(vals[0]) : '';
              })(),
              tierBudgets: Object.fromEntries(
                Object.entries(pf.tier_budgets || {}).map(([t, v]) => [t, String(v)]),
              ),
            });
          }
        } else {
          setLinkMeta({ valid: false, expired: false, completed: false });
        }
      })
      .catch(() => setLinkMeta({ valid: false, expired: false, completed: false }))
      .finally(() => setMetaLoading(false));
  }, [token]);

  useEffect(() => {
    fetch('/clients/countries')
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.data)) setCountries(data.data);
      })
      .catch(() => {/* non-fatal */});
  }, []);

  const selectedCountryName = useMemo(
    () => countries.find((c) => c.id === form.country_id)?.name || '',
    [countries, form.country_id],
  );
  const regionOptions = useMemo(
    () => uniq([...(STATES_BY_COUNTRY_NAME[selectedCountryName] || []), ...form.state_regions]),
    [selectedCountryName, form.state_regions],
  );
  const languageOptions = useMemo(() => uniq([...LANGUAGES, ...form.languages]), [form.languages]);

  function update<K extends keyof FormData>(field: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function changeCountry(newId: string) {
    // Regions are country-specific — clear them when the country changes.
    setForm((prev) => ({ ...prev, country_id: newId, state_regions: [] }));
  }

  function toggle(field: 'state_regions' | 'languages' | 'working_days' | 'tiers', value: string) {
    setForm((prev) => {
      const set = new Set(prev[field]);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      return { ...prev, [field]: Array.from(set) };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // Requirement is mandatory — a voice note OR a typed note (either is fine).
    if (!audioBlobRef.current && !form.requirement_note.trim()) {
      setError('Please describe your requirement — record a voice note or type it in.');
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

    setSubmitting(true);
    try {
      // Upload the voice note first (if any) so its URL rides with the brief.
      let requirementVoiceUrl = '';
      if (audioBlobRef.current) {
        try { requirementVoiceUrl = await uploadVoiceNote(audioBlobRef.current); } catch { /* non-fatal */ }
      }
      // Every brief now targets all experience tiers; the single plan budget is
      // replicated across them for the backend's per-tier pricing.
      const allTiers = ['Junior', 'Pro', 'Top Talents'];
      const bn = form.budget.trim() ? Math.round(Number(form.budget)) : NaN;
      const budget = Number.isFinite(bn) && bn > 0 ? bn : undefined;
      const tierBudgets: Record<string, number> = {};
      if (budget !== undefined) for (const t of allTiers) tierBudgets[t] = budget;

      const res = await fetch(`/leads/card-link/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_name: form.brand_name.trim(),
          business_nature: form.business_nature.trim(),
          business_note: form.business_note.trim(),
          contact_name: form.contact_name.trim(),
          email: form.email.trim(),
          phone: `${form.country_code} ${form.phone.trim()}`.trim(),
          business_location: form.business_location.trim() || undefined,
          // Location is optional — omit country when "Anywhere" is chosen.
          ...(form.country_id ? { country_id: form.country_id } : {}),
          state_regions: form.country_id ? form.state_regions : [],
          languages: form.languages,
          working_days: form.working_days,
          requirement_note: form.requirement_note.trim() || undefined,
          ...(requirementVoiceUrl ? { requirement_voice_url: requirementVoiceUrl } : {}),
          hours_note: form.hours_note.trim() || undefined,
          tiers: allTiers,
          plan: form.plan || undefined,
          tier_budgets: tierBudgets,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      setSubmitted(true);
    } catch {
      setError('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (metaLoading) {
    return (
      <div className="connect-bg flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-[#7A7568]">Loading…</p>
        <style jsx global>{globalStyles}</style>
      </div>
    );
  }

  if (!linkMeta || !linkMeta.valid) {
    const heading = linkMeta?.completed
      ? 'Already submitted'
      : linkMeta?.expired
      ? 'Link expired'
      : 'Link unavailable';
    const reason = linkMeta?.completed
      ? 'This brief has already been submitted. Thank you! If you need to make changes, ask your contact for a fresh link.'
      : linkMeta?.expired
      ? 'This link has expired. Please ask your contact to send you a new one.'
      : 'This link is invalid or is no longer available. Please ask your contact for a new link.';
    return (
      <div className="connect-bg flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-[#E8E5DD] bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-[#222]">{heading}</h1>
          <p className="mt-2 text-sm text-[#5C5C5C]">{reason}</p>
        </div>
        <style jsx global>{globalStyles}</style>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="connect-bg flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-[#E8E5DD] bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#F2FCBC]">
            <svg className="h-8 w-8 text-[#0a0a0a]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-[#222]">Thank you!</h1>
          <p className="mt-2 text-sm text-[#5C5C5C]">
            Your details have been submitted. Our team will review them and get back to you soon.
          </p>
        </div>
        <style jsx global>{globalStyles}</style>
      </div>
    );
  }

  return (
    <div className="connect-bg min-h-screen px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 text-center">
          <h1 className="text-[26px] font-semibold text-[#222]">UpSquad</h1>
          <p className="mt-1 text-base text-[#5C5C5C]">Confirm your brief</p>
          {linkMeta.expires_at && (
            <p className="mt-1 text-xs text-[#9C9486]">This link expires {expiryLabel(linkMeta.expires_at)}.</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="rounded-lg border border-[#E0B7A2] bg-[#FBEFE9] px-4 py-3 text-sm font-medium text-[#8B3A1A]">
              {error}
            </div>
          )}

          {/* Selected category — always on top. */}
          <div className="connect-category-banner">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7A7568]">Category</p>
              <div className="mt-1.5">
                <span className="connect-category-chip">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {linkMeta.prefill?.service_type || 'Your brief'}
                </span>
              </div>
            </div>
          </div>

          {/* ── GROUP 1: Business details ─────────────────────────────── */}
          <GroupHeader index={1} title="Business details" subtitle="Confirm who you are and how we reach you." />

          <Section eyebrow="About you" title="Your details" hint="Confirm how we should reach you.">
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
            <Field label="Email" required hint="We'll use this to set up your account.">
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

          <Section eyebrow="Your brand" title="About your brand" hint="Review what we have — edit anything that's off.">
            <Field label="Brand / business name" required>
              <input
                type="text"
                required
                value={form.brand_name}
                onChange={(e) => update('brand_name', e.target.value)}
                placeholder="Your brand or business name"
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
            <Field label="What do you need?" required hint="A short brief of the work.">
              <textarea
                required
                rows={3}
                value={form.business_note}
                onChange={(e) => update('business_note', e.target.value)}
                placeholder="Describe the work you need help with"
                className="connect-input resize-none"
              />
            </Field>
            <Field label="Business location" required hint="Where your business is based — city and area.">
              <input
                type="text"
                required
                value={form.business_location}
                onChange={(e) => update('business_location', e.target.value)}
                placeholder="City / area"
                className="connect-input"
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

          {/* ── GROUP 2: Requirement details ──────────────────────────── */}
          <GroupHeader index={2} title="Requirement details" subtitle="What you need, your budget, and who you'd like to work with." />

          <Section
            eyebrow="Requirement"
            title="Describe your requirement"
            hint="Required — add at least one: record a voice note or type it out (or both). Your matched talent can listen to the voice note in their app."
          >
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 flex items-baseline gap-2 text-sm font-medium text-[#222]">
                  <span>Voice note</span>
                  <span className="text-xs font-normal text-[#9C9486]">(optional)</span>
                </label>
                <AudioNote
                  audioUrl={audioUrl}
                  onChange={(blob, url) => { audioBlobRef.current = blob; setAudioUrl(url); }}
                />
              </div>
              <Field label="Requirement note" optional hint="Tools, style, deliverables, references — anything specific the talent should know.">
                <textarea
                  rows={3}
                  value={form.requirement_note}
                  onChange={(e) => update('requirement_note', e.target.value)}
                  placeholder="Describe the work you need help with"
                  className="connect-input resize-none"
                />
              </Field>
            </div>
          </Section>

          <Section
            eyebrow="Subscription"
            title="Plan & budget"
            hint="Confirm the weekly plan and your monthly budget. We'll match talent across all experience levels."
          >
            <div>
              <label className="mb-1 flex items-baseline gap-2 text-sm font-medium text-[#222]">
                <span>Plan</span>
                <span className="text-xs font-normal text-[#9C9486]">(optional)</span>
              </label>
              <p className="mb-3 text-xs text-[#7A7568]">
                Plans differ by availability — how much of a creative partner you get each week.
              </p>
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
                      const on = form.plan === p.name;
                      return (
                        <tr
                          key={p.name}
                          role="button"
                          aria-pressed={on}
                          onClick={() => update('plan', on ? '' : p.name)}
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
            </div>

            <Field
              label={form.plan ? `Monthly budget for the ${form.plan} plan` : 'Monthly budget'}
              optional
              hint={
                form.plan
                  ? `What you're willing to pay per month for the ${form.plan} plan. We'll match talent across all experience levels.`
                  : 'Pick a plan above, then tell us your monthly budget. We’ll match talent across all experience levels.'
              }
            >
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={form.budget}
                onChange={(e) => update('budget', e.target.value)}
                placeholder="e.g. ₹25000"
                className="connect-input"
              />
            </Field>
          </Section>

          <Section eyebrow="Preferences" title="Talent preferences" hint="Where the talent should be, languages, and working days.">
            {/* Location targeting is opt-in and grouped. Empty = anywhere. */}
            <div className="rounded-xl border border-[#E0DCCE] bg-[#FBFAF6] p-4">
              <div className="mb-1 flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-[#0a0a0a]">Preferred location</h3>
                <span className="text-xs font-normal text-[#9C9486]">(optional)</span>
              </div>
              <p className="mb-4 text-xs leading-relaxed text-[#7A7568]">
                Want talent based in a specific place? Pick a country and state.
                Prefer no location constraint? Leave them empty — we&apos;ll match great talent anywhere.
              </p>
              <div className="space-y-4">
                <Field label="Country">
                  <select
                    value={form.country_id}
                    onChange={(e) => changeCountry(e.target.value)}
                    className="connect-input"
                  >
                    <option value="">Anywhere (no preference)</option>
                    {countries.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </Field>

                {regionOptions.length > 0 && (
                  <ChipField
                    label="States / regions"
                    hint="Narrow to specific states, or leave empty for the whole country."
                    options={regionOptions}
                    selected={form.state_regions}
                    onToggle={(v) => toggle('state_regions', v)}
                  />
                )}
              </div>
            </div>

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

// Upload a recorded voice note to R2 via the public presigned-URL endpoint.
async function uploadVoiceNote(blob: Blob): Promise<string> {
  const contentType = blob.type || 'audio/webm';
  const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('ogg') ? 'ogg' : 'webm';
  const presign = await fetch('/leads/voice-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: `voice-note.${ext}`, content_type: contentType }),
  });
  const pj = await presign.json();
  if (!pj?.success || !pj.data?.upload_url) throw new Error('presign failed');
  const put = await fetch(pj.data.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
  });
  if (!put.ok) throw new Error('upload failed');
  return pj.data.public_url as string;
}

function GroupHeader({ index, title, subtitle }: { index: number; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 pt-3">
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 border-[#0a0a0a] bg-[#FCF487] text-sm font-extrabold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a]">
        {index}
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-bold tracking-tight text-[#0a0a0a]">{title}</h2>
        <p className="text-xs text-[#7A7568]">{subtitle}</p>
      </div>
    </div>
  );
}

// Record / play / re-record a short voice note using the browser MediaRecorder.
function AudioNote({
  audioUrl, onChange,
}: {
  audioUrl: string | null;
  onChange: (blob: Blob | null, url: string | null) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  async function start() {
    setErr('');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setErr('Recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        onChange(blob, URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch {
      setErr('Microphone access was blocked. Allow it and try again.');
    }
  }
  function stop() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
  }
  function clear() {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    onChange(null, null);
    setElapsed(0);
  }
  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current); }, []);

  return (
    <div className="rounded-xl border border-[#E0DCCE] bg-white p-4">
      {!audioUrl && !recording && (
        <button type="button" onClick={start} className="connect-audio-btn">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m0 0h-3.75m3.75 0h3.75M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
          </svg>
          Record a voice note
        </button>
      )}
      {recording && (
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-[#0a0a0a]">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#D1573B] opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-[#D1573B]" />
            </span>
            Recording… {fmt(elapsed)}
          </span>
          <button type="button" onClick={stop} className="connect-audio-stop">
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            Stop
          </button>
        </div>
      )}
      {audioUrl && !recording && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={audioUrl} className="h-9 w-full sm:max-w-xs" />
          <div className="flex gap-2">
            <button type="button" onClick={start} className="connect-audio-secondary">Re-record</button>
            <button type="button" onClick={clear} className="connect-audio-secondary connect-audio-danger">Remove</button>
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-xs font-medium text-[#8B3A1A]">{err}</p>}
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
  const weekendCount = selected.filter((d) => d === 'Sat' || d === 'Sun').length;
  const allWeekdaysSelected = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].every((d) => selected.includes(d));
  const showWeekendWarning = weekendCount > 0 && (allWeekdaysSelected || selected.length > 5);

  return (
    <div>
      <label className="mb-1 flex items-baseline gap-2 text-sm font-medium text-[#222]">
        <span>Working days<span className="text-[#C13515]">*</span></span>
      </label>
      <p className="mb-3 text-xs text-[#7A7568]">
        Days you need the talent available. Mon–Fri are included by default; add Sat/Sun if you need weekend coverage.
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
.connect-category-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 2px solid #0a0a0a;
  border-radius: 14px;
  background: #FBFAF6;
  padding: 12px 14px;
  box-shadow: 3px 3px 0 0 #0a0a0a;
}
.connect-category-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 9999px;
  border: 1px solid #0a0a0a;
  background: #F2FCBC;
  padding: 3px 11px 3px 8px;
  font-size: 13px;
  font-weight: 700;
  color: #0a0a0a;
}
.connect-audio-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 10px;
  border: 2px solid #0a0a0a;
  background: #F2FCBC;
  padding: 9px 16px;
  font-size: 14px;
  font-weight: 700;
  color: #0a0a0a;
  box-shadow: 2px 2px 0 0 #0a0a0a;
  cursor: pointer;
  transition: background-color 0.15s, box-shadow 0.15s, transform 0.05s;
}
.connect-audio-btn:hover { background: #FCF487; box-shadow: 3px 3px 0 0 #0a0a0a; }
.connect-audio-btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 0 #0a0a0a; }
.connect-audio-stop {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 9px;
  border: 2px solid #0a0a0a;
  background: #D1573B;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  cursor: pointer;
}
.connect-audio-secondary {
  border-radius: 9px;
  border: 1px solid #D9D5C7;
  background: #fff;
  padding: 7px 12px;
  font-size: 13px;
  font-weight: 600;
  color: #3A3A3A;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.connect-audio-secondary:hover { border-color: #0a0a0a; color: #0a0a0a; }
.connect-audio-danger:hover { border-color: #C13515; color: #C13515; }
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
