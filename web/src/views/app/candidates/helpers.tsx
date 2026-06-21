import type { CandidateListItem, CandidatePermission } from '@squadhub/shared';

// ---- Permission tiers (mirror the server's candidate access engine) ----------
const PERM_RANK: Record<CandidatePermission, number> = { view: 1, edit: 2, full: 3 };
/** True when `level` is present and meets or exceeds `min` (view < edit < full). */
export function meetsLevel(level: CandidatePermission | undefined, min: CandidatePermission): boolean {
  return !!level && PERM_RANK[level] >= PERM_RANK[min];
}
/** Can change status, add/edit notes, mark reviewed. */
export const canEdit = (level: CandidatePermission | undefined): boolean => meetsLevel(level, 'edit');
/** Can delete / restore — the most privileged tier. */
export const canManage = (level: CandidatePermission | undefined): boolean => meetsLevel(level, 'full');

// Status → human label (ported from SquadHire's Candidates module).
export const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  share_form: 'Share Form',
  form_filled: 'Form Filled',
  under_review: 'Under Review',
  shortlisted: 'Shortlisted',
  signed_up: 'Signed Up',
  partner_onboarding: 'Onboarding',
  onboarding_training: 'Onboarding Training',
  basic_profile: 'Basic Profile',
  job_profile: 'Job Profile',
  portfolio_updation: 'Portfolio Updation',
  final_review: 'Final Review',
  onboard_completed: 'Completed',
  live: 'Live',
  no_response: 'No Response',
  archived: 'Archived',
  contacted: 'Contacted',
  converted: 'Converted',
  rejected: 'Rejected',
};

// Status → chip tone (works in light + dark via /10 backgrounds).
export type Tone = 'blue' | 'amber' | 'green' | 'red' | 'violet' | 'gray';
export const STATUS_TONE: Record<string, Tone> = {
  new: 'blue',
  share_form: 'blue',
  form_filled: 'amber',
  under_review: 'amber',
  shortlisted: 'violet',
  signed_up: 'violet',
  partner_onboarding: 'amber',
  onboarding_training: 'amber',
  basic_profile: 'amber',
  job_profile: 'blue',
  portfolio_updation: 'blue',
  final_review: 'violet',
  onboard_completed: 'green',
  live: 'green',
  no_response: 'gray',
  archived: 'gray',
  contacted: 'amber',
  converted: 'green',
  rejected: 'red',
};

export const TONE_CLASS: Record<Tone, string> = {
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  red: 'bg-red-500/10 text-red-600 dark:text-red-400',
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  gray: 'bg-foreground/10 text-foreground-muted',
};

// Status options offered in the list filter.
export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'partner_onboarding', label: 'Onboarding' },
  { value: 'onboard_completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

// Stage pills shown in the detail panel (ported from SquadHire's StatusTabs).
// Creative candidates follow a longer flow than everyone else.
export interface StageDef {
  value: string;
  label: string;
  tone: Tone;
}
export const DEFAULT_STAGES: StageDef[] = [
  { value: 'new', label: 'New', tone: 'blue' },
  { value: 'under_review', label: 'Under Review', tone: 'amber' },
  { value: 'shortlisted', label: 'Shortlisted', tone: 'violet' },
  { value: 'partner_onboarding', label: 'Onboarding', tone: 'amber' },
  { value: 'onboard_completed', label: 'Completed', tone: 'green' },
  { value: 'archived', label: 'Archived', tone: 'red' },
];
export const CREATIVE_STAGES: StageDef[] = [
  { value: 'new', label: 'New', tone: 'blue' },
  { value: 'share_form', label: 'Share Form', tone: 'blue' },
  { value: 'form_filled', label: 'Form Filled / For Review', tone: 'amber' },
  { value: 'shortlisted', label: 'Shortlisted', tone: 'violet' },
  { value: 'signed_up', label: 'Signed Up', tone: 'violet' },
  { value: 'onboarding_training', label: 'Onboarding Training', tone: 'amber' },
  { value: 'basic_profile', label: 'Basic Profile', tone: 'amber' },
  { value: 'job_profile', label: 'Job Profile', tone: 'blue' },
  { value: 'portfolio_updation', label: 'Portfolio Updation', tone: 'blue' },
  { value: 'final_review', label: 'Final Review', tone: 'violet' },
  { value: 'live', label: 'Live', tone: 'green' },
  { value: 'no_response', label: 'No Response / In Active', tone: 'gray' },
];
export function stagesFor(formType: string): StageDef[] {
  return formType === 'creative' ? CREATIVE_STAGES : DEFAULT_STAGES;
}

export interface CategoryCard {
  value: string;
  label: string;
  description: string;
}
export const CATEGORY_CARDS: CategoryCard[] = [
  { value: 'creative', label: 'Creative', description: 'Designers, video editors, and other creative roles.' },
  { value: 'accountant', label: 'Accountant', description: 'Bookkeeping, audit, tax, and finance professionals.' },
  { value: 'sales', label: 'Sales', description: 'Sales, business development, and account management professionals.' },
];
export const CATEGORY_LABELS: Record<string, string> = {
  creative: 'Creative',
  accountant: 'Accountant',
  sales: 'Sales',
};

// Application-field labels (ported) for the read-only detail section.
export const FIELD_LABELS: Record<string, string> = {
  role: 'Role',
  portfolio_link: 'Portfolio Link',
  age: 'Age',
  gender: 'Gender',
  native_place: 'Native Place',
  district: 'District',
  location: 'Location',
  work_type: 'Type of Work',
  education: 'Educational Qualifications',
  experience_years: 'Years of Experience',
  accounting_software: 'Accounting Software',
  addon_skills: 'Add-on Skills',
  current_salary: 'Current Salary / month',
  expected_salary: 'Expected Salary / month',
  languages: 'Languages',
  experience_details: 'Details of Experience',
  resume_url: 'Resume URL',
  country: 'Country',
  state: 'State',
  current_district: 'District',
  work_type_seeking: 'Looking For',
  industry_experience: 'Industry Experience',
};

export function formatFieldValue(key: string, value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' && key.includes('salary')) {
    return `₹${value.toLocaleString('en-IN')}`;
  }
  return String(value);
}

export function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/** Digits-only for tel:/wa.me links. */
export function cleanPhone(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  // Indian numbers often arrive without the country code; assume +91 for 10-digit.
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export function formatPhone(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (local.length === 10) return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
  return phone;
}

// ---- Time-bucket grouping (ported from SquadHire) ---------------------------
export interface CandidateBucket<T extends CandidateListItem = CandidateListItem> {
  key: string;
  label: string;
  items: T[];
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Buckets newest-first items into Today / Yesterday / weekday / month sections. */
export function groupByBucket<T extends CandidateListItem>(items: T[]): CandidateBucket<T>[] {
  if (!items.length) return [];
  const now = new Date();
  const todayStart = startOfDay(now);
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const buckets = new Map<string, CandidateBucket<T>>();
  const pushTo = (key: string, label: string, item: T) => {
    let b = buckets.get(key);
    if (!b) {
      b = { key, label, items: [] };
      buckets.set(key, b);
    }
    b.items.push(item);
  };

  for (const item of items) {
    const d = new Date(item.created_at);
    const diffDays = Math.floor((todayStart.getTime() - startOfDay(d).getTime()) / 86_400_000);
    if (diffDays <= 0) pushTo('day-today', 'Today', item);
    else if (diffDays === 1) pushTo('day-yesterday', 'Yesterday', item);
    else if (diffDays <= 6) pushTo(`day-${diffDays}`, d.toLocaleDateString('en-US', { weekday: 'long' }), item);
    else if (d >= startOfThisMonth) pushTo('this-month', 'Earlier this month', item);
    else {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      pushTo(key, `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`, item);
    }
  }
  return Array.from(buckets.values());
}

export function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}
