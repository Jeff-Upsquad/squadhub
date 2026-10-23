// Business home: subscriptions + billing come live from Squad Hub over the
// bridge (cards: GET /subscription-cards/mine, billing: GET
// /subscription-cards/payments). Invoices are issued from SquadBooks, so the
// Hub sends `invoices: null` and we say where to find them.
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../../stores/authStore';
import api from '../../../services/api';
import HubUnavailable, { isHubUnavailable } from '../../../components/HubUnavailable';
import { useBusinessCards } from './ClientSubscriptionCards';

interface PaymentLine {
  card_id: string;
  subscription_name: string | null;
  role: string | null;
  plan: string | null;
  talent: string | null;
  currency: string;
  amount: number;
  estimated: boolean;
}
interface PaymentMonth {
  month: string;
  label: string;
  totals: { currency: string; amount: number }[];
  lines: PaymentLine[];
}
interface PaymentsData {
  linked: boolean;
  payments: PaymentMonth[];
  invoices: unknown[] | null;
}

function money(amount: number, currency: string): string {
  const sym = currency === 'USD' ? '$' : currency === 'INR' ? '₹' : `${currency} `;
  return sym + (amount || 0).toLocaleString(currency === 'USD' ? 'en-US' : 'en-IN', { maximumFractionDigits: 0 });
}

export default function ClientDashboard() {
  const user = useAuthStore((s) => s.user);
  const cards = useBusinessCards();
  const payments = useQuery({
    queryKey: ['business-payments'],
    queryFn: () => api.get('/subscription-cards/payments').then((r) => r.data.data as PaymentsData),
    retry: (count, err) => !isHubUnavailable(err) && count < 1,
  });

  const subs = cards.data?.subscription_cards ?? [];
  const active = subs.filter((c) => c.status === 'active');
  const paused = subs.filter((c) => c.status === 'paused');
  const sourcing = subs.filter((c) => c.status === 'sourcing');
  const months = [...(payments.data?.payments ?? [])].reverse().filter((m) => m.lines.length > 0);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">Welcome, {user?.display_name}</h1>
        <p className="mt-1 text-sm text-foreground-muted">{cards.data?.business_name || 'Your business'}</p>

        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Your subscriptions</h2>
          <div className="mt-4">
            {cards.isLoading ? (
              <p className="text-sm text-foreground-muted">Loading…</p>
            ) : cards.error ? (
              isHubUnavailable(cards.error) ? (
                <HubUnavailable what="Your subscriptions" onRetry={() => cards.refetch()} />
              ) : (
                <p className="text-sm text-red-500">Failed to load subscriptions.</p>
              )
            ) : !cards.data?.linked ? (
              <div className="rounded-lg border border-divider bg-surface-alt p-6 text-center">
                <p className="text-sm text-foreground-muted">No Squad Hub business is linked to this account yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Active', n: active.length },
                  { label: 'Finding talent', n: sourcing.length },
                  { label: 'Paused', n: paused.length },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-divider bg-surface-alt p-4">
                    <div className="text-2xl font-bold text-foreground">{s.n}</div>
                    <div className="text-xs text-foreground-muted">{s.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">Billing</h2>
          <div className="mt-4 space-y-3">
            {payments.isLoading ? (
              <p className="text-sm text-foreground-muted">Loading…</p>
            ) : payments.error ? (
              isHubUnavailable(payments.error) ? (
                <HubUnavailable what="Billing" onRetry={() => payments.refetch()} />
              ) : (
                <p className="text-sm text-red-500">Failed to load billing.</p>
              )
            ) : !payments.data?.linked ? null : months.length === 0 ? (
              <div className="rounded-lg border border-divider bg-surface-alt p-6 text-center">
                <p className="text-sm text-foreground-muted">No billing yet.</p>
              </div>
            ) : (
              months.map((m) => (
                <div key={m.month} className="rounded-lg border border-divider bg-surface-alt p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-foreground">{m.label}</h3>
                    <span className="text-sm font-semibold text-foreground">
                      {m.totals.map((t) => money(t.amount, t.currency)).join(' + ') || '—'}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-foreground-muted">
                    {m.lines.map((l, i) => (
                      <li key={`${l.card_id}-${i}`} className="flex justify-between gap-3">
                        <span className="truncate">
                          {[l.subscription_name || l.role, l.plan, l.talent].filter(Boolean).join(' · ')}
                          {l.estimated ? ' (estimate)' : ''}
                        </span>
                        <span>{money(l.amount, l.currency)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
            {payments.data?.linked && payments.data.invoices == null && (
              <p className="text-xs text-foreground-muted">Invoices are in SquadBooks.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
