'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';
import { showToast } from '@/components/Toast';
import PartnerPaymentsPreview from './PartnerPaymentsPreview';

type Status = 'active' | 'ended' | 'all';

interface AssignmentTerm {
  id: string;
  card_id: string;
  recipient_type: 'talent' | 'partner';
  recipient_id: string;
  recipient_name: string | null;
  business_name: string | null;
  subscription_name: string | null;
  assigned_date: string;
  unassigned_date: string | null;
  work_start_date: string | null;
  work_end_date: string | null;
  status: 'active' | 'ended';
  // Card lifecycle attached by the API so paused/cancelled engagements badge
  // correctly (their terms read 'ended', which alone is ambiguous).
  card_state?: string | null;
  card_paused_at?: string | null;
  card_cancelled_at?: string | null;
  // Month-scoped enrichment — present when the list is fetched with ?month=.
  start_date?: string | null;
  stop_date?: string | null;
  month_active_days?: number;
  month_payment?: number;
  partner_price?: number | null;
  currency?: string | null;
  missing_partner_price?: boolean;
  committed_hours?: { daily: number | null; weekly: number | null; monthly: number | null };
  plan_name?: string | null;
  plan_label?: string | null;
  plan_tier?: string | null;
  // Monthly hours completion (per card): plan target vs. tracked+elapsed actual.
  additional_hours?: number;
  additional_payment?: number;
  actual_hours?: number;
  target_hours_this_month?: number;
}

/** Paused/Cancelled chip for a term's card (null when neither applies). */
function CardLifecycleChip({
  term,
}: {
  term: { card_paused_at?: string | null; card_cancelled_at?: string | null; card_state?: string | null };
}) {
  if (term.card_paused_at) {
    return (
      <span className="ml-1.5 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
        Paused
      </span>
    );
  }
  if (term.card_cancelled_at || term.card_state === 'closed') {
    return (
      <span className="ml-1.5 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
        Cancelled
      </span>
    );
  }
  return null;
}

function fmtTimestamp(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  // d is a plain YYYY-MM-DD calendar date.
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMoney(amount: number, currency: string | null) {
  // TEMP: force all payments/clients to INR (Rs) for now.
  const cur = 'INR';
  if (cur === 'INR') return '₹' + (amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  if (cur === 'USD') return '$' + (amount || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return `${cur ? cur + ' ' : ''}${(amount || 0).toLocaleString()}`;
}

function formatPayments(payments: { currency: string; amount: number }[]) {
  if (!payments || payments.length === 0) return '—';
  return payments.map((p) => formatMoney(p.amount, p.currency)).join(' + ');
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Shift a YYYY-MM key by `delta` months (delta can be negative).
function shiftMonth(key: string, delta: number) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Sum per-currency payment buckets across many payment lists into one total list.
// TEMP: force all payments/clients to INR (Rs) for now — collapse to single bucket.
function aggregatePayments(lists: { currency: string; amount: number }[][]) {
  const totals = new Map<string, number>();
  for (const list of lists) {
    for (const p of list || []) totals.set('INR', (totals.get('INR') || 0) + p.amount);
  }
  return [...totals.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => b.amount - a.amount);
}

// ============================================================
// Client grouping: fold a card·talent's multiple in-month periods (pause/resume,
// plan change → several term rows) into one row, each period kept for the
// click-to-expand breakdown. Shared by the By-subscription tab and the
// partner / talent detail modal.
// ============================================================

interface Period {
  term_id: string;
  start_date: string | null;
  stop_date: string | null;
  active_days: number;
  status: 'active' | 'ended';
  // Per-period plan identity + prorated pay — so a multi-period breakdown (plan
  // change / pause-resume) shows what each slice was on and what it earned.
  plan_label: string | null;
  plan_tier: string | null;
  payment: number;
  currency: string | null;
  missing_partner_price: boolean;
}

interface ClientGroup {
  key: string;
  card_id: string;
  recipient_type: 'talent' | 'partner';
  recipient_id: string;
  recipient_name: string | null;
  business_name: string | null;
  subscription_name: string | null;
  status: 'active' | 'ended';
  card_state?: string | null;
  card_paused_at?: string | null;
  card_cancelled_at?: string | null;
  periods: Period[];
  total_active_days: number;
  payments: { currency: string; amount: number }[];
  partner_price: number | null;
  currency: string | null;
  missing_partner_price: boolean;
  committed_hours: { daily: number | null; weekly: number | null; monthly: number | null };
  plan_name: string | null;
  // Hours completion for the card (identical across its periods → set once).
  additional_hours: number;
  additional_payment: number;
  actual_hours: number;
  target_hours: number;
}

// Row shape shared by the enriched By-subscription term and the detail card.
interface PeriodInput {
  card_id: string;
  business_name: string | null;
  subscription_name: string | null;
  status: 'active' | 'ended';
  start_date: string | null;
  stop_date: string | null;
  month_active_days: number;
  month_payment: number;
  partner_price: number | null;
  currency: string | null;
  missing_partner_price: boolean;
  committed_hours: { daily: number | null; weekly: number | null; monthly: number | null };
  plan_name?: string | null;
  plan_label?: string | null;
  plan_tier?: string | null;
  additional_hours?: number;
  additional_payment?: number;
  actual_hours?: number;
  target_hours_this_month?: number;
  term_id?: string;
  id?: string;
  recipient_type?: 'talent' | 'partner';
  recipient_id?: string;
  recipient_name?: string | null;
  card_state?: string | null;
  card_paused_at?: string | null;
  card_cancelled_at?: string | null;
}

// Rows arrive newest-first (assigned_date desc); the first row per key supplies
// the representative plan / price (i.e. the current one). Periods are re-sorted
// oldest-first for a readable timeline.
function groupIntoClients(rows: PeriodInput[], keyOf: (r: PeriodInput) => string): ClientGroup[] {
  const map = new Map<string, ClientGroup>();
  for (const r of rows) {
    const key = keyOf(r);
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        card_id: r.card_id,
        recipient_type: r.recipient_type ?? 'talent',
        recipient_id: r.recipient_id ?? '',
        recipient_name: r.recipient_name ?? null,
        business_name: r.business_name,
        subscription_name: r.subscription_name,
        status: 'ended',
        card_state: r.card_state ?? null,
        card_paused_at: r.card_paused_at ?? null,
        card_cancelled_at: r.card_cancelled_at ?? null,
        periods: [],
        total_active_days: 0,
        payments: [],
        partner_price: r.partner_price,
        currency: r.currency,
        missing_partner_price: r.missing_partner_price,
        committed_hours: r.committed_hours,
        plan_name: r.plan_name ?? null,
        // Set once per card (identical across its in-month periods).
        additional_hours: r.additional_hours ?? 0,
        additional_payment: r.additional_payment ?? 0,
        actual_hours: r.actual_hours ?? 0,
        target_hours: r.target_hours_this_month ?? 0,
      };
      map.set(key, g);
    }
    g.periods.push({
      term_id: r.term_id ?? r.id ?? `${key}:${g.periods.length}`,
      start_date: r.start_date,
      stop_date: r.stop_date,
      active_days: r.month_active_days,
      status: r.status,
      plan_label: r.plan_label ?? null,
      plan_tier: r.plan_tier ?? null,
      payment: r.month_payment,
      currency: r.currency,
      missing_partner_price: r.missing_partner_price,
    });
    g.total_active_days += r.month_active_days || 0;
    if (r.status === 'active') g.status = 'active';
    if (r.missing_partner_price) g.missing_partner_price = true;
    if (r.month_payment > 0) {
      // TEMP: force INR.
      const cur = 'INR';
      const existing = g.payments.find((p) => p.currency === cur);
      if (existing) existing.amount += r.month_payment;
      else g.payments.push({ currency: cur, amount: r.month_payment });
    }
  }
  for (const g of map.values()) {
    g.periods.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
  }
  return [...map.values()];
}

function partnerPriceLabel(g: { missing_partner_price: boolean; partner_price: number | null; currency: string | null }) {
  return g.missing_partner_price ? '—' : `${formatMoney(g.partner_price || 0, g.currency)}/mo`;
}

// Signed hours-delta chip: +2.5 hrs (emerald overage) / −1 hrs (red shortfall) /
// — at 0. Tooltip shows the actual vs. target hours behind the delta.
function HoursDeltaChip({ hours, actual, target }: { hours: number; actual?: number; target?: number }) {
  if (!hours) return <span className="text-foreground-dim">—</span>;
  const up = hours > 0;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
        up ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
      }`}
      title={actual != null && target != null ? `Actual ${actual} hrs vs target ${target} hrs` : undefined}
    >
      {up ? '+' : '−'}
      {Math.abs(hours)} hrs
    </span>
  );
}

// Fold a signed additional payment into the base per-currency payment buckets.
function combinePayments(
  payments: { currency: string; amount: number }[],
  additionalPayment: number,
  currency: string | null,
) {
  if (!additionalPayment) return payments;
  // TEMP: force INR.
  const cur = 'INR';
  const out = payments.map((p) => ({ ...p }));
  const hit = out.find((p) => p.currency === cur);
  if (hit) hit.amount += additionalPayment;
  else out.push({ currency: cur, amount: additionalPayment });
  return out.filter((p) => p.amount !== 0);
}

// Plan details line shown below the client name (role · tier · d·w·m hours).
// Replaces the old standalone Plan column — the table now carries:
// Client (with plan below) · Active days · Partner price · Monthly total (base)
// · Additional days/hours · Less hours/days · Final payout.
function planDetailsLine(
  role: string | null,
  tier: string | null,
  hours: { daily: number | null; weekly: number | null; monthly: number | null },
) {
  const head = role || tier || '—';
  const tail = `${role && tier ? `${tier} · ` : ''}${hrs(hours.daily)} · ${hrs(hours.weekly)} · ${hrs(hours.monthly)} hrs d·w·m`;
  return { head, tail };
}

function ClientCell({
  business,
  chip,
  recipientLine,
  role,
  tier,
  hours,
}: {
  business: string;
  chip?: ReactNode;
  recipientLine?: string | null;
  role: string | null;
  tier: string | null;
  hours: { daily: number | null; weekly: number | null; monthly: number | null };
}) {
  const plan = planDetailsLine(role, tier, hours);
  return (
    <div>
      <div className="font-medium text-foreground">
        {business}
        {chip}
      </div>
      {recipientLine && <div className="text-xs text-foreground-dim">{recipientLine}</div>}
      <div className="mt-0.5 text-xs text-foreground-dim">
        {plan.head} · {plan.tail}
      </div>
    </div>
  );
}

// Split adjustment cell: hours (or days, when supplied) on line 1, the money
// it moves on line 2. `direction="add"` renders only positive deltas, "less"
// only negative ones — the other side shows a dash so the two columns read
// as Additional days/hours | Less hours/days. Kept as a field even while
// overages pay ₹0 (one-sided rule) for future use.
function AdjustmentCell({
  hours,
  payment,
  currency,
  direction,
  actual,
  target,
}: {
  hours: number;
  payment: number;
  currency: string | null;
  direction: 'add' | 'less';
  actual?: number;
  target?: number;
}) {
  const isAdd = direction === 'add';
  const active = isAdd ? hours > 0 : hours < 0;
  if (!active)
    return <span className="text-foreground-dim">—</span>;
  const absHrs = Math.abs(hours);
  const absPay = Math.abs(payment);
  const title =
    actual != null && target != null ? `Actual ${actual} hrs vs target ${target} hrs` : undefined;
  if (isAdd) {
    return (
      <div title={title}>
        <div className="font-medium text-emerald-600">
          +{absHrs} {absHrs === 1 ? 'hr' : 'hrs'}
        </div>
        <div
          className={`text-[11px] tabular-nums ${absPay === 0 ? 'text-foreground-dim' : 'text-emerald-600'}`}
          title={absPay === 0 ? 'Extra hours currently earn no additional pay' : undefined}
        >
          +{formatMoney(absPay, currency)}
        </div>
      </div>
    );
  }
  return (
    <div title={title}>
      <div className="font-medium text-red-600">
        −{absHrs} {absHrs === 1 ? 'hr' : 'hrs'}
      </div>
      <div className="text-[11px] tabular-nums text-red-600">−{formatMoney(absPay, currency)}</div>
    </div>
  );
}

// Monthly total: the prorated base before any hours adjustment.
function MonthlyTotalCell({ payments }: { payments: { currency: string; amount: number }[] }) {
  return <div className="tabular-nums text-foreground-muted">{formatPayments(payments)}</div>;
}

// Final payout: base + adjustment (shortfall deduction, if any).
function FinalPayoutCell({
  payments,
  additionalPayment,
  currency,
}: {
  payments: { currency: string; amount: number }[];
  additionalPayment: number;
  currency: string | null;
}) {
  const combined = combinePayments(payments, additionalPayment, currency);
  return <div className="font-medium tabular-nums text-foreground">{formatPayments(combined)}</div>;
}

// Clickable active-days button + count/period badge.
function ActiveDaysButton({
  group,
  expanded,
  onToggle,
}: {
  group: ClientGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="inline-flex items-center gap-1.5 font-medium text-foreground hover:text-indigo-600"
      title="Show start / stop periods"
    >
      {group.total_active_days} {group.total_active_days === 1 ? 'day' : 'days'}
      {group.periods.length > 1 && (
        <span className="rounded-full bg-indigo-50 px-1.5 text-[10px] font-semibold text-indigo-600">
          {group.periods.length} periods
        </span>
      )}
      <span className="text-foreground-dim">{expanded ? '▾' : '▸'}</span>
    </button>
  );
}

// "Plan band · tier" for a period — the frozen plan identity that tells one
// slice apart from the next after an upgrade/downgrade. Falls back to whichever
// part exists; empty string when the term carries neither.
function planLabel(p: { plan_label: string | null; plan_tier: string | null }): string {
  return [p.plan_label, p.plan_tier].filter(Boolean).join(' · ');
}

// Expanded breakdown of the start–stop period(s) that made up the month's
// active days (more than one when the card was paused/resumed or the plan was
// changed). Each period also shows the plan it ran on and the pay it earned, so
// an upgrade/downgrade reads as e.g. "Basic · Pro … ₹6,000" then "Plus · Pro … ₹11,000".
function PeriodBreakdown({
  periods,
  onEdit,
  additionalHours = 0,
  additionalPayment = 0,
  currency = null,
}: {
  periods: Period[];
  onEdit?: (termId: string) => void;
  additionalHours?: number;
  additionalPayment?: number;
  currency?: string | null;
}) {
  return (
    <div className="space-y-1.5 rounded-md bg-surface-alt px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-foreground-dim">
        {periods.length > 1 ? `${periods.length} active periods this month` : 'Active period this month'}
      </div>
      {periods.map((p) => {
        const plan = planLabel(p);
        return (
          <div key={p.term_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="text-foreground">
              {fmtDate(p.start_date)} – {p.stop_date ? fmtDate(p.stop_date) : 'now'}
            </span>
            <span className="text-xs text-foreground-dim">
              · {p.active_days} {p.active_days === 1 ? 'day' : 'days'}
            </span>
            {p.status === 'active' && (
              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                active
              </span>
            )}
            {plan && (
              <span className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-medium text-foreground-muted ring-1 ring-divider">
                {plan}
              </span>
            )}
            <span className="ml-auto font-medium text-foreground">
              {p.missing_partner_price ? '—' : formatMoney(p.payment, p.currency)}
            </span>
            {onEdit && (
              <button
                onClick={() => onEdit(p.term_id)}
                className="text-xs font-medium text-indigo-600 hover:underline"
              >
                Edit dates
              </button>
            )}
          </div>
        );
      })}
      {additionalHours !== 0 && (
        <div className="flex items-center gap-2 border-t border-divider pt-1.5 text-sm">
          <span className="text-[11px] font-medium uppercase tracking-wide text-foreground-dim">
            Additional this month
          </span>
          <HoursDeltaChip hours={additionalHours} />
          <span className={`ml-auto font-medium ${additionalPayment >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {additionalPayment > 0 ? '+' : additionalPayment < 0 ? '−' : ''}
            {formatMoney(Math.abs(additionalPayment), currency)}
          </span>
        </div>
      )}
    </div>
  );
}

type ViewMode = 'subscription' | 'user' | 'partner';

export default function AdminSubscriptionAssignments() {
  const [view, setView] = useState<ViewMode>('user');
  const [month, setMonth] = useState<string>(currentMonthKey());
  // Deep-link target when jumping from the By-user list into the Partner view
  // preview (select a user → see exactly what that partner sees).
  const [previewRecipientId, setPreviewRecipientId] = useState<string>('');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Partner Payments</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {view === 'user'
              ? 'Each partner / talent and the subscriptions they’re serving — with the monthly payment owed and an hours snapshot.'
              : view === 'partner'
                ? 'Select a partner / talent to preview exactly what they see in the Partner Payments mini app — same data, same layout.'
                : 'Each talent serving a client’s subscription in the selected month — active days (click for each start / stop period), the prorated pay owed, and the plan.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {view !== 'partner' && (
            <div className="flex items-center gap-1 rounded-md border border-divider bg-surface px-1 py-0.5">
              <button
                type="button"
                onClick={() => setMonth(shiftMonth(month, -1))}
                className="rounded px-1.5 py-1 text-sm text-foreground-muted hover:bg-canvas hover:text-foreground"
                aria-label="Previous month"
                title="Previous month"
              >
                ←
              </button>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value || currentMonthKey())}
                className="border-none bg-transparent px-1 py-1 text-sm outline-none focus:border-slate-400"
                aria-label="Billing month"
              />
              <button
                type="button"
                onClick={() => setMonth(shiftMonth(month, 1))}
                disabled={month >= currentMonthKey()}
                className="rounded px-1.5 py-1 text-sm text-foreground-muted hover:bg-canvas hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                aria-label="Next month"
                title={month >= currentMonthKey() ? 'Already at current month' : 'Next month'}
              >
                →
              </button>
            </div>
          )}
          <div className="flex gap-1 rounded-lg border border-divider bg-surface p-1">
            {(['user', 'subscription', 'partner'] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  view === v ? 'bg-slate-900 text-white' : 'text-foreground-muted hover:bg-canvas'
                }`}
              >
                {v === 'user' ? 'By user' : v === 'subscription' ? 'By subscription' : 'Partner view'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === 'user' ? (
        <ByUserView
          month={month}
          onPreviewPartner={(recipientId) => {
            setPreviewRecipientId(recipientId);
            setView('partner');
          }}
        />
      ) : view === 'partner' ? (
        <PartnerPaymentsPreview initialRecipientId={previewRecipientId} onRecipientChange={setPreviewRecipientId} />
      ) : (
        <BySubscriptionView month={month} />
      )}
    </div>
  );
}

function BySubscriptionView({ month }: { month: string }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<Status>('active');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: listRes, isLoading } = useQuery({
    queryKey: ['admin-subscription-assignments', month, statusFilter, search],
    queryFn: () =>
      api
        .get('/admin/subscription-assignments', {
          params: { month, status: statusFilter, search: search || undefined },
        })
        .then((r) => r.data),
  });
  const rows: AssignmentTerm[] = listRes?.data || [];
  // One row per client·talent; pause/resume + plan-change periods fold together.
  const groups = groupIntoClients(
    rows as unknown as PeriodInput[],
    (r) => `${r.card_id}:${r.recipient_type}:${r.recipient_id}`,
  );
  const editingTerm = editingId ? rows.find((r) => r.id === editingId) ?? null : null;

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-6">

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-divider bg-surface p-3">
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {(['all', 'active'] as Status[]).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ${
                  statusFilter === s ? 'bg-slate-900 text-white' : 'text-foreground-muted hover:bg-canvas'
                }`}
              >
                {s === 'active' ? 'Active' : 'All'}
              </button>
            ))}
          </div>
          <span className="text-xs text-foreground-dim">Billing month: {monthLabel(month)}</span>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search talent or business…"
          className="w-64 rounded-md border border-divider bg-surface px-3 py-1.5 text-sm outline-none focus:border-slate-400"
        />
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-foreground-dim">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-divider bg-surface py-12 text-center">
          <p className="text-sm text-foreground-dim">
            No {statusFilter === 'active' ? 'active ' : ''}subscriptions in {monthLabel(month)}.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-divider bg-surface">
          <table className="w-full">
            <thead className="bg-surface-alt text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-4 py-2.5">Client name</th>
                <th className="px-4 py-2.5">Active days</th>
                <th className="px-4 py-2.5">Partner price</th>
                <th className="px-4 py-2.5">Monthly total</th>
                <th className="px-4 py-2.5">Additional days/hours</th>
                <th className="px-4 py-2.5">Less hours/days</th>
                <th className="px-4 py-2.5">Final payout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-foreground">
              {groups.map((g) => (
                <Fragment key={g.key}>
                  <tr>
                    <td className="px-4 py-2.5">
                      <ClientCell
                        business={g.business_name || '—'}
                        chip={<CardLifecycleChip term={g} />}
                        recipientLine={`${g.recipient_name || g.recipient_id || '—'}${g.recipient_type === 'partner' ? ' (partner)' : ''}`}
                        role={g.plan_name}
                        tier={g.subscription_name}
                        hours={g.committed_hours}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <ActiveDaysButton group={g} expanded={expanded.has(g.key)} onToggle={() => toggle(g.key)} />
                    </td>
                    <td className="px-4 py-2.5 text-foreground-muted">{partnerPriceLabel(g)}</td>
                    <td className="px-4 py-2.5">
                      <MonthlyTotalCell payments={g.payments} />
                    </td>
                    <td className="px-4 py-2.5">
                      <AdjustmentCell
                        hours={g.additional_hours}
                        payment={g.additional_payment}
                        currency={g.currency}
                        direction="add"
                        actual={g.actual_hours}
                        target={g.target_hours}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <AdjustmentCell
                        hours={g.additional_hours}
                        payment={g.additional_payment}
                        currency={g.currency}
                        direction="less"
                        actual={g.actual_hours}
                        target={g.target_hours}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <FinalPayoutCell
                        payments={g.payments}
                        additionalPayment={g.additional_payment}
                        currency={g.currency}
                      />
                    </td>
                  </tr>
                  {expanded.has(g.key) && (
                    <tr>
                      <td colSpan={7} className="px-4 pb-3 pt-0">
                        <PeriodBreakdown
                          periods={g.periods}
                          onEdit={(termId) => setEditingId(termId)}
                          additionalHours={g.additional_hours}
                          additionalPayment={g.additional_payment}
                          currency={g.currency}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingTerm && (
        <EditDatesModal
          term={editingTerm}
          onClose={() => setEditingId(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['admin-subscription-assignments'] })}
        />
      )}
    </div>
  );
}

function EditDatesModal({
  term,
  onClose,
  onSaved,
}: {
  term: AssignmentTerm;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [workStart, setWorkStart] = useState(term.work_start_date ?? '');
  const [workEnd, setWorkEnd] = useState(term.work_end_date ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setWorkStart(term.work_start_date ?? '');
    setWorkEnd(term.work_end_date ?? '');
  }, [term.id]);

  const save = useMutation({
    mutationFn: () =>
      api
        .patch(`/admin/subscription-assignments/${term.id}`, {
          work_start_date: workStart || null,
          work_end_date: workEnd || null,
        })
        .then((r) => r.data),
    onSuccess: () => {
      showToast('Work dates updated.', 'success');
      onSaved();
      onClose();
    },
    onError: (err: any) => setError(err?.response?.data?.error || err.message || 'Save failed'),
  });

  const invalid = !!workStart && !!workEnd && workEnd < workStart;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-xl">
        <div className="mb-1 flex items-start justify-between">
          <h2 className="text-lg font-semibold text-foreground">Edit work dates</h2>
          <button onClick={onClose} className="text-foreground-dim hover:text-foreground-muted">
            ✕
          </button>
        </div>
        <p className="mb-4 text-sm text-foreground-muted">
          {term.recipient_name || 'Talent'} · {term.business_name || '—'}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Work start date</label>
            <input
              type="date"
              value={workStart}
              onChange={(e) => setWorkStart(e.target.value)}
              className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground-muted">Work end date</label>
            <input
              type="date"
              value={workEnd}
              onChange={(e) => setWorkEnd(e.target.value)}
              className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </div>
        </div>

        <div className="mt-3 rounded-md bg-surface-alt px-3 py-2 text-[11px] text-foreground-muted">
          Assigned {fmtTimestamp(term.assigned_date)} · Unassigned {fmtTimestamp(term.unassigned_date)} (auto-captured)
        </div>

        {invalid && (
          <p className="mt-2 text-xs text-red-600">Work end date can’t be before the start date.</p>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-divider px-4 py-2 text-sm font-medium text-foreground-muted hover:bg-surface-alt"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              setError(null);
              save.mutate();
            }}
            disabled={invalid || save.isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// By-user view: one row per recipient, payments + hours for the chosen month.
// ============================================================

interface Payment {
  currency: string;
  amount: number;
}

interface UserRow {
  recipient_type: 'talent' | 'partner';
  recipient_id: string;
  recipient_name: string | null;
  card_count: number;
  active_card_count: number;
  committed_weekly_hours: number;
  available_weekly_hours: number | null;
  utilization_pct: number | null;
  payments: Payment[];
  // Prorated base before hours adjustments (final = base + additional_payment).
  base_payments: Payment[];
  additional_payment: number;
  missing_pricing: boolean;
  // Net signed hours delta across the user's cards this month (payments already
  // include the money impact — this surfaces the hours behind it).
  additional_hours: number;
}

function UtilizationBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-foreground-dim">—</span>;
  const tone =
    pct > 100 ? 'bg-red-100 text-red-700' : pct >= 85 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700';
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{pct}%</span>;
}

function ByUserView({ month, onPreviewPartner }: { month: string; onPreviewPartner?: (recipientId: string) => void }) {
  const [statusFilter, setStatusFilter] = useState<Status>('active');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<UserRow | null>(null);

  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-subscription-assignments-users', month, statusFilter, search],
    queryFn: () =>
      api
        .get('/admin/subscription-assignments/users', {
          params: { month, status: statusFilter, search: search || undefined },
        })
        .then((r) => r.data),
  });
  const users: UserRow[] = res?.data?.users || [];

  // Overall totals across every user in the current list (the payout to make
  // this month, plus committed/available capacity).
  const totalPayout = aggregatePayments(users.map((u) => u.payments));
  const totalCommitted = users.reduce((s, u) => s + (u.committed_weekly_hours || 0), 0);
  const totalAvailable = users.reduce((s, u) => s + (u.available_weekly_hours || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-divider bg-surface p-3">
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {(['all', 'active'] as Status[]).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ${
                  statusFilter === s ? 'bg-slate-900 text-white' : 'text-foreground-muted hover:bg-canvas'
                }`}
              >
                {s === 'active' ? 'Active' : 'All'}
              </button>
            ))}
          </div>
          <span className="text-xs text-foreground-dim">Billing month: {monthLabel(month)}</span>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search partner / talent or business…"
          className="w-64 rounded-md border border-divider bg-surface px-3 py-1.5 text-sm outline-none focus:border-slate-400"
        />
      </div>

      {!isLoading && users.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryStat label={`${monthLabel(month)} total payout`} value={formatPayments(totalPayout)} />
          <SummaryStat label="Users" value={`${users.length}`} />
          <SummaryStat label="Total committed hrs/wk" value={`${Math.round(totalCommitted * 100) / 100}`} />
          <SummaryStat
            label="Total available hrs/wk"
            value={totalAvailable > 0 ? `${Math.round(totalAvailable * 100) / 100}` : '—'}
          />
        </div>
      )}

      {isLoading ? (
        <p className="py-8 text-center text-sm text-foreground-dim">Loading…</p>
      ) : users.length === 0 ? (
        <div className="rounded-lg border border-divider bg-surface py-12 text-center">
          <p className="text-sm text-foreground-dim">
            No {statusFilter === 'active' ? 'active ' : ''}subscriptions yet.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-divider bg-surface">
          <table className="w-full">
            <thead className="bg-surface-alt text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
              <tr>
                <th className="px-4 py-2.5">Partner / Talent</th>
                <th className="px-4 py-2.5">Active cards</th>
                <th className="px-4 py-2.5">Monthly total</th>
                <th className="px-4 py-2.5">Additional days/hours</th>
                <th className="px-4 py-2.5">Less hours/days</th>
                <th className="px-4 py-2.5">Final payout</th>
                <th className="px-4 py-2.5">Committed hrs/wk</th>
                <th className="px-4 py-2.5">Available hrs/wk</th>
                <th className="px-4 py-2.5">Utilization</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-foreground">
              {users.map((u) => (
                <tr
                  key={`${u.recipient_type}:${u.recipient_id}`}
                  onClick={() => setSelected(u)}
                  className="cursor-pointer hover:bg-canvas"
                >
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{u.recipient_name || u.recipient_id}</span>
                    <span className="ml-1.5 text-[11px] text-foreground-dim">({u.recipient_type})</span>
                  </td>
                  <td className="px-4 py-2.5 text-foreground-muted">
                    {u.active_card_count}
                    {u.card_count !== u.active_card_count && (
                      <span className="text-foreground-dim"> / {u.card_count}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <MonthlyTotalCell payments={u.base_payments || []} />
                    {u.missing_pricing && (
                      <span className="ml-1 text-[11px] text-amber-600" title="One or more cards have no resolvable partner price">
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <AdjustmentCell
                      hours={u.additional_hours || 0}
                      payment={u.additional_payment || 0}
                      currency={u.payments[0]?.currency ?? 'INR'}
                      direction="add"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <AdjustmentCell
                      hours={u.additional_hours || 0}
                      payment={u.additional_payment || 0}
                      currency={u.payments[0]?.currency ?? 'INR'}
                      direction="less"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <FinalPayoutCell
                      payments={u.base_payments || []}
                      additionalPayment={u.additional_payment || 0}
                      currency={u.payments[0]?.currency ?? 'INR'}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-foreground-muted">{u.committed_weekly_hours || 0}</td>
                  <td className="px-4 py-2.5 text-foreground-muted">
                    {u.recipient_type === 'partner'
                      ? '—'
                      : u.available_weekly_hours != null
                        ? u.available_weekly_hours
                        : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <UtilizationBadge pct={u.utilization_pct} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-xs font-medium text-indigo-600">Open →</span>
                    {onPreviewPartner && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onPreviewPartner(u.recipient_id);
                        }}
                        className="ml-2 rounded border border-indigo-200 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50"
                        title="Preview exactly what this user sees in the mini app"
                      >
                        Partner view
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <UserDetailModal
          recipientType={selected.recipient_type}
          recipientId={selected.recipient_id}
          name={selected.recipient_name}
          month={month}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

interface UserDetailCard {
  term_id: string;
  card_id: string;
  business_name: string | null;
  subscription_name: string | null;
  status: 'active' | 'ended';
  start_date: string | null;
  stop_date: string | null;
  partner_price: number | null;
  currency: string | null;
  missing_partner_price: boolean;
  month_active_days: number;
  month_payment: number;
  committed_hours: { daily: number | null; weekly: number | null; monthly: number | null };
  plan_name?: string | null;
  plan_label?: string | null;
  plan_tier?: string | null;
  additional_hours?: number;
  additional_payment?: number;
  actual_hours?: number;
  target_hours_this_month?: number;
}

interface UserDetail {
  recipient_type: 'talent' | 'partner';
  recipient_id: string;
  recipient_name: string | null;
  month: string;
  cards: UserDetailCard[];
  totals: {
    month_payments: Payment[];
    additional_hours: number;
    committed_weekly_hours: number;
    available_weekly_hours: number | null;
    available_hours_status: 'ok' | 'unavailable' | 'not_applicable';
    utilization_pct: number | null;
  };
}

function hrs(v: number | null) {
  return v != null ? v : '—';
}

function UserDetailModal({
  recipientType,
  recipientId,
  name,
  month,
  onClose,
}: {
  recipientType: 'talent' | 'partner';
  recipientId: string;
  name: string | null;
  month: string;
  onClose: () => void;
}) {
  // Local month so you can step back through a user's previous months without
  // closing. Re-syncs to the list's month whenever that changes / on reopen.
  const [detailMonth, setDetailMonth] = useState(month);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => setDetailMonth(month), [month]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { data: res, isLoading } = useQuery({
    queryKey: ['admin-subscription-assignments-user-detail', recipientType, recipientId, detailMonth],
    queryFn: () =>
      api
        .get(`/admin/subscription-assignments/users/${recipientType}/${recipientId}`, {
          params: { month: detailMonth },
        })
        .then((r) => r.data),
  });
  const detail: UserDetail | null = res?.data || null;
  const totals = detail?.totals;
  // One row per client (subscription card); pause/resume + plan-change periods
  // in the month fold together, with each start/stop period in the breakdown.
  const clientGroups = groupIntoClients(detail?.cards ?? [], (r) => r.card_id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-6xl overflow-hidden rounded-lg bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-divider px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{name || recipientId}</h2>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm text-foreground-muted">
                {recipientType === 'talent' ? 'Talent' : 'Partner'}
              </span>
              <span className="text-foreground-dim">·</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setDetailMonth((m) => shiftMonth(m, -1))}
                  className="rounded border border-divider px-1.5 py-0.5 text-xs text-foreground-muted hover:bg-canvas"
                  aria-label="Previous month"
                  title="Previous month"
                >
                  ◀
                </button>
                <span className="min-w-[120px] text-center text-sm font-medium text-foreground">
                  {monthLabel(detailMonth)}
                </span>
                <button
                  onClick={() => setDetailMonth((m) => shiftMonth(m, 1))}
                  disabled={detailMonth >= currentMonthKey()}
                  className="rounded border border-divider px-1.5 py-0.5 text-xs text-foreground-muted hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="Next month"
                  title="Next month"
                >
                  ▶
                </button>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-foreground-dim hover:text-foreground-muted">
            ✕
          </button>
        </div>

        <div className="max-h-[calc(88vh-64px)] overflow-y-auto px-6 py-4">
          {isLoading || !detail ? (
            <p className="py-8 text-center text-sm text-foreground-dim">Loading…</p>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SummaryStat
                  label={`${monthLabel(detailMonth)} payment`}
                  value={formatPayments(totals?.month_payments || [])}
                  hint={
                    totals?.additional_hours
                      ? totals.additional_hours > 0
                        ? `incl. ${totals.additional_hours} hrs extra (no extra pay)`
                        : `incl. ${Math.abs(totals.additional_hours)} hrs short`
                      : undefined
                  }
                />
                <SummaryStat label="Committed hrs/wk" value={`${totals?.committed_weekly_hours ?? 0}`} />
                <SummaryStat
                  label="Available hrs/wk"
                  value={
                    recipientType === 'partner'
                      ? '—'
                      : totals?.available_hours_status === 'unavailable'
                        ? 'Unavailable'
                        : totals?.available_weekly_hours != null
                          ? `${totals.available_weekly_hours}`
                          : '—'
                  }
                />
                <SummaryStat
                  label="Utilization"
                  value={totals?.utilization_pct != null ? `${totals.utilization_pct}%` : '—'}
                />
              </div>

              {recipientType === 'talent' && totals?.available_hours_status === 'unavailable' && (
                <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                  Couldn’t load this talent’s available hours from SquadHire (they may have none set, or the
                  service is temporarily unavailable).
                </p>
              )}

              <div className="overflow-x-auto rounded-lg border border-divider">
                <table className="w-full">
                  <thead className="bg-surface-alt text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
                    <tr>
                      <th className="px-3 py-2">Client name</th>
                      <th className="px-3 py-2">Active days</th>
                      <th className="px-3 py-2">Partner price</th>
                      <th className="px-3 py-2">Monthly total</th>
                      <th className="px-3 py-2">Additional days/hours</th>
                      <th className="px-3 py-2">Less hours/days</th>
                      <th className="px-3 py-2">Final payout</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm text-foreground">
                    {clientGroups.map((g) => (
                      <Fragment key={g.key}>
                        <tr>
                          <td className="px-3 py-2">
                            <ClientCell
                              business={g.business_name || '—'}
                              role={g.plan_name}
                              tier={g.subscription_name}
                              hours={g.committed_hours}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <ActiveDaysButton group={g} expanded={expanded.has(g.key)} onToggle={() => toggle(g.key)} />
                          </td>
                          <td className="px-3 py-2 text-foreground-muted">{partnerPriceLabel(g)}</td>
                          <td className="px-3 py-2">
                            <MonthlyTotalCell payments={g.payments} />
                          </td>
                          <td className="px-3 py-2">
                            <AdjustmentCell
                              hours={g.additional_hours}
                              payment={g.additional_payment}
                              currency={g.currency}
                              direction="add"
                              actual={g.actual_hours}
                              target={g.target_hours}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <AdjustmentCell
                              hours={g.additional_hours}
                              payment={g.additional_payment}
                              currency={g.currency}
                              direction="less"
                              actual={g.actual_hours}
                              target={g.target_hours}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <FinalPayoutCell
                              payments={g.payments}
                              additionalPayment={g.additional_payment}
                              currency={g.currency}
                            />
                          </td>
                        </tr>
                        {expanded.has(g.key) && (
                          <tr>
                            <td colSpan={7} className="px-3 pb-3 pt-0">
                              <PeriodBreakdown
                                periods={g.periods}
                                additionalHours={g.additional_hours}
                                additionalPayment={g.additional_payment}
                                currency={g.currency}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-divider bg-surface-alt px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-foreground-dim">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-foreground-muted">{hint}</div>}
    </div>
  );
}
