'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatStoredPhone,
  normalizeNationalNumber,
  type AdditionalRequirements,
} from '@squadhub/shared';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import { STATES_BY_COUNTRY_NAME, LANGUAGE_OPTIONS } from './locationLanguageOptions';
import ClientBriefAdditionalRequirements from './ClientBriefAdditionalRequirements';

// Map an admin role slug to the additional-requirements catalog slug.
function catalogSlug(roleSlug: string): string {
  if (roleSlug === 'editor') return 'video_editor';
  if (roleSlug === 'designer_plus_editor') return 'designer_video_editor';
  return roleSlug; // 'designer' | 'accountant'
}

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

// Product line the brief belongs to. 'subscription' is the recurring-plan
// brief; 'assignment' is a one-off freelance project (project budget + scope +
// timeline instead of a weekly plan + monthly price). Both reuse this form and
// land in the same All Deals → Subscription Cards pipeline.
export type BriefProduct = 'subscription' | 'assignment';

// Launcher options for the admin "New client brief" slider — the cartesian of
// product × role type. Each opens ClientBriefForm with the matching product + type.
export const BRIEF_LAUNCHERS: {
  key: string;
  product: BriefProduct;
  type: BriefType;
  title: string;
  blurb: string;
}[] = [
  { key: 'sub-creative', product: 'subscription', type: 'creative', title: 'Subscription · Designer / Video Editor', blurb: 'Recurring creative subscription — designers, editors, or both.' },
  { key: 'sub-accountant', product: 'subscription', type: 'accountant', title: 'Subscription · Accountant', blurb: 'Recurring finance subscription — bookkeeping, GST, audits.' },
  { key: 'asg-creative', product: 'assignment', type: 'creative', title: 'Assignment · Designer / Video Editor', blurb: 'One-off freelance project — scope, budget & timeline.' },
  { key: 'asg-accountant', product: 'assignment', type: 'accountant', title: 'Assignment · Accountant', blurb: 'One-off finance project — scope, budget & timeline.' },
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
const EXPERIENCE_LEVELS: { label: string; value: string; desc: string }[] = [
  { label: 'Juniors', value: 'Junior', desc: 'Less than 2 years of experience. Great for straightforward tasks and cost-effective output.' },
  { label: 'Pros', value: 'Pro', desc: 'More than 2 years of experience with strong, well-rounded skill sets. Reliable quality across a wide range of work.' },
  { label: 'Top Talents', value: 'Top Talents', desc: 'Top talents with 5+ years of experience. Best for high-stakes, complex, or premium creative work.' },
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

type RoleReq = {
  note: string;
  tiers: string[];
  plan: string;
  // Per-tier budget (monthly for subscription, project for assignment).
  tierBudgets: Record<string, string>;
  // Assignment-only timeline fields.
  duration: string;
  startDate: string;
  deadline: string;
};
const EMPTY_REQ: RoleReq = { note: '', tiers: [], plan: '', tierBudgets: {}, duration: '', startDate: '', deadline: '' };

export default function ClientBriefForm({
  type,
  product = 'subscription',
  onClose,
  onCreated,
}: {
  type: BriefType;
  product?: BriefProduct;
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
  // Assignment only: whether the card is broadcast WITH a price (talents
  // accept/decline/counter) or WITHOUT (talents submit an offer). Brief-level.
  const [pricingMode, setPricingMode] = useState<'priced' | 'unpriced'>('priced');
  // Requirement description — voice note + typed note, brief-level (applies to
  // every selected role).
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);
  const audioNoteRef = useRef<AudioNoteHandle>(null);
  const [requirementNote, setRequirementNote] = useState('');
  // Optional skills/tools per role, keyed by catalog slug. Descriptive only —
  // stored on the card and never used to match talent.
  const [additionalReqs, setAdditionalReqs] = useState<Record<string, AdditionalRequirements>>({});

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
  function setReq(
    slug: string,
    key: 'note' | 'plan' | 'duration' | 'startDate' | 'deadline',
    value: string,
  ) {
    setRoleReqs((prev) => ({ ...prev, [slug]: { ...(prev[slug] || EMPTY_REQ), [key]: value } }));
  }
  function setReqTierBudget(slug: string, tier: string, value: string) {
    setRoleReqs((prev) => {
      const cur = prev[slug] || EMPTY_REQ;
      return {
        ...prev,
        [slug]: {
          ...cur,
          tierBudgets: { ...cur.tierBudgets, [tier]: value.replace(/[^0-9]/g, '') },
        },
      };
    });
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
    // If a recording is still running, capture it now so forgetting to press
    // Stop doesn't silently drop the voice note.
    await audioNoteRef.current?.flush();
    // Admin-only clone: most fields stay optional so sales can save partial
    // client details. Plan is required on subscription briefs so catalog
    // pricing and hours can resolve.
    if (product !== 'assignment') {
      const missingPlan = selectedRoles.filter((r) => !getReq(r.slug).plan);
      if (missingPlan.length > 0) {
        const msg =
          missingPlan.length === 1
            ? 'Please select a weekly plan.'
            : 'Please select a weekly plan for each role.';
        setError(msg);
        return;
      }
    }

    const shared = {
      brand_name: form.brand_name.trim() || undefined,
      business_nature: form.business_nature.trim() || undefined,
      business_note: form.business_note.trim() || undefined,
      contact_name: form.contact_name.trim() || undefined,
      // Send undefined (not "") when blank — the backend's email() check
      // would otherwise reject an empty string.
      email: form.email.trim() || undefined,
      phone: form.phone.trim() ? formatStoredPhone(form.country_code, form.phone) : undefined,
      business_location: form.business_location.trim() || undefined,
      country_id: form.country_id || undefined,
      state_regions: form.state_regions,
      languages: form.languages,
      // Assignments don't use working days — send none.
      working_days: product === 'assignment' ? [] : form.working_days,
    };

    setSubmitting(true);
    try {
      // Upload the requirement voice note (if any) before creating the cards.
      // Don't swallow a failed upload — surface it and stop so the note isn't
      // silently dropped from the brief.
      let requirementVoiceUrl = '';
      if (audioBlobRef.current) {
        try {
          requirementVoiceUrl = await uploadVoiceNote(audioBlobRef.current);
        } catch (e) {
          console.error('voice note upload failed', e);
          const msg =
            'The voice note couldn’t be uploaded. Check your connection and try again, or remove it to submit without the voice note.';
          setError(msg);
          showToast(msg, 'error');
          return;
        }
      }
      const briefNote = requirementNote.trim() || undefined;

      // One card per selected role — mirrors /connect creating a card per service_type.
      await Promise.all(
        selectedRoles.map((r) => {
          const req = getReq(r.slug);
          const tierBudgets: Record<string, number> = {};
          for (const t of req.tiers) {
            const raw = req.tierBudgets[t]?.trim();
            if (!raw) continue;
            const n = Math.round(Number(raw));
            if (Number.isFinite(n) && n > 0) tierBudgets[t] = n;
          }
          const budgetValues = Object.values(tierBudgets);
          const allSame =
            budgetValues.length > 0 && budgetValues.every((v) => v === budgetValues[0]);
          const proposed =
            allSame || budgetValues.length === 1 ? budgetValues[0] : undefined;
          const extra = additionalReqs[catalogSlug(r.slug)];
          const hasExtra =
            extra && Object.values(extra).some((l) => l.some((s) => s.trim()));
          return api.post('/admin/subscription-cards/client-brief', {
            ...shared,
            service_type: r.service_type,
            card_type: product,
            requirement_note: briefNote,
            ...(hasExtra ? { additional_requirements: extra } : {}),
            ...(requirementVoiceUrl ? { requirement_voice_url: requirementVoiceUrl } : {}),
            target_tiers: req.tiers.length ? req.tiers : undefined,
            // Per-level budgets the client stated; also a scalar proposed_price
            // when there's a single (or uniform) amount for back-compat.
            tier_budgets: Object.keys(tierBudgets).length ? tierBudgets : undefined,
            plan_name: product === 'assignment' ? undefined : req.plan || undefined,
            proposed_price: proposed,
            ...(product === 'assignment'
              ? {
                  duration: req.duration.trim() || undefined,
                  start_date: req.startDate || undefined,
                  deadline: req.deadline || undefined,
                  pricing_mode: pricingMode,
                }
              : {}),
          });
        }),
      );
      const n = selectedRoles.length;
      showToast(`${n} client brief${n > 1 ? 's' : ''} created — find ${n > 1 ? 'them' : 'it'} in New Deals`, 'success');
      qc.invalidateQueries({ queryKey: ['admin-internal-brief-submissions'] });
      qc.invalidateQueries({ queryKey: ['admin-subscription-cards'] });
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
          Back to Subscription Cards
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

            {/* Selected category — always visible on top (mirrors /connect and
                what the client sees). */}
            <CategoryBanner product={product} roles={selectedRoles} onEdit={() => setStep(1)} />

            {/* ── GROUP 1: Business details ─────────────────────────────── */}
            <GroupHeader index={1} title="Business details" subtitle="Who the client is and how to reach them." />

            <Section
              eyebrow="Customer"
              title="Your contact"
              hint="How we'll reach you to confirm and schedule the kickoff call."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Email" optional>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                    placeholder="you@company.com"
                    className="connect-input"
                  />
                </Field>
                <Field label="Phone" optional hint="Ideally a WhatsApp number">
                  <div className="connect-phone">
                    <select
                      value={form.country_code}
                      onChange={(e) => {
                        const code = e.target.value;
                        setForm((prev) => ({
                          ...prev,
                          country_code: code,
                          phone: normalizeNationalNumber(prev.phone, code),
                        }));
                      }}
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
                      inputMode="numeric"
                      value={form.phone}
                      onChange={(e) => update('phone', normalizeNationalNumber(e.target.value, form.country_code))}
                      placeholder="Phone number"
                      className="connect-phone-input"
                    />
                  </div>
                </Field>
                <Field label="Contact Person Name" optional>
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
              <Field label="Brand Name" optional>
                <input
                  type="text"
                  value={form.brand_name}
                  onChange={(e) => update('brand_name', e.target.value)}
                  placeholder="Your brand name"
                  className="connect-input"
                />
              </Field>
              <Field label="Nature of Business" optional>
                <input
                  type="text"
                  value={form.business_nature}
                  onChange={(e) => update('business_nature', e.target.value)}
                  placeholder="e.g. Retail, SaaS, Education"
                  className="connect-input"
                />
              </Field>
              <Field label="Short Note About the Business" optional>
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

            {/* ── GROUP 2: Requirement details ──────────────────────────── */}
            <GroupHeader index={2} title="Requirement details" subtitle="What the client needs, budget, and who they'd like to work with." />

            <Section
              eyebrow="Requirement"
              title="Describe the requirement"
              hint="Record a voice note, type it out, or both. Talent can listen to the voice note in SquadHire."
            >
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 flex items-baseline gap-2 text-sm font-medium text-foreground">
                    <span>Voice note</span>
                    <span className="text-xs font-normal text-foreground-muted">(optional)</span>
                  </label>
                  <AudioNote
                    ref={audioNoteRef}
                    audioUrl={audioUrl}
                    onChange={(blob, url) => { audioBlobRef.current = blob; setAudioUrl(url); }}
                  />
                </div>
                <Field label="Requirement note" optional hint="Explain the kind of work the client is looking to get done.">
                  <textarea
                    rows={3}
                    value={requirementNote}
                    onChange={(e) => setRequirementNote(e.target.value)}
                    placeholder="e.g. Weekly social creatives, one brand video a month, occasional pitch decks…"
                    className="connect-input resize-none"
                  />
                </Field>
              </div>
            </Section>

            <Section
              eyebrow={product === 'assignment' ? 'Assignment' : 'Subscription'}
              title={product === 'assignment' ? 'Scope, budget & timeline' : 'Plan, levels & budget'}
              hint={
                product === 'assignment'
                  ? 'Pick the talent experience levels, set a project budget per level, and describe the timeline. All optional — we can finalize on the call.'
                  : 'Pick a weekly plan (required), then choose experience levels and a monthly budget for each if known.'
              }
            >
              {product === 'assignment' && (
                <div className="mb-5 rounded-xl border border-[#E0DCCE] bg-surface p-4">
                  <label className="mb-1 block text-sm font-medium text-foreground">How do you want to price this?</label>
                  <p className="mb-3 text-xs text-foreground-muted">Choose whether talents see a set price or submit their own offers.</p>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {([
                      { value: 'priced' as const, title: 'Send with a price', desc: 'Talents see your budget and can accept, decline, or counter-offer.' },
                      { value: 'unpriced' as const, title: 'Invite offers', desc: 'No price shown — talents submit an offer and you review, counter, or accept.' },
                    ]).map((o) => {
                      const on = pricingMode === o.value;
                      return (
                        <button
                          key={o.value}
                          type="button"
                          onClick={() => setPricingMode(o.value)}
                          aria-pressed={on}
                          className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition ${on ? 'border-[#0a0a0a] bg-[#F2FCBC]/50' : 'border-[#E0DCCE] bg-surface'}`}
                        >
                          <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${on ? 'border-[#0a0a0a] bg-[#FCF487]' : 'border-[#C9C4B5] bg-surface'}`}>
                            {on && <span className="h-2 w-2 rounded-full bg-[#0a0a0a]" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-foreground">{o.title}</span>
                            <span className="mt-0.5 block text-xs leading-relaxed text-foreground-muted">{o.desc}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {selectedRoles.map((opt) => {
                const req = getReq(opt.slug);
                return (
                  <div key={opt.slug} className="connect-role-req overflow-hidden">
                    <div className="-mx-4 -mt-3.5 mb-4 flex items-center gap-2.5 border-b border-[#E0DCCE] bg-[#F2FCBC] px-4 py-3">
                      <span className="h-3.5 w-3.5 rounded-full bg-[#FCF487] ring-1 ring-ink" />
                      <span className="text-lg font-bold tracking-tight text-foreground">{opt.title}</span>
                    </div>
                    <div className="space-y-4">
                      {product !== 'assignment' && (
                      <div>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <label className="flex items-baseline gap-2 text-sm font-medium text-foreground">
                            <span>Plan</span>
                            <span className="text-[#C13515]">*</span>
                          </label>
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
                        </div>
                        <p className="mb-3 text-xs text-foreground-muted">
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
                      </div>
                      )}

                      <div>
                        <label className="mb-1 flex items-baseline gap-2 text-sm font-medium text-foreground">
                          <span>Experience level(s)</span>
                          <span className="text-xs font-normal text-foreground-muted">(optional)</span>
                        </label>
                        <p className="mb-3 text-xs text-foreground-muted">
                          Select one or more — we&apos;ll match talent across all chosen levels.
                          {product === 'assignment'
                            ? pricingMode === 'unpriced'
                              ? ' For each level, you can set an internal budget ceiling.'
                              : ' For each level, set a project budget.'
                            : ' For each level, set a monthly budget.'}
                        </p>
                        <div className="space-y-2.5">
                          {EXPERIENCE_LEVELS.map((lvl) => {
                            const on = req.tiers.includes(lvl.value);
                            return (
                              <div
                                key={lvl.value}
                                className={`overflow-hidden rounded-xl border transition ${on ? 'border-[#0a0a0a] bg-[#F2FCBC]/50' : 'border-[#E0DCCE] bg-surface'}`}
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleReqTier(opt.slug, lvl.value)}
                                  aria-pressed={on}
                                  className="flex w-full items-start gap-3 p-3.5 text-left"
                                >
                                  <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${on ? 'border-[#0a0a0a] bg-[#FCF487]' : 'border-[#C9C4B5] bg-surface'}`}>
                                    {on && (
                                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                    )}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block text-sm font-semibold text-foreground">{lvl.label}</span>
                                    <span className="mt-0.5 block text-xs leading-relaxed text-foreground-muted">{lvl.desc}</span>
                                  </span>
                                </button>
                                {on && (
                                  <div className="border-t border-[#E0DCCE] px-3.5 py-3 sm:pl-11">
                                    <label className="mb-1 block text-xs font-medium text-foreground">
                                      {product === 'assignment'
                                        ? (pricingMode === 'unpriced' ? `Budget ceiling for ${lvl.label}` : `Project budget for ${lvl.label}`)
                                        : `Monthly budget for ${lvl.label}`}
                                      {' '}
                                      <span className="font-normal text-foreground-muted">(optional)</span>
                                    </label>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={req.tierBudgets[lvl.value] ?? ''}
                                      onChange={(e) => setReqTierBudget(opt.slug, lvl.value, e.target.value)}
                                      placeholder={`e.g. ${currencySymbol}${product === 'assignment' ? '50000' : '25000'}`}
                                      className="connect-input"
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {product === 'assignment' && (
                        <>
                          <Field label="Duration / timeline" optional hint="Rough length of the engagement.">
                            <input
                              type="text"
                              value={req.duration}
                              onChange={(e) => setReq(opt.slug, 'duration', e.target.value)}
                              placeholder="e.g. 4 weeks, 2 months"
                              className="connect-input"
                            />
                          </Field>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label="Start date" optional>
                              <input
                                type="date"
                                value={req.startDate}
                                onChange={(e) => setReq(opt.slug, 'startDate', e.target.value)}
                                className="connect-input"
                              />
                            </Field>
                            <Field label="Deadline" optional>
                              <input
                                type="date"
                                value={req.deadline}
                                onChange={(e) => setReq(opt.slug, 'deadline', e.target.value)}
                                className="connect-input"
                              />
                            </Field>
                          </div>
                        </>
                      )}
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
              {/* Location targeting is opt-in and grouped. Empty = anywhere. */}
              <div className="rounded-xl border border-[#E0DCCE] bg-surface p-4">
                <div className="mb-1 flex items-baseline gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Preferred location</h3>
                  <span className="text-xs font-normal text-foreground-muted">(optional)</span>
                </div>
                <p className="mb-4 text-xs leading-relaxed text-foreground-muted">
                  Set a country and state only if the talent must be in a specific place. Leave empty to match anywhere.
                </p>
                <div className="space-y-4">
                  <Field label="Country">
                    <select
                      value={form.country_id}
                      onChange={(e) => changeCountry(e.target.value)}
                      className="connect-input"
                    >
                      <option value="">{countries.length === 0 ? 'Loading…' : 'Anywhere (no preference)'}</option>
                      {countries.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </Field>

                  {stateOptions.length > 0 && (
                    <ChipField
                      label="States / regions"
                      hint="Narrow to specific states when local context matters."
                      options={stateOptions}
                      selected={form.state_regions}
                      onToggle={(v) => toggle('state_regions', v)}
                    />
                  )}
                </div>
              </div>
              <ChipField
                label="Languages"
                hint="Languages the talent should be fluent in. Pick all that apply."
                optional
                options={languageOptions}
                selected={form.languages}
                onToggle={(v) => toggle('languages', v)}
              />
              {product !== 'assignment' && (
                <WorkingDaysSelector
                  selected={form.working_days}
                  onToggle={(v) => toggle('working_days', v)}
                />
              )}
            </Section>

            {/* Optional skills & tools per selected role — descriptive, not a filter. */}
            {selectedRoles.length > 0 && (
              <ClientBriefAdditionalRequirements
                roles={selectedRoles.map((r) => ({ slug: catalogSlug(r.slug), label: r.title }))}
                values={additionalReqs}
                onChange={(slug, v) => setAdditionalReqs((prev) => ({ ...prev, [slug]: v }))}
              />
            )}

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

// Upload a recorded voice note to R2 via the admin presigned-URL endpoint.
// Returns the public URL; throws on failure so the caller falls back to text.
async function uploadVoiceNote(blob: Blob): Promise<string> {
  // MediaRecorder blobs carry a parameterised MIME like `audio/webm;codecs=opus`.
  // R2 signs the presigned PUT against the exact Content-Type and the upload
  // endpoint only accepts a bare `audio/<subtype>`, so strip the parameters and
  // use the base type for both the presign request and the PUT header.
  const contentType = (blob.type || 'audio/webm').split(';')[0].trim() || 'audio/webm';
  const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('ogg') ? 'ogg' : 'webm';
  const { data } = await api.post('/admin/subscription-cards/voice-upload-url', {
    filename: `voice-note.${ext}`,
    content_type: contentType,
  });
  if (!data?.success || !data.data?.upload_url) throw new Error('presign failed');
  const put = await fetch(data.data.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
  });
  if (!put.ok) throw new Error('upload failed');
  return data.data.public_url as string;
}

// Sticky summary of the brief's selected service category — mirrors /connect
// and what the client sees, so admins always see what the brief is for.
function CategoryBanner({
  product, roles, onEdit,
}: {
  product: BriefProduct;
  roles: { slug: string; title: string }[];
  onEdit: () => void;
}) {
  return (
    <div className="connect-category-banner">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-muted">
          {product === 'assignment' ? 'Assignment brief' : 'Subscription brief'} · Category
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {roles.length === 0 ? (
            <span className="text-sm text-foreground-muted">No category selected</span>
          ) : (
            roles.map((r) => (
              <span key={r.slug} className="connect-category-chip">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {r.title}
              </span>
            ))
          )}
        </div>
      </div>
      <button type="button" onClick={onEdit} className="connect-category-edit">Change</button>
    </div>
  );
}

// Big numbered divider splitting the form into Business vs Requirement groups.
function GroupHeader({ index, title, subtitle }: { index: number; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 pt-3">
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-2 border-ink bg-[#FCF487] text-sm font-extrabold text-[#0a0a0a] shadow-[2px_2px_0_0_#0a0a0a]">
        {index}
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
        <p className="text-xs text-foreground-muted">{subtitle}</p>
      </div>
    </div>
  );
}

// Record / play / re-record a short voice note using the browser MediaRecorder.
type AudioNoteHandle = { flush: () => Promise<void> };

const AudioNote = forwardRef<AudioNoteHandle, {
  audioUrl: string | null;
  onChange: (blob: Blob | null, url: string | null) => void;
}>(function AudioNote({ audioUrl, onChange }, ref) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Resolved by onstop once a flush()-triggered stop has committed the blob.
  const flushResolveRef = useRef<(() => void) | null>(null);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  // In-browser recording needs a secure context + getUserMedia. The file /
  // native-recorder fallback below covers browsers/WebViews that don't grant it.
  const canRecord =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    (typeof window === 'undefined' || window.isSecureContext);

  function pickFile() {
    setErr('');
    fileInputRef.current?.click();
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('audio/')) { setErr('Please choose an audio file.'); return; }
    setErr('');
    onChange(file, URL.createObjectURL(file));
  }

  async function start() {
    setErr('');
    if (!canRecord) {
      pickFile();
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
        // A flush() is awaiting this stop — release it now the blob is committed.
        if (flushResolveRef.current) {
          const resolve = flushResolveRef.current;
          flushResolveRef.current = null;
          resolve();
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (e) {
      const name = (e as { name?: string })?.name || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setErr('Microphone permission is off. Allow it — or use “Upload audio” to attach a recording instead.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setErr('No microphone found. Use “Upload audio” to attach a recording instead.');
      } else {
        setErr('Couldn’t start recording here. Use “Upload audio” to attach a recording instead.');
      }
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

  // Parent calls this at submit: if a recording is still running, stop it and
  // wait for the blob to commit before the form reads it. Otherwise no-op.
  useImperativeHandle(ref, () => ({
    flush: () =>
      new Promise<void>((resolve) => {
        if (recorderRef.current) {
          flushResolveRef.current = resolve;
          stop();
        } else {
          resolve();
        }
      }),
  }), []);

  return (
    <div className="rounded-xl border border-[#E0DCCE] bg-surface p-4">
      <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={onFilePicked} />
      {!audioUrl && !recording && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={start} className="connect-audio-btn">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m0 0h-3.75m3.75 0h3.75M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
            Record a voice note
          </button>
          <button type="button" onClick={pickFile} className="connect-audio-secondary">Upload audio</button>
        </div>
      )}
      {recording && (
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
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
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[#2E7D32]">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Voice note attached — it&apos;ll be sent with the brief.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls src={audioUrl} className="h-9 w-full sm:max-w-xs" />
            <div className="flex gap-2">
              <button type="button" onClick={start} className="connect-audio-secondary">Re-record</button>
              <button type="button" onClick={clear} className="connect-audio-secondary connect-audio-danger">Remove</button>
            </div>
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-xs font-medium text-[#8B3A1A]">{err}</p>}
    </div>
  );
});

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
        <span>Working Days <span className="text-xs font-normal text-foreground-muted">(optional)</span></span>
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
.connect-category-banner {
  position: sticky;
  top: 8px;
  z-index: 20;
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
.connect-category-edit {
  flex-shrink: 0;
  border-radius: 9px;
  border: 1.5px solid #0a0a0a;
  background: #fff;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  color: #0a0a0a;
  cursor: pointer;
  transition: background-color 0.15s;
}
.connect-category-edit:hover { background: #F2FCBC; }
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
