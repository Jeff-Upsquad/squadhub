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

// Region-aware language options. When a client narrows talent to a specific
// country + state, the language chips re-order to that region's languages so
// the relevant choice is front-and-centre. English is always offered.
// Leaving country/state empty falls back to the full LANGUAGES list.
const LANGUAGES_BY_INDIAN_STATE: Record<string, string[]> = {
  'Tamil Nadu': ['Tamil', 'English'],
  Kerala: ['Malayalam', 'English'],
  Karnataka: ['Kannada', 'English'],
  'Andhra Pradesh': ['Telugu', 'English'],
  Telangana: ['Telugu', 'Urdu', 'English'],
  Maharashtra: ['Marathi', 'Hindi', 'English'],
  Goa: ['Konkani', 'Marathi', 'English'],
  Gujarat: ['Gujarati', 'Hindi', 'English'],
  Punjab: ['Punjabi', 'Hindi', 'English'],
  Haryana: ['Hindi', 'Punjabi', 'English'],
  'West Bengal': ['Bengali', 'Hindi', 'English'],
  Odisha: ['Odia', 'Hindi', 'English'],
  Assam: ['Assamese', 'Bengali', 'English'],
  Delhi: ['Hindi', 'Punjabi', 'Urdu', 'English'],
  'Jammu and Kashmir': ['Urdu', 'Hindi', 'English'],
};
// Default languages per country when only the country is chosen (no state).
const LANGUAGES_BY_COUNTRY_NAME: Record<string, string[]> = {
  India: ['Hindi', 'English', 'Tamil', 'Telugu', 'Malayalam', 'Kannada', 'Marathi', 'Bengali', 'Gujarati', 'Punjabi', 'Urdu'],
  'United States': ['English', 'Spanish'],
  'United Kingdom': ['English'],
  'United Arab Emirates': ['Arabic', 'English', 'Hindi', 'Urdu'],
  Singapore: ['English', 'Mandarin', 'Malay', 'Tamil'],
  Australia: ['English'],
  Canada: ['English', 'French'],
};

// Resolve the language chip options for the current location selection.
// Union of every selected state's languages, else the country default, else
// the full list — always with English, and always keeping already-picked
// languages visible so a location change never silently drops a choice.
function languageOptionsFor(
  countryName: string,
  selectedStates: string[],
  alreadySelected: string[],
): string[] {
  let base: string[];
  if (countryName === 'India' && selectedStates.length > 0) {
    const set = new Set<string>();
    for (const st of selectedStates) {
      for (const lang of LANGUAGES_BY_INDIAN_STATE[st] || ['Hindi', 'English']) set.add(lang);
    }
    base = [...set];
  } else if (countryName && LANGUAGES_BY_COUNTRY_NAME[countryName]) {
    base = [...LANGUAGES_BY_COUNTRY_NAME[countryName]];
  } else {
    base = [...LANGUAGES];
  }
  const out = [...base];
  if (!out.includes('English')) out.push('English');
  for (const l of alreadySelected) if (!out.includes(l)) out.push(l);
  return out;
}

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

// Upload a recorded voice note to R2 via a server-issued presigned PUT URL,
// returning the public URL to store on the brief. Throws on any failure so
// the caller can fall back to the typed note.
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
  // Assignment only: whether the card is broadcast WITH a price (talents
  // accept/decline/counter) or WITHOUT (talents submit an offer). Brief-level.
  const [pricingMode, setPricingMode] = useState<'priced' | 'unpriced'>('priced');
  const [countries, setCountries] = useState<Country[]>([]);
  // Optional voice note describing the requirement in the client's own words.
  // Captured client-side (MediaRecorder); the blob is uploaded on submit and
  // surfaced to talent in SquadHire. UI-only for now — wiring the upload +
  // storage column comes after the design is approved.
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);
  // Typed requirement description — the text companion to the voice note.
  // Brief-level (applies across every selected role); sent as each role's note.
  const [requirementNote, setRequirementNote] = useState('');
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
          // Location is opt-in — leave country empty ("Anywhere") by default
          // so a client only narrows by location when they deliberately pick one.
          setCountries(data.data);
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
  // Language chips re-tuned to the chosen location (falls back to full list).
  const languageOptions = languageOptionsFor(selectedCountryName, form.state_regions, form.languages);
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

    // Requirement is mandatory — a voice note OR a typed note (either is fine).
    if (!audioBlobRef.current && !requirementNote.trim()) {
      setError('Please describe your requirement — record a voice note or type it in.');
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
      return;
    }
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
        pricing_mode?: 'priced' | 'unpriced';
      }
    > = {};
    for (const r of roles) {
      const entry = roleRequirements[r];
      // The requirement note is now brief-level (one description across all
      // roles), captured alongside the voice note.
      const note = requirementNote.trim();
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
            pricing_mode: pricingMode,
          };
        }
        continue;
      }

      const plan = entry.plan;
      // Every subscription brief now goes out to all experience tiers by
      // default — the client no longer picks levels.
      const allTiers = EXPERIENCE_LEVELS.map((l) => l.value);
      // Single monthly budget for the chosen plan (0 / blank = not stated).
      const bn = entry.budget.trim() ? Math.round(Number(entry.budget)) : NaN;
      const budget = Number.isFinite(bn) && bn > 0 ? bn : undefined;
      // Replicate across every tier so downstream per-tier consumers still
      // resolve a number until the backend adopts the single-budget shape.
      const tierBudgets: Record<string, number> = {};
      if (budget !== undefined) for (const t of allTiers) tierBudgets[t] = budget;
      roleReqsPayload[roleToServiceTypeSlug(r)] = {
        ...(note ? { note } : {}),
        tiers: allTiers,
        ...(plan ? { plan } : {}),
        ...(budget !== undefined ? { budget } : {}),
        ...(Object.keys(tierBudgets).length ? { tier_budgets: tierBudgets } : {}),
      };
    }

    setSubmitting(true);
    try {
      // Upload the voice note first (if any) so we can send its public URL
      // with the brief. A failed upload isn't fatal — we fall back to the
      // typed note, which validation already guarantees is present when the
      // voice note is absent.
      let requirementVoiceUrl = '';
      if (audioBlobRef.current) {
        try {
          requirementVoiceUrl = await uploadVoiceNote(audioBlobRef.current);
        } catch {
          // Non-fatal; brief still submits with the typed note.
        }
      }

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
          // Location is optional — omit country when "Anywhere" is chosen.
          ...(form.country_id ? { country_id: form.country_id } : {}),
          state_regions: form.country_id ? form.state_regions : [],
          languages: form.languages,
          ...(requirementVoiceUrl ? { requirement_voice_url: requirementVoiceUrl } : {}),
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

            {/* Selected category — always visible at the top so the client
                (and, mirrored downstream, admin + SquadHire talent) can see
                what this brief is for without scrolling back to Step 1. */}
            <CategoryBanner
              product={product}
              roles={ROLE_OPTIONS.filter((o) => roles.includes(o.slug))}
              onEdit={() => setStep(1)}
            />

            {/* ── GROUP 1: Business details ─────────────────────────────── */}
            <GroupHeader
              index={1}
              title="Business details"
              subtitle="Who you are and how we reach you."
            />

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
              <Field label="Location of Business" required hint="Where your business is based — city and area.">
                <input
                  type="text"
                  required
                  value={form.business_location}
                  onChange={(e) => update('business_location', e.target.value)}
                  placeholder="City, area"
                  className="connect-input"
                />
              </Field>
            </Section>

            {/* ── GROUP 2: Requirement details ──────────────────────────── */}
            <GroupHeader
              index={2}
              title="Requirement details"
              subtitle="What you need done, your budget, and who you'd like to work with."
            />

            {/* Requirement description — voice note + typed note together, so
                the client can explain in their own words either way. Surfaced
                to talent in SquadHire so nuance isn't lost. */}
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
                    onChange={(blob, url) => {
                      audioBlobRef.current = blob;
                      setAudioUrl(url);
                    }}
                  />
                </div>
                <Field label="Requirement note" optional hint="Explain the kind of work you're looking to get done.">
                  <textarea
                    rows={3}
                    value={requirementNote}
                    onChange={(e) => setRequirementNote(e.target.value)}
                    placeholder="e.g. Weekly social media creatives, one brand video a month, occasional pitch decks…"
                    className="connect-input resize-none"
                  />
                </Field>
              </div>
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
              {product === 'assignment' && (
                <div className="mb-5 rounded-xl border border-[#E0DCCE] bg-white p-4">
                  <label className="mb-1 block text-sm font-medium text-[#222]">How do you want to price this?</label>
                  <p className="mb-3 text-xs text-[#7A7568]">Choose whether talents see a set price or submit their own offers.</p>
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
                          className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition ${on ? 'border-[#0a0a0a] bg-[#F2FCBC]/50' : 'border-[#E0DCCE] bg-white'}`}
                        >
                          <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${on ? 'border-[#0a0a0a] bg-[#FCF487]' : 'border-[#C9C4B5] bg-white'}`}>
                            {on && <span className="h-2 w-2 rounded-full bg-[#0a0a0a]" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-[#0a0a0a]">{o.title}</span>
                            <span className="mt-0.5 block text-xs leading-relaxed text-[#7A7568]">{o.desc}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
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
                        <Field label={pricingMode === 'unpriced' ? 'Budget ceiling' : 'Project budget'} optional hint={pricingMode === 'unpriced' ? `Internal maximum — not shown to talents, they submit their own offer. In ${currencySymbol}.` : `Total budget for this project in ${currencySymbol}.`}>
                          <input type="text" inputMode="numeric" pattern="[0-9]*" value={req.budget} onChange={(e) => updateRoleReq(opt.slug, 'budget', e.target.value.replace(/[^0-9]/g, ''))} placeholder={`e.g. ${currencySymbol}50000`} className="connect-input" />
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
                      </>
                      ) : (
                      <>
                      <div>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <label className="flex items-baseline gap-2 text-sm font-medium text-[#222]">
                            <span>Plan</span>
                            <span className="text-xs font-normal text-[#9C9486]">(optional)</span>
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
                      </div>

                      {/* Single monthly budget for the chosen plan. Experience
                          tiers (Junior / Pro / Top Talent) are no longer picked
                          here — every brief goes out to all tiers by default. */}
                      <Field
                        label={req.plan ? `Monthly budget for the ${req.plan} plan` : 'Monthly budget'}
                        optional
                        hint={
                          req.plan
                            ? `What you're willing to pay per month for the ${req.plan} plan. We'll match talent across all experience levels.`
                            : 'Pick a plan above, then tell us your monthly budget for it. We’ll match talent across all experience levels.'
                        }
                      >
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={req.budget}
                          onChange={(e) => updateRoleReq(opt.slug, 'budget', e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder={`e.g. ${currencySymbol}25000`}
                          className="connect-input"
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
              {/* Location targeting is opt-in and grouped together. Empty
                  country/state = match talent anywhere. Picking a location
                  narrows the language chips to that region below. */}
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
                      {countries.length === 0 && <option value="" disabled>Loading…</option>}
                      {countries.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </Field>

                  {stateOptions.length > 0 && (
                    <ChipField
                      label="States / regions"
                      hint="Narrow to specific states. Picking a state tailors the language options below to that region."
                      options={stateOptions}
                      selected={form.state_regions}
                      onToggle={(v) => toggle('state_regions', v)}
                    />
                  )}
                </div>
              </div>
              <ChipField
                label="Languages"
                hint={
                  form.state_regions.length > 0 || selectedCountryName
                    ? 'Required — languages the talent should be fluent in, tuned to your chosen location. Pick all that apply.'
                    : 'Required — languages the talent should be fluent in. Pick all that apply.'
                }
                required
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

// Sticky summary of what the brief is for — the selected service category
// (Designer / Editor / hybrid) plus product (Subscription vs Assignment).
// Mirrored on the admin form-creation view and SquadHire talent view so the
// category is always the first thing anyone sees.
function CategoryBanner({
  product, roles, onEdit,
}: {
  product: 'subscription' | 'assignment';
  roles: { slug: RoleSlug; title: string }[];
  onEdit: () => void;
}) {
  return (
    <div className="connect-category-banner">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7A7568]">
          {product === 'assignment' ? 'Assignment brief' : 'Subscription brief'} · Category
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {roles.length === 0 ? (
            <span className="text-sm text-[#7A7568]">No category selected</span>
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
      <button type="button" onClick={onEdit} className="connect-category-edit">
        Change
      </button>
    </div>
  );
}

// Big numbered divider that splits the form into its two top-level groups:
// Business details vs Requirement details.
function GroupHeader({
  index, title, subtitle,
}: { index: number; title: string; subtitle: string }) {
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

// Record / play / re-record a short voice note using the browser's
// MediaRecorder. Fully client-side here — the blob is handed to the parent
// via onChange; upload + persistence lands once the design is approved.
function AudioNote({
  audioUrl, onChange,
}: {
  audioUrl: string | null;
  onChange: (blob: Blob | null, url: string | null) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function fmt(s: number) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  }

  // In-browser recording needs a secure context + getUserMedia. Many mobile
  // in-app browsers / WebViews don't grant the mic — the file/native-recorder
  // fallback below covers those.
  const canRecord =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    (typeof window === 'undefined' || window.isSecureContext);

  function pickFile() {
    setError('');
    fileInputRef.current?.click();
  }

  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('audio/')) { setError('Please choose an audio file.'); return; }
    setError('');
    onChange(file, URL.createObjectURL(file));
  }

  async function start() {
    setError('');
    if (!canRecord) {
      // No in-browser recording here — hand off to the OS recorder/file picker.
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
        const url = URL.createObjectURL(blob);
        onChange(blob, url);
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (e) {
      const name = (e as { name?: string })?.name || '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setError('Microphone permission is off. Allow it in your browser settings — or use “Upload audio” to record with your phone instead.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setError('No microphone found. Use “Upload audio” to attach a recording instead.');
      } else {
        setError('Couldn’t start recording here. Use “Upload audio” to record with your phone instead.');
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

  return (
    <div className="rounded-xl border border-[#E0DCCE] bg-white p-4">
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

      {error && <p className="mt-2 text-xs font-medium text-[#8B3A1A]">{error}</p>}
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

/* Selected-category banner — sticky at the top of Step 2 so the brief's
   category stays visible while scrolling. */
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

/* Voice-note recorder controls */
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
