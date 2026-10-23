// The business's subscription cards come live from Squad Hub over the bridge
// (GET /subscription-cards/mine → GET /bridge/v1/business/:hubClientId/cards).
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import HubUnavailable, { isHubUnavailable } from '../../../components/HubUnavailable';

export interface BridgeSubscriptionCard {
  id: string;
  card_code: string | null;
  card_type: string;
  service_type: string | null;
  plan_name: string | null;
  plan_tier: string | null;
  weekly_hours: number | null;
  brand_name: string | null;
  status: string;
  published_at: string | null;
  assigned_at: string | null;
  paused_at: string | null;
  assignees: { name: string | null; since: string | null }[];
  saas_shared_workspace_id: string | null;
}

export interface BusinessCardsData {
  linked: boolean;
  business_name?: string;
  subscription_cards: BridgeSubscriptionCard[];
  job_cards: any[];
}

export function useBusinessCards() {
  return useQuery({
    queryKey: ['business-cards'],
    queryFn: () => api.get('/subscription-cards/mine').then((r) => r.data.data as BusinessCardsData),
    retry: (count, err) => !isHubUnavailable(err) && count < 1,
  });
}

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-emerald-500/10 text-emerald-600' },
  paused: { label: 'Paused', cls: 'bg-orange-500/10 text-orange-600' },
  sourcing: { label: 'Finding talent', cls: 'bg-indigo-500/10 text-indigo-600' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-500/10 text-red-600' },
  superseded: { label: 'Changed plan', cls: 'bg-slate-500/10 text-slate-500' },
  closed: { label: 'Closed', cls: 'bg-slate-500/10 text-slate-500' },
  archived: { label: 'Archived', cls: 'bg-slate-500/10 text-slate-500' },
};

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ClientSubscriptionCards() {
  const { data, isLoading, error, refetch } = useBusinessCards();
  const cards = data?.subscription_cards ?? [];

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-foreground">Subscriptions</h1>
        <p className="mt-1 text-sm text-foreground-muted">Your Squad Hub subscriptions and who is working on them.</p>

        <div className="mt-6">
          {isLoading ? (
            <p className="text-sm text-foreground-muted">Loading…</p>
          ) : error ? (
            isHubUnavailable(error) ? (
              <HubUnavailable what="Subscriptions" onRetry={() => refetch()} />
            ) : (
              <p className="text-sm text-red-500">Failed to load subscriptions.</p>
            )
          ) : !data?.linked ? (
            <div className="rounded-lg border border-divider bg-surface-alt p-8 text-center">
              <p className="text-sm text-foreground-muted">This account isn&apos;t linked to a Squad Hub business yet.</p>
            </div>
          ) : cards.length === 0 ? (
            <div className="rounded-lg border border-divider bg-surface-alt p-8 text-center">
              <p className="text-sm text-foreground-muted">No subscriptions yet.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {cards.map((c) => {
                const pill = STATUS_PILL[c.status] ?? { label: c.status, cls: 'bg-slate-500/10 text-slate-500' };
                const plan = [c.plan_name, c.plan_tier].filter(Boolean).join(' · ');
                const talent = c.assignees.map((a) => a.name).filter(Boolean).join(', ');
                return (
                  <li key={c.id} className="rounded-lg border border-divider bg-surface-alt p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-medium text-foreground">{c.service_type || 'Subscription'}</h3>
                          {plan && (
                            <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-600">{plan}</span>
                          )}
                        </div>
                        {c.brand_name && <p className="mt-1 truncate text-sm text-foreground-muted">{c.brand_name}</p>}
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${pill.cls}`}>{pill.label}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-muted">
                      {c.card_code && <span>{c.card_code}</span>}
                      {c.weekly_hours != null && <span>{c.weekly_hours} h / week</span>}
                      {talent ? <span>Working with {talent}</span> : <span>No talent assigned yet</span>}
                      {c.assigned_at && <span>Since {fmtDate(c.assigned_at)}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
