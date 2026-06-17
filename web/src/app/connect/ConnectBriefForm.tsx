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

// Build-your-own-subscription workflow (mirrors upsquadconnect.com/pricing):
// experience level(s) → plan → budget. Display labels are plural; stored
// values match subscription_cards.target_tiers' CHECK (Junior/Pro/Top Talents).
// Descriptions mirror the UpSquad landing page so the client knows what each
// level means before choosing.
const EXPERIENCE_LEVELS: { label: string; value: string; desc: string }[] = [
  { label: 'Juniors', value: 'Junior', desc: 'Less than 2 years of experience. Great for straightforward tasks and cost-effective output.' },
  { label: 'Pros', value: 'Pro', desc: 'More than 2 years of experience with strong, well-rounded skill sets. Reliable quality across a wide range of work.' },
  { label: 'Top Talents', value: 'Top Talents', desc: 'Top talents with 5+ years of experience. Best for high-stakes, complex, or premium creative work.' },
];

// Plans differ by availability (Mon–Fri) — the same five bands seeded for
// every subscription/tier. Stored as plan_name on the card. Numeric hours
// drive the compact picker; the pct/capacity/perDay/perWeek/bestFor labels
// drive the full "Compare plans" modal (mirrors the pricing-page table).
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
type RoleSlug = 'designer' | 'editor' | 'designer_plus_editor';
type ServiceType = 'designer' | 'video_editor' | 'designer_video_editor';

const ROLE_OPTIONS: {
  slug: RoleSlug;
  title: string;
  description: string;
}[] = [
  {
    slug: 'designer',
    title: 'Designer',
    description: 'Static visuals — graphics, logos, branding, presentations, UI/UX, print collateral.',
  },
  {
    slug: 'editor',
    title: 'Editor',
    description: 'Motion & video — short-form reels, long-form edits, ads, corporate videos, animations.',
  },
  {
    slug: 'designer_plus_editor',
    title: 'Designer + Editor',
    description: 'One person who does both — design work and video editing — instead of hiring two separate specialists.',
  },
];

function rolesToServiceType(roles: RoleSlug[]): ServiceType | null {
  const hasDesigner = roles.includes('designer');
  const hasEditor = roles.includes('editor');
  const hasHybrid = roles.includes('designer_plus_editor');
  if (hasHybrid || (hasDesigner && hasEditor)) return 'designer_video_editor';
  if (hasDesigner) return 'designer';
  if (hasEditor) return 'video_editor';
  return null;
}

// One service_type per role checkbox ticked — no collapsing. Picking Designer
// + Editor (two boxes) yields ['designer', 'video_editor'] so the backend
// emits two separate cards (two specialists). The explicit "Designer + Editor"
// combo box still maps to a single hybrid card.
function rolesToServiceTypes(roles: RoleSlug[]): ServiceType[] {
  const out: ServiceType[] = [];
  if (roles.includes('designer')) out.push('designer');
  if (roles.includes('editor')) out.push('video_editor');
  if (roles.includes('designer_plus_editor')) out.push('designer_video_editor');
  return out;
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
type RoleRequirement = {
  note: string;
  tiers: string[];
  plan: string;
  // Per-tier monthly budget (the client's proposed price for that level),
  // keyed by tier value. Subscription path only.
  tierBudgets: Record<string, string>;
  // Assignment path only: a single one-off project budget + timeline.
  budget: string;
  duration: string;
  startDate: string;
  deadline: string;
};
const EMPTY_ROLE_REQ: RoleRequirement = { note: '', tiers: [], plan: '', tierBudgets: {}, budget: '', duration: '', startDate: '', deadline: '' };
const emptyRoleRequirements: Record<RoleSlug, RoleRequirement> = {
  designer: { ...EMPTY_ROLE_REQ },
  editor: { ...EMPTY_ROLE_REQ },
  designer_plus_editor: { ...EMPTY_ROLE_REQ },
};

// One slug per role — used on submit to key the role_requirements payload
// by the backend's service_type vocab (editor → video_editor).
function roleToServiceTypeSlug(role: RoleSlug): ServiceType {
  if (role === 'designer') return 'designer';
  if (role === 'editor') return 'video_editor';
  return 'designer_video_editor';
}

export default function ConnectBriefForm({
  product = 'subscription',
}: {
  product?: 'subscription' | 'assignment';
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [roles, setRoles] = useState<RoleSlug[]>([]);
  const [form, setForm] = useState<FormData>(initialForm);
  const [roleRequirements, setRoleRequirements] =
    useState<Record<RoleSlug, RoleRequirement>>(emptyRoleRequirements);
  // Slug of the role whose "Compare plans" modal is open (null = closed).
  const [comparePlanRole, setComparePlanRole] = useState<RoleSlug | null>(null);
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
  // ₹ for India (default), $ for the other countries we serve.
  const currencySymbol = selectedCountryName && selectedCountryName !== 'India' ? '$' : '₹';

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
    field: 'note' | 'plan' | 'budget' | 'duration' | 'startDate' | 'deadline',
    value: string,
  ) {
    setRoleRequirements((prev) => ({
      ...prev,
      [slug]: { ...prev[slug], [field]: value },
    }));
  }

  function updateRoleTierBudget(slug: RoleSlug, tier: string, value: string) {
    setRoleRequirements((prev) => ({
      ...prev,
      [slug]: { ...prev[slug], tierBudgets: { ...prev[slug].tierBudgets, [tier]: value } },
    }));
  }

  function toggleRoleReqTier(slug: RoleSlug, value: string) {
    setRoleRequirements((prev) => {
      const cur = prev[slug];
      const tiers = cur.tiers.includes(value)
        ? cur.tiers.filter((t) => t !== value)
        : [...cur.tiers, value];
      return { ...prev, [slug]: { ...cur, tiers } };
    });
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
    if (product !== 'assignment' && form.working_days.length === 0) {
      setError('Please pick at least one working day.');
      return;
    }

    const isAssignment = product === 'assignment';

    // Build the per-role payload from current selections only. Skips roles
    // the user ticked then un-ticked, and drops empty entries.
    const roleReqsPayload: Record<
      string,
      {
        note?: string; tiers?: string[]; plan?: string;
        tier_budgets?: Record<string, number>;
        budget?: number; duration?: string; start_date?: string; deadline?: string;
      }
    > = {};
    for (const r of roles) {
      const entry = roleRequirements[r];
      const note = entry.note.trim();
      const tiers = entry.tiers;

      if (isAssignment) {
        // Assignment: one-off project budget + timeline; no plan / per-tier price.
        const n = entry.budget.trim() ? Math.round(Number(entry.budget)) : NaN;
        const budget = Number.isFinite(n) && n > 0 ? n : undefined;
        const duration = entry.duration.trim();
        const startDate = entry.startDate;
        const deadline = entry.deadline;
        if (note || tiers.length || budget !== undefined || duration || startDate || deadline) {
          roleReqsPayload[roleToServiceTypeSlug(r)] = {
            ...(note ? { note } : {}),
            ...(tiers.length ? { tiers } : {}),
            ...(budget !== undefined ? { budget } : {}),
            ...(duration ? { duration } : {}),
            ...(startDate ? { start_date: startDate } : {}),
            ...(deadline ? { deadline } : {}),
          };
        }
        continue;
      }

      const plan = entry.plan;
      // Per-tier budgets — only for selected tiers with a positive amount. A
      // budget of 0 means "not stated" and must not be sent.
      const tierBudgets: Record<string, number> = {};
      for (const t of tiers) {
        const raw = entry.tierBudgets[t]?.trim();
        const n = raw ? Math.round(Number(raw)) : NaN;
        if (Number.isFinite(n) && n > 0) tierBudgets[t] = n;
      }
      const hasBudgets = Object.keys(tierBudgets).length > 0;
      if (note || tiers.length || plan || hasBudgets) {
        roleReqsPayload[roleToServiceTypeSlug(r)] = {
          ...(note ? { note } : {}),
          ...(tiers.length ? { tiers } : {}),
          ...(plan ? { plan } : {}),
          ...(hasBudgets ? { tier_budgets: tierBudgets } : {}),
        };
      }
    }

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
          // Assignments don't use working days — send none.
          working_days: product === 'assignment' ? [] : form.working_days,
          card_type: product,
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
            Tell us about your brand
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-[#5C5C5C]">
            A few quick details so we can match you with the right talent.
          </p>
        </header>

        {step === 1 && (
          <section className="flex flex-col items-center">
            <h2 className="mb-2 text-xs font-semibold tracking-[0.12em] text-[#7A7568] uppercase">
              What do you need?
            </h2>
            <p className="mb-2 max-w-md text-center text-sm text-[#5C5C5C]">
              Designers create static visuals, Editors craft motion and video, or pick a hybrid who does both.
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

            {/* Section: Subscription — build-your-own-plan per role, mirroring
                the pricing page (experience level → plan → budget). All
                optional; empties are dropped on submit. */}
            <Section
              eyebrow={product === 'assignment' ? 'Assignment' : 'Subscription'}
              title={product === 'assignment' ? 'Scope, budget & timeline' : 'Experience level & plan'}
              hint={
                product === 'assignment'
                  ? 'Pick the talent experience per role, set a project budget and timeline, and describe the scope. All optional — we can finalize on the call.'
                  : 'Pick the talent experience and a weekly plan per role, add a short note, and a monthly budget per level. All optional — we can finalize on the call.'
              }
            >
              {ROLE_OPTIONS.filter((o) => roles.includes(o.slug)).map((opt) => {
                const req = roleRequirements[opt.slug];
                return (
                  <div key={opt.slug} className="connect-role-req overflow-hidden">
                    <div className="-mx-4 -mt-3.5 mb-4 flex items-center gap-2.5 border-b border-[#E0DCCE] bg-[#F2FCBC] px-4 py-3">
                      <span className="h-3.5 w-3.5 rounded-full bg-[#FCF487] ring-1 ring-[#0a0a0a]" />
                      <span className="text-lg font-bold tracking-tight text-[#0a0a0a]">{opt.title}</span>
                    </div>
                    <div className="space-y-4">
                      {product === 'assignment' ? (
                      <>
                        {/* Experience level(s) — for matching only (no per-tier budget) */}
                        <div>
                          <label className="mb-1 flex items-baseline gap-2 text-sm font-medium text-[#222]">
                            <span>Experience level(s)</span>
                            <span className="text-xs font-normal text-[#9C9486]">(optional)</span>
                          </label>
                          <p className="mb-3 text-xs text-[#7A7568]">Select one or more — we&apos;ll match talent across all chosen levels.</p>
                          <div className="space-y-2.5">
                            {EXPERIENCE_LEVELS.map((lvl) => {
                              const on = req.tiers.includes(lvl.value);
                              return (
                                <div key={lvl.value} className={`overflow-hidden rounded-xl border transition ${on ? 'border-[#0a0a0a] bg-[#F2FCBC]/50' : 'border-[#E0DCCE] bg-white'}`}>
                                  <button type="button" onClick={() => toggleRoleReqTier(opt.slug, lvl.value)} aria-pressed={on} className="flex w-full items-start gap-3 p-3.5 text-left">
                                    <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${on ? 'border-[#0a0a0a] bg-[#FCF487]' : 'border-[#C9C4B5] bg-white'}`}>
                                      {on && (<svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>)}
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block text-sm font-semibold text-[#0a0a0a]">{lvl.label}</span>
                                      <span className="mt-0.5 block text-xs leading-relaxed text-[#7A7568]">{lvl.desc}</span>
                                    </span>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <Field label="Project budget" optional hint={`Total budget for this project in ${currencySymbol}.`}>
                          <input type="number" min="0" inputMode="numeric" value={req.budget} onChange={(e) => updateRoleReq(opt.slug, 'budget', e.target.value)} placeholder={`e.g. ${currencySymbol}50000`} className="connect-input" />
                        </Field>
                        <Field label="Duration / timeline" optional hint="Rough length of the engagement.">
                          <input type="text" value={req.duration} onChange={(e) => updateRoleReq(opt.slug, 'duration', e.target.value)} placeholder="e.g. 4 weeks, 2 months" className="connect-input" />
                        </Field>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <Field label="Start date" optional>
                            <input type="date" value={req.startDate} onChange={(e) => updateRoleReq(opt.slug, 'startDate', e.target.value)} className="connect-input" />
                          </Field>
                          <Field label="Deadline" optional>
                            <input type="date" value={req.deadline} onChange={(e) => updateRoleReq(opt.slug, 'deadline', e.target.value)} className="connect-input" />
                          </Field>
                        </div>
                        <Field label="Scope & deliverables" optional>
                          <textarea rows={2} value={req.note} onChange={(e) => updateRoleReq(opt.slug, 'note', e.target.value)} placeholder="Describe the project scope, deliverables, and any context." className="connect-input resize-none" />
                        </Field>
                      </>
                      ) : (
                      <>
                      <div>
                        <label className="mb-1 flex items-baseline gap-2 text-sm font-medium text-[#222]">
                          <span>Experience level(s)</span>
                          <span className="text-xs font-normal text-[#9C9486]">(optional)</span>
                        </label>
                        <p className="mb-3 text-xs text-[#7A7568]">
                          Select one or more — we&apos;ll match talent across all chosen levels. For each level you pick, tell us your monthly budget for that level.
                        </p>
                        <div className="space-y-2.5">
                          {EXPERIENCE_LEVELS.map((lvl) => {
                            const on = req.tiers.includes(lvl.value);
                            return (
                              <div
                                key={lvl.value}
                                className={`overflow-hidden rounded-xl border transition ${on ? 'border-[#0a0a0a] bg-[#F2FCBC]/50' : 'border-[#E0DCCE] bg-white'}`}
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleRoleReqTier(opt.slug, lvl.value)}
                                  aria-pressed={on}
                                  className="flex w-full items-start gap-3 p-3.5 text-left"
                                >
                                  <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${on ? 'border-[#0a0a0a] bg-[#FCF487]' : 'border-[#C9C4B5] bg-white'}`}>
                                    {on && (
                                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                    )}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block text-sm font-semibold text-[#0a0a0a]">{lvl.label}</span>
                                    <span className="mt-0.5 block text-xs leading-relaxed text-[#7A7568]">{lvl.desc}</span>
                                  </span>
                                </button>
                                {on && (
                                  <div className="border-t border-[#E0DCCE] px-3.5 py-3 sm:pl-11">
                                    <label className="mb-1 block text-xs font-medium text-[#222]">
                                      Monthly budget for {lvl.label} <span className="font-normal text-[#9C9486]">(optional)</span>
                                    </label>
                                    <input
                                      type="number"
                                      min="0"
                                      inputMode="numeric"
                                      value={req.tierBudgets[lvl.value] ?? ''}
                                      onChange={(e) => updateRoleTierBudget(opt.slug, lvl.value, e.target.value)}
                                      placeholder={`e.g. ${currencySymbol}25000`}
                                      className="connect-input"
                                    />
                                    <p className="mt-1 text-[11px] text-[#9C9486]">How much you&apos;re willing to pay per month for this level.</p>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <label className="flex items-baseline gap-2 text-sm font-medium text-[#222]">
                            <span>Plan</span>
                            <span className="text-xs font-normal text-[#9C9486]">(optional)</span>
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
                        <p className="mb-3 text-xs text-[#7A7568]">
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
                                      onClick={() => updateRoleReq(opt.slug, 'plan', on ? '' : p.name)}
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

                      <Field label="Short note" optional>
                        <textarea
                          rows={2}
                          value={req.note}
                          onChange={(e) => updateRoleReq(opt.slug, 'note', e.target.value)}
                          placeholder="Explain the kind of work you're looking to get done."
                          className="connect-input resize-none"
                        />
                      </Field>
                      </>
                      )}
                    </div>
                  </div>
                );
              })}
            </Section>

            {/* Section: Talent preferences */}
            <Section
              eyebrow="Talent preferences"
              title="Who you'd like to work with"
              hint="Where the talent should be based, what they should speak, and when they should work."
            >
              <Field label="Country" required hint="India is the default. Pick a different country if your talent should be elsewhere.">
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
                options={LANGUAGES}
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

      {comparePlanRole && (() => {
        const role = ROLE_OPTIONS.find((o) => o.slug === comparePlanRole);
        if (!role) return null;
        return (
          <PlanCompareModal
            roleTitle={role.title}
            selectedPlan={roleRequirements[role.slug].plan}
            onSelect={(name) => updateRoleReq(role.slug, 'plan', name)}
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
        Days you need the talent to be available — we'll match people whose schedule fits yours.
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
            Less chance of talent accepting the request if weekends are selected.
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
