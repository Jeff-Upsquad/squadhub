// Shared types + formatting helpers for the admin Sales Dashboard.
// Periods are resolved server-side (utils/salesPeriod) from these query
// params; the client only steps cursors and mirrors the label.

export type PeriodType = 'week' | 'month' | 'custom';

export type PeriodQuery = {
  period_type: PeriodType;
  /** week → any date in the week (server normalizes to Monday); month → 'YYYY-MM'. */
  anchor?: string;
  start?: string;
  end?: string;
};

export type Period = {
  period_type: PeriodType;
  anchor: string;
  label: string;
  start_ist: string;
  end_ist: string;
  start_utc: string;
  end_utc: string;
};

export type Stats = {
  leads_created: number;
  calls_total: number;
  calls_answered: number;
  calls_no_answer: number;
  leads_to_deals: number;
  deals_converted: number;
  deals_closed: number;
  revenue_closed: number;
};

export type Funnel = { leads: number; deals: number; converted: number; closed: number };

export type MetricKey = 'calls_made' | 'leads_converted' | 'deals_converted' | 'deals_closed' | 'revenue';

export type TargetCell = { target: number; actual: number; pct: number };

export type Targets = Partial<Record<MetricKey, TargetCell>> | null;

export type UserLite = {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export type MemberRow = { user: UserLite; stats: Stats; targets: Targets };

export const METRIC_KEYS: MetricKey[] = [
  'calls_made',
  'leads_converted',
  'deals_converted',
  'deals_closed',
  'revenue',
];

export const METRIC_LABELS: Record<MetricKey, string> = {
  calls_made: 'Calls made',
  leads_converted: 'Lead → Deal',
  deals_converted: 'Converted',
  deals_closed: 'Closed',
  revenue: 'Revenue',
};

// Metrics the records drill-through supports (server: GET /records).
// The Revenue card reuses 'deals_closed' — same rows, values shown.
export type RecordMetric =
  | 'leads_created'
  | 'calls'
  | 'leads_to_deals'
  | 'deals_converted'
  | 'deals_closed';

export type MetricRecord = {
  kind: 'lead' | 'call';
  id: string;
  lead_id: string;
  name: string | null;
  phone: string | null;
  outcome?: 'answered' | 'no_answer';
  note?: string | null;
  deal_value?: number | null;
  product?: string | null;
  source?: string | null;
  event_at: string;
  user_name: string | null;
  became_deal_at?: string | null;
  converted_at?: string | null;
  closed_at?: string | null;
};

export function crmLeadUrl(base: string, leadId: string): string {
  return `${base}/app/leads/${leadId}`;
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function zeroStats(): Stats {
  return {
    leads_created: 0,
    calls_total: 0,
    calls_answered: 0,
    calls_no_answer: 0,
    leads_to_deals: 0,
    deals_converted: 0,
    deals_closed: 0,
    revenue_closed: 0,
  };
}

export function periodQueryString(p: PeriodQuery): string {
  const params = new URLSearchParams();
  params.set('period_type', p.period_type);
  if (p.anchor) params.set('anchor', p.anchor);
  if (p.start) params.set('start', p.start);
  if (p.end) params.set('end', p.end);
  return params.toString();
}

/** Metric amounts are whole INR units (matches Gross Profit) — do NOT /100. */
export function formatMoney(amount: number): string {
  return '₹' + (amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export function formatPct(pct: number): string {
  return `${Math.round(pct)}%`;
}

/** "12/45 · 27%" — count vs base with the conversion percentage. */
export function ratioCell(part: number, whole: number): string {
  const pct = whole > 0 ? Math.round((part / whole) * 100) : 0;
  return `${part}/${whole} · ${pct}%`;
}

/** Pure calendar math on 'YYYY-MM-DD' strings (no timezone drift). */
export function addDaysStr(dateStr: string, days: number): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Monday of the week containing dateStr. */
export function mondayOf(dateStr: string): string {
  const dow = new Date(Date.parse(`${dateStr}T00:00:00Z`)).getUTCDay(); // 0=Sun..6=Sat
  return addDaysStr(dateStr, -((dow + 6) % 7));
}

export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "Jul 6 – 12, 2026" — mirrors the server's week/custom label formatting. */
export function rangeLabel(start: string, end: string): string {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  if (!sy || !ey) return `${start} – ${end}`;
  if (sy === ey && sm === em) return `${MONTHS_SHORT[sm - 1]} ${sd} – ${ed}, ${sy}`;
  if (sy === ey) return `${MONTHS_SHORT[sm - 1]} ${sd} – ${MONTHS_SHORT[em - 1]} ${ed}, ${sy}`;
  return `${MONTHS_SHORT[sm - 1]} ${sd}, ${sy} – ${MONTHS_SHORT[em - 1]} ${ed}, ${ey}`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS_SHORT[m - 1]} ${d}, ${y}`;
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function displayName(user: UserLite | null | undefined): string {
  return user?.display_name || user?.email || 'Unknown user';
}
