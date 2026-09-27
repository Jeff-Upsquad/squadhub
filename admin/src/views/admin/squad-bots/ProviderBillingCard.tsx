import { useQuery } from '@tanstack/react-query';
import type { AiProvider, AiProviderBilling, AiProviderBillingMetric } from '@squadhub/shared';
import api from '../../../services/api';

export const BILLING_MODES = { unknown: 'Billing not set', prepaid: 'Prepaid credits', pay_as_you_go: 'Pay as you go' };
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
function date(value: string) {
  return new Date(value).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function BillingMetric({ title, metric, loading, notApplicable = false }: {
  title: string; metric: AiProviderBillingMetric | null; loading: boolean; notApplicable?: boolean;
}) {
  const scope = metric?.scope === 'api_key' ? 'This API key' : metric?.scope === 'organization' ? 'Whole organization' : 'Whole account';
  const currentMonth = new Date().toISOString().slice(0, 7);
  const olderMonth = metric?.period_start && metric.period_start.slice(0, 7) !== currentMonth;
  return (
    <div className="min-w-0 rounded-lg bg-surface-alt px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-foreground-muted">{title}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${metric && metric.usd <= 0 && !metric.period_start ? 'text-amber-700' : 'text-foreground'}`}>
        {loading ? <span className="text-sm text-foreground-dim">Loading…</span> : notApplicable ? <span className="text-sm text-foreground-muted">Not applicable</span> : metric ? usd.format(metric.usd) : <span className="text-sm text-foreground-muted">Unavailable</span>}
      </p>
      {!loading && !notApplicable && metric && (
        <>
          <p className="mt-1 text-[11px] text-foreground-muted">{scope} · USD</p>
          <p className={`mt-1 text-[11px] ${metric.source === 'manual' ? 'text-amber-700' : 'text-foreground-dim'}`}>
            {metric.source === 'manual' ? 'Manual · as of' : 'Checked'} {date(metric.as_of)}
          </p>
          {olderMonth && <p className="mt-1 text-[11px] text-amber-700">Previous month’s record</p>}
        </>
      )}
    </div>
  );
}

export default function ProviderBillingCard({ provider: p, onEdit, onMakeDefault, defaultPending }: {
  provider: AiProvider; onEdit: () => void; onMakeDefault: () => void; defaultPending: boolean;
}) {
  const { data, isLoading, isFetching, isError, refetch } = useQuery<AiProviderBilling>({
    queryKey: ['squad-bots', 'provider-billing', p.id, p.billing_settings, p.base_url, p.api_key_env, p.kind],
    queryFn: () => api.get(`/admin/squad-bots/providers/${p.id}/billing`).then((r) => r.data.data),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
  const mode = p.billing_settings?.mode ?? 'unknown';
  const spendMonth = data?.spend?.period_start;
  const spendTitle = spendMonth && spendMonth.slice(0, 7) !== new Date().toISOString().slice(0, 7)
    ? `Spend · ${new Date(spendMonth).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })}`
    : 'Spent this month';
  return (
    <article aria-label={`${p.name} billing`} className="flex min-w-0 flex-col rounded-xl border border-divider bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{p.name}</h3>
            {p.is_default && <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-medium text-white">Default</span>}
          </div>
          <p className="mt-1 text-[12px] text-foreground-muted">{BILLING_MODES[mode]}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] ${!p.is_enabled ? 'bg-canvas text-foreground-dim' : p.ready ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {!p.is_enabled ? 'Off' : p.ready ? 'Ready' : 'Needs setup'}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 px-5 pt-4 min-[440px]:grid-cols-2" aria-live="polite">
        <BillingMetric title="Credit balance" metric={data?.balance ?? null} loading={isLoading} notApplicable={mode === 'pay_as_you_go'} />
        <BillingMetric title={spendTitle} metric={data?.spend ?? null} loading={isLoading} />
      </div>
      <div className="flex-1 px-5 py-3">
        {isError && <p role="alert" className="text-[12px] text-red-600">Could not load billing. Try Refresh.{data && ' The figures shown were not refreshed.'}</p>}
        {data?.messages.map((message) => <p key={message} className="mt-1 text-[12px] leading-relaxed text-foreground-muted">{message}</p>)}
        {p.problem && p.is_enabled && <p className="mt-2 text-[12px] text-red-600">{p.problem}</p>}
        <p className="mt-3 break-words text-[11px] text-foreground-dim">
          {p.kind === 'anthropic' ? 'Claude API' : 'OpenAI-compatible'} · {p.default_model || 'No default model'}
          <span className="mt-0.5 block font-[family-name:var(--font-mono)]">{p.api_key_env || 'No API key variable'}</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider px-5 py-3 text-[12px]">
        <div className="flex flex-wrap gap-3">
          {data?.billing_url && <a href={data.billing_url} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:underline">Billing console ↗</a>}
          <button disabled={isFetching} onClick={() => void refetch()} className="text-foreground-muted hover:text-foreground disabled:opacity-50">{isFetching ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        <div className="flex flex-wrap gap-3">
          {!p.is_default && p.is_enabled && <button disabled={defaultPending} onClick={onMakeDefault} className="text-foreground-muted hover:text-foreground disabled:opacity-50">Make default</button>}
          <button onClick={onEdit} className="font-medium text-foreground hover:underline">Edit billing & provider</button>
        </div>
      </div>
    </article>
  );
}
