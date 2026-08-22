import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';

// Partner Payments mini app — assigned clients, monthly payouts and
// commission status for the signed-in partner. Internal admins get a
// partner picker so they can preview any partner's statement.

type Payment = { currency: string; amount: number };

type MeData = {
  mode: 'admin' | 'self';
  recipient_id?: string;
  recipient_name?: string | null;
  recipients?: { recipient_id: string; recipient_name: string | null }[];
};

type ClientRow = {
  term_id: string;
  business_name: string | null;
  subscription_name: string | null;
  status: 'active' | 'ended';
  card_state?: string | null;
  card_paused_at?: string | null;
  card_cancelled_at?: string | null;
  start_date: string | null;
  end_date: string | null;
  plan_label: string | null;
  plan_tier: string | null;
  currency: string | null;
  month_active_days: number;
  month_payment: number;
  committed_weekly_hours: number | null;
  additional_hours: number;
  additional_payment: number;
};

type MonthData = {
  month: string;
  clients: ClientRow[];
  totals: { month_payments: Payment[]; committed_weekly_hours: number; additional_hours: number };
};

type PayoutRow = {
  month: string;
  payments: Payment[];
  commission_status: 'paid' | 'pending';
  post_date: string | null;
  expected_post_date: string;
  committed_weekly_hours: number;
  lines: { client: string | null; currency: string; amount: number; note?: string }[];
};

type HistoryData = { current_month: string; payouts: PayoutRow[] };

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'clients', label: 'My Clients' },
  { id: 'payouts', label: 'Payouts' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function monthShort(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short' });
}

function formatMoney(amount: number, currency: string | null) {
  const cur = currency && currency !== 'UNKNOWN' ? currency : '';
  if (cur === 'INR') return '\u20B9' + (amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  if (cur === 'USD') return '$' + (amount || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return `${cur ? cur + ' ' : ''}${(amount || 0).toLocaleString()}`;
}

function formatPayments(payments: Payment[]) {
  if (!payments || payments.length === 0) return '\u2014';
  return payments.map((p) => formatMoney(p.amount, p.currency)).join(' + ');
}

function fmtDate(d: string | null) {
  if (!d) return '\u2014';
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function CommissionChip({ status }: { status: 'paid' | 'pending' }) {
  if (status === 'paid') {
    return (
      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
        Paid
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
      Pending
    </span>
  );
}

function ClientStatusChip({ c }: { c: ClientRow }) {
  if (c.card_paused_at)
    return (
      <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-500/15 dark:text-orange-400">
        Paused
      </span>
    );
  if (c.card_cancelled_at || c.card_state === 'closed')
    return (
      <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-400">
        Cancelled
      </span>
    );
  if (c.status === 'active')
    return (
      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
        Active
      </span>
    );
  return <span className="inline-flex rounded-full bg-well px-2 py-0.5 text-[10px] font-semibold text-foreground-muted">Ended</span>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-divider bg-surface px-6 py-14 text-center">
      <h3 className="font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-foreground-muted">{body}</p>
    </div>
  );
}

function Loading({ what }: { what: string }) {
  return <div className="py-16 text-center text-sm text-foreground-muted">Loading {what}…</div>;
}

export default function PartnerPaymentsPage() {
  const [tab, setTab] = useState<TabId>('overview');

  const me = useQuery<MeData>({
    queryKey: ['partner-payments-me'],
    queryFn: async () => (await api.get<{ success: boolean; data: MeData }>('/partner-payments/me')).data.data,
  });

  const isAdmin = me.data?.mode === 'admin';
  const recipients = me.data?.recipients ?? [];
  const [selectedId, setSelectedId] = useState<string>('');
  const recipientId = isAdmin ? selectedId || recipients[0]?.recipient_id || '' : me.data?.recipient_id || '';
  const recipientName = isAdmin
    ? recipients.find((r) => r.recipient_id === recipientId)?.recipient_name || 'Partner'
    : me.data?.recipient_name || 'You';

  const month = useQuery<MonthData>({
    queryKey: ['partner-payments-month', recipientId],
    queryFn: async () =>
      (await api.get<{ success: boolean; data: MonthData }>('/partner-payments/month', { params: { recipient_id: recipientId } }))
        .data.data,
    enabled: !!recipientId,
  });

  const history = useQuery<HistoryData>({
    queryKey: ['partner-payments-history', recipientId],
    queryFn: async () =>
      (
        await api.get<{ success: boolean; data: HistoryData }>('/partner-payments/history', {
          params: { recipient_id: recipientId, months: 12 },
        })
      ).data.data,
    enabled: !!recipientId,
  });

  const payouts = history.data?.payouts ?? [];
  const currentMonth = history.data?.current_month || currentMonthKey();

  if (me.isLoading) return <Loading what="the app" />;
  if (me.isError) {
    const msg =
      (me.error as { response?: { data?: { error?: string } } }).response?.data?.error ||
      'Ask an admin to grant your user the Partner Payments app.';
    return <EmptyState title="Access denied" body={msg} />;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Partner Payments</h2>
            <p className="mt-0.5 text-xs text-foreground-muted">
              {isAdmin
                ? 'Preview any partner\u2019s payout statement.'
                : `Assigned clients, payouts and commission status${me.data?.recipient_name ? ` \u00B7 ${me.data.recipient_name}` : ''}.`}
            </p>
          </div>
          {isAdmin && recipients.length > 0 && (
            <select
              value={recipientId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="rounded-lg border border-divider-strong bg-surface px-2.5 py-1.5 text-sm text-foreground"
            >
              {recipients.map((r) => (
                <option key={r.recipient_id} value={r.recipient_id}>
                  {r.recipient_name || r.recipient_id.slice(0, 8)}
                </option>
              ))}
            </select>
          )}
        </div>

        {!recipientId ? (
          <EmptyState
            title="No partner engagements yet"
            body="Once a subscription is assigned to a partner, their payout statement appears here."
          />
        ) : (
          <>
            <div className="flex items-end justify-between gap-3 border-b border-divider">
              <div className="flex gap-2">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                      tab === t.id
                        ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                        : 'border-transparent text-foreground-muted hover:text-foreground'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <span className="mb-1.5 hidden text-xs text-foreground-dim sm:block">{recipientName}</span>
            </div>

            {tab === 'overview' && (
              <OverviewTab month={month.data} payouts={payouts} currentMonth={currentMonth} loading={month.isLoading || history.isLoading} />
            )}
            {tab === 'clients' && <ClientsTab month={month.data} loading={month.isLoading} />}
            {tab === 'payouts' && <PayoutsTab payouts={payouts} loading={history.isLoading} currentMonth={currentMonth} />}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-divider bg-surface p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">{label}</div>
      <div className="mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight">{value}</div>
      {sub != null && <div className="mt-1">{sub}</div>}
    </div>
  );
}

function sumByCurrency(payouts: PayoutRow[]): Payment[] {
  const m = new Map<string, number>();
  payouts.forEach((p) => p.payments.forEach((x) => m.set(x.currency, (m.get(x.currency) || 0) + x.amount)));
  return [...m.entries()].map(([currency, amount]) => ({ currency, amount }));
}

function OverviewTab({
  month,
  payouts,
  currentMonth,
  loading,
}: {
  month?: MonthData;
  payouts: PayoutRow[];
  currentMonth: string;
  loading: boolean;
}) {
  const thisMonth = payouts.find((p) => p.month === currentMonth);
  const pending = payouts.filter((p) => p.commission_status !== 'paid');
  const yearPrefix = currentMonth.slice(0, 4);
  const ytd = sumByCurrency(payouts.filter((p) => p.commission_status === 'paid' && p.month.startsWith(yearPrefix)));
  const activeClients = (month?.clients ?? []).filter((c) => c.status === 'active').length;

  const series = payouts.slice(-8);
  const maxVal = Math.max(1, ...series.map((p) => p.payments.find((x) => x.currency === 'INR')?.amount ?? 0));

  if (loading) return <Loading what="your statement" />;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={`${monthLabel(currentMonth)} payout`}
          value={formatPayments(thisMonth?.payments ?? [])}
          sub={<CommissionChip status={thisMonth?.commission_status ?? 'pending'} />}
        />
        <StatCard
          label="Awaiting commission"
          value={formatPayments(sumByCurrency(pending))}
          sub={pending.length ? `Posts ${fmtDate(pending[pending.length - 1].expected_post_date)}` : 'All settled'}
        />
        <StatCard label={`Earned in ${yearPrefix}`} value={formatPayments(ytd)} sub="Paid payouts this year" />
        <StatCard label="Active clients" value={String(activeClients)} sub={`${(month?.clients ?? []).length} total engagements`} />
      </div>

      <div className="overflow-hidden rounded-xl border border-divider bg-surface">
        <div className="flex items-center justify-between border-b border-divider px-4 py-3">
          <h3 className="text-sm font-semibold">Payout trend · last 8 months</h3>
          <span className="text-xs text-foreground-dim">INR earnings shown</span>
        </div>
        <div className="px-4 pb-4 pt-3">
          {series.length === 0 ? (
            <div className="py-10 text-center text-sm text-foreground-muted">No payouts yet.</div>
          ) : (
            <div className="flex h-40 items-end gap-2 pt-2">
              {series.map((p) => {
                const v = p.payments.find((x) => x.currency === 'INR')?.amount ?? 0;
                const pct = Math.max(2, Math.round((v / maxVal) * 100));
                const isCurrent = p.month === currentMonth;
                return (
                  <div key={p.month} className="flex min-w-0 flex-1 flex-col items-center justify-end self-stretch">
                    <div className="mb-1 whitespace-nowrap text-[10.5px] text-foreground-muted">{v ? formatMoney(v, 'INR') : '\u2014'}</div>
                    <div className="flex h-full w-full max-w-[46px] items-end justify-center">
                      <div
                        title={`${monthLabel(p.month)}: ${formatPayments(p.payments)}`}
                        className={`w-full rounded-md ${isCurrent ? 'bg-gradient-to-b from-[var(--color-accent)] to-[var(--color-accent-strong)]' : 'bg-well'}`}
                        style={{ height: `${pct}%` }}
                      />
                    </div>
                    <div className={`mt-2 whitespace-nowrap text-[11px] ${isCurrent ? 'font-bold text-foreground' : 'text-foreground-muted'}`}>
                      {monthShort(p.month)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-divider bg-surface">
        <div className="border-b border-divider px-4 py-3">
          <h3 className="text-sm font-semibold">Recent payouts</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-alt text-left text-[11px] uppercase tracking-wide text-foreground-muted">
                <th className="px-4 py-2.5 font-semibold">Month</th>
                <th className="px-4 py-2.5 text-right font-semibold">Gross payout</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Posted / expected</th>
              </tr>
            </thead>
            <tbody>
              {[...payouts].reverse().slice(0, 4).map((p) => (
                <tr key={p.month} className="border-t border-divider">
                  <td className="px-4 py-3 font-medium">{monthLabel(p.month)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatPayments(p.payments)}</td>
                  <td className="px-4 py-3">
                    <CommissionChip status={p.commission_status} />
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">
                    {p.post_date ? fmtDate(p.post_date) : `Expected ${fmtDate(p.expected_post_date)}`}
                  </td>
                </tr>
              ))}
              {payouts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-foreground-muted">
                    No payouts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ClientsTab({ month, loading }: { month?: MonthData; loading: boolean }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'ended'>('all');
  const rows = useMemo(() => {
    let list = month?.clients ?? [];
    if (filter === 'active') list = list.filter((c) => c.status === 'active');
    if (filter === 'ended') list = list.filter((c) => c.status !== 'active');
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((c) => `${c.business_name ?? ''} ${c.subscription_name ?? ''}`.toLowerCase().includes(q));
    return list;
  }, [month, filter, search]);

  if (loading) return <Loading what="clients" />;

  return (
    <div className="overflow-hidden rounded-xl border border-divider bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-divider-strong">
            {(['all', 'active', 'ended'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`border-l border-divider px-3 py-1.5 text-xs font-semibold first:border-l-0 ${
                  filter === f ? 'bg-[var(--color-accent)] text-white' : 'bg-surface text-foreground-muted hover:bg-surface-alt'
                }`}
              >
                {f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients…"
            className="rounded-lg border border-divider-strong bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-dim"
          />
        </div>
        <span className="text-xs text-foreground-dim">{rows.length} shown</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-alt text-left text-[11px] uppercase tracking-wide text-foreground-muted">
              <th className="px-4 py-2.5 font-semibold">Client</th>
              <th className="px-4 py-2.5 font-semibold">Plan</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Start date</th>
              <th className="px-4 py-2.5 font-semibold">End date</th>
              <th className="px-4 py-2.5 text-right font-semibold">Commitment</th>
              <th className="px-4 py-2.5 text-right font-semibold">{month ? `${monthLabel(month.month)} pay` : 'This month\u2019s pay'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.term_id} className="border-t border-divider hover:bg-surface-alt">
                <td className="px-4 py-3">
                  <div className="font-medium">{c.business_name || '\u2014'}</div>
                  {c.subscription_name && <div className="mt-0.5 text-xs text-foreground-muted">{c.subscription_name}</div>}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  {c.plan_label || '\u2014'}
                  {c.plan_tier && (
                    <span className="ml-1.5 inline-block rounded border border-divider-strong px-1.5 align-middle text-[10.5px] font-semibold text-foreground-muted">
                      {c.plan_tier}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <ClientStatusChip c={c} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">{fmtDate(c.start_date)}</td>
                <td className="whitespace-nowrap px-4 py-3">{c.end_date ? fmtDate(c.end_date) : '\u2014'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {c.committed_weekly_hours != null ? `${c.committed_weekly_hours} h/wk` : '\u2014'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {c.month_payment > 0 ? (
                    <>
                      <span className="font-medium">{formatMoney(c.month_payment, c.currency)}</span>
                      {c.additional_payment > 0 && (
                        <div className="whitespace-normal text-xs text-foreground-muted">
                          +{formatMoney(c.additional_payment, c.currency)} · {c.additional_hours} add&rsquo;l hrs
                        </div>
                      )}
                    </>
                  ) : (
                    '\u2014'
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-foreground-muted">
                  No clients match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PayoutsTab({
  payouts,
  loading,
  currentMonth,
}: {
  payouts: PayoutRow[];
  loading: boolean;
  currentMonth: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (m: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });

  if (loading) return <Loading what="payouts" />;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-divider bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-alt text-left text-[11px] uppercase tracking-wide text-foreground-muted">
                <th className="px-4 py-2.5 font-semibold">Payout month</th>
                <th className="px-4 py-2.5 text-right font-semibold">Gross payout</th>
                <th className="px-4 py-2.5 font-semibold">Commission status</th>
                <th className="px-4 py-2.5 font-semibold">Post date</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <PayoutRowGroup
                  key={p.month}
                  row={p}
                  open={open.has(p.month)}
                  onToggle={() => toggle(p.month)}
                  isCurrent={p.month === currentMonth}
                />
              ))}
              {payouts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-foreground-muted">
                    No payouts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-center text-xs text-foreground-dim">
        Payouts are posted on the 1st of the following month. The running month shows as Pending until it closes.
      </p>
    </div>
  );
}

function PayoutRowGroup({
  row,
  open,
  onToggle,
}: {
  row: PayoutRow;
  open: boolean;
  onToggle: () => void;
  isCurrent?: boolean;
}) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-surface-alt" onClick={onToggle} aria-expanded={open}>
        <td className="px-4 py-3">
          <div className="font-medium">{monthLabel(row.month)}</div>
          <div className="mt-0.5 text-xs text-foreground-muted">
            {row.lines.length} client{row.lines.length === 1 ? '' : 's'} · tap to expand
          </div>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{formatPayments(row.payments)}</td>
        <td className="px-4 py-3">
          <CommissionChip status={row.commission_status} />
        </td>
        <td className="px-4 py-3 text-foreground-muted">
          {row.post_date ? fmtDate(row.post_date) : `Expected ${fmtDate(row.expected_post_date)}`}
        </td>
      </tr>
      {open && (
        <tr className="bg-surface-alt">
          <td colSpan={4} className="px-4 py-2">
            <ul className="py-1">
              {row.lines.map((l, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
                  <span className="font-medium">{l.client || '\u2014'}</span>
                  {l.note && <span className="text-xs text-foreground-dim">{l.note}</span>}
                  <span className="whitespace-nowrap font-semibold tabular-nums">{formatMoney(l.amount, l.currency)}</span>
                </li>
              ))}
              {row.lines.length === 0 && <li className="py-1 text-center text-foreground-muted">No activity this month.</li>}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
